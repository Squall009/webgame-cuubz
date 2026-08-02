import { MultiplayerClient } from './Client.js';
import { startHosting } from './SessionHosting.js';
import { getRelayUrl } from './RelayUrl.js';
import { writeLastSession, clearLastSession } from '../util/StorageHelper.js';

/**
 * Cuubz — multiplayer session lifecycle in the browser (PR 16, refactor.md §8.3)
 *
 * Was an inline class in `src/main.js` plus `updateConnectionStatus`, the two
 * `renderPlayerList` helpers, `getRelayUrl` and `initSessionUI`. It wraps
 * `MultiplayerClient` for the UI: browse, host, join, leave, and the block-validation
 * callbacks `startGame()` registers once the chunk manager exists.
 *
 * ─── IT OWNS THE REJOIN RECORD. THAT IS D-43'S FIX ──────────────────────────
 *
 * `getSessionRecord()` is the **only** place that decides what a rejoin record contains,
 * and `StorageHelper.writeLastSession` is the only place that writes it. Six write sites
 * with four different field sets are what produced D-43, where a joiner's mode was
 * hard-coded `'survival'` by the handler that happened to run last. The mode now comes
 * from `this._gameMode`, which is set from the form when hosting and from the browsed
 * session when joining, and is therefore the mode the session is genuinely running in.
 *
 * ─── `deps` IS `main.js`'s LIVE-GETTER BRIDGE ───────────────────────────────
 *
 * `BUGS.md` decision 27. `characterManager`, `worldManager`, `ui` and `gameState` are
 * `let` bindings in `main.js` that are null when this object is constructed. Read them
 * through `this.deps` at the moment they are needed, never capture them. PR 17 and PR 19
 * delete the bridge when those bindings become fields on `Game`.
 */
export class SessionManager {
  /**
   * @param {Object} deps — `main.js`'s `uiDeps`: live getters for `characterManager`,
   *   `worldManager`, `ui`, plus `startGame(mode)`, `updateRejoinPanel()` and `log(msg)`.
   */
  constructor(deps) {
    this.deps = deps;
    this.client = null; // MultiplayerClient instance (created by init())
    this.sessions = [];
    this.currentSessionId = null;
    this.hostingSessionId = null;
    this.players = [];

    // What the session is, as opposed to what a form control currently reads. Set on
    // hosting, on joining and on rejoining; read by getSessionRecord(). D-43.
    this._gameMode = null;
    this._sessionName = null;
    this._sessionSeed = null;

    this._browseCallback = null;
    this._hostCreatedCallback = null;
    this._joinAcceptedCallback = null;
    this._joinRejectedCallback = null;
    // D-78's other half. `_joinRejectedCallback` had a sibling on the wire the whole
    // time and no field, no handler and no routing entry to land in.
    this._hostRejectedCallback = null;
    this._playerJoinedCallback = null;
    this._playerLeftCallback = null;

    // Set for the window between `reclaimHostedSession()` and its `JOIN_ACCEPTED`. D-109.
    this._reclaimingAsHost = false;
  }

  // ── UI access ───────────────────────────────────────────────────────────
  //
  // Every one of these is a live read through the bridge. `ui` is null until
  // `initMenuNavigation()` has run, and `rejoin()` can be reached before that.

  /** @param {'disconnected'|'connecting'|'connected'|'reconnecting'} status */
  updateConnectionStatus(status) {
    const ui = this.deps.ui;
    if (ui && ui.connectionHUD) ui.connectionHUD.set(status);
  }

  /** Hide the in-game player list and connection indicator together. */
  hideInGameOverlays() {
    const ui = this.deps.ui;
    if (!ui) return;
    if (ui.playerList) ui.playerList.hide();
    if (ui.connectionHUD) ui.connectionHUD.hide();
  }

  _renderSessionList(sessions) {
    const ui = this.deps.ui;
    if (ui && ui.lobby) ui.lobby.renderSessionList(sessions);
  }

  _renderPlayerList() {
    const ui = this.deps.ui;
    if (ui && ui.playerList) ui.playerList.render(this.players);
  }

  _showHostError(message) {
    const ui = this.deps.ui;
    if (ui && ui.lobby) ui.lobby.showHostError(message);
  }

  _hideHostError() {
    const ui = this.deps.ui;
    if (ui && ui.lobby) ui.lobby.hideHostError();
  }

  // ── The rejoin record — D-43 ────────────────────────────────────────────

  /**
   * Build the record that describes the session currently in progress.
   *
   * @returns {Object|null} null when there is no session to record, which is what stops a
   *   `beforeunload` in the main menu from writing one.
   */
  getSessionRecord() {
    const isHost = !!this.hostingSessionId;
    const sessionId = this.hostingSessionId || this.currentSessionId;
    if (!sessionId) return null;

    const cm = this.deps.characterManager;
    const wm = this.deps.worldManager;
    const char = cm ? cm.getSelectedCharacter() : null;
    const world = wm ? wm.getSelectedWorld() : null;

    return {
      sessionId,
      name: this._sessionName || (isHost ? 'My Session' : 'Joined Session'),
      mode: this._gameMode || 'survival',
      // A joiner's seed is the host's, carried through the browse list. Before PR 16 the
      // joiner's record had no seed at all, so a rejoin could not rebuild the temp world
      // and fell back to whichever world the player happened to have selected.
      seed: this._sessionSeed !== null && this._sessionSeed !== undefined
        ? this._sessionSeed
        : (world ? world.seed : null),
      isHost,
      // D-109 — what lets the next page load reclaim this seat rather than create a new
      // session beside it. `MultiplayerClient` keeps the first id the relay issued and
      // never lets a reconnect overwrite it (D-105), so this is stable for the session.
      playerId: this.client ? this.client.playerId : null,
      characterId: char ? char.id : null,
      worldId: world ? world.id : null,
      timestamp: Date.now(),
    };
  }

  /** Persist the current session for rejoin. The only caller of the only writer. */
  saveSessionRecord() {
    const record = this.getSessionRecord();
    if (!record) return null;
    return writeLastSession(record);
  }

  // ── Connection ──────────────────────────────────────────────────────────

  /**
   * Create the matchmaking WebSocket client.
   * @param {string} serverUrl — e.g. `ws://localhost:8765`
   */
  init(serverUrl) {
    this._serverUrl = serverUrl || 'ws://localhost:8765';
    this.client = new MultiplayerClient({ url: this._serverUrl });
    this._wireClientEvents();
  }

  /** Wire client events to the UI. */
  _wireClientEvents() {
    if (!this.client) return;

    this.client.on('SESSION_LIST', (data) => {
      this.sessions = data.sessions || [];
      this._renderSessionList(this.sessions);
      if (this._browseCallback) this._browseCallback(this.sessions);
    });

    this.client.on('HOST_CREATED', (data) => {
      this.hostingSessionId = data.sessionId;
      // The relay echoes neither name nor mode reliably; startHosting() has already
      // recorded both. Only fall back when this is a path that did not set them.
      if (!this._sessionName && data.name) this._sessionName = data.name;
      if (!this._gameMode && data.mode) this._gameMode = data.mode;
      this.updateConnectionStatus('connected');
      this.saveSessionRecord();
      this.deps.updateRejoinPanel();
      if (this._hostCreatedCallback) this._hostCreatedCallback(data);
    });

    this.client.on('JOIN_ACCEPTED', (data) => {
      this.currentSessionId = data.sessionId;
      // A reclaim rides the ordinary JOIN path — the relay has no "re-host" verb and does
      // not need one, because `server/session.js._handleJoin` keys on `playerId` and the
      // reclaiming client asserts the id the session was created under. What the relay
      // cannot tell us is that this client is the host, so we carry it ourselves; without
      // it `registerHostCallbacks()` would decline and `registerClientCallbacks()` would
      // take over, and the host's own block edits would stop reaching IndexedDB. D-109.
      if (this._reclaimingAsHost) {
        this.hostingSessionId = data.sessionId;
        this._reclaimingAsHost = false;
      }
      // `JOIN_ACCEPTED` carries sessionId, sessionPort and a message — no name and no
      // mode (server/matchmaking.js). Reading `data.mode || 'survival'` here, as this
      // handler used to, could therefore only ever produce 'survival'. That is the other
      // half of D-43: joinSession() records what the player actually clicked.
      if (!this._sessionName && data.name) this._sessionName = data.name;
      this.updateConnectionStatus('connected');
      this.saveSessionRecord();
      this.deps.updateRejoinPanel();
      if (this._joinAcceptedCallback) this._joinAcceptedCallback(data);
    });

    // ─── A REJECTION MUST ALSO PUT THE INDICATOR BACK — D-78's other half ────
    //
    // `joinSession()` writes `'connecting'` before it calls the relay and `startHosting()`
    // does the same. Neither rejection handler wrote a status at all, so the banner said
    // "Join failed: …" / "Host failed: …" while `#connection-status` and `#connection-hud`
    // both still read "Connecting…" — forever, because nothing else on this path fires.
    // That standing "Connecting…" IS the original complaint ("the host form sits in
    // connecting forever"); adding the handler alone left it in place.
    //
    // `'disconnected'` is the existing vocabulary's term for "not in a session" — it is
    // what `leaveSession()` writes and what `joinSession()`'s own catch block already
    // writes when the relay call throws. The matchmaking socket is still open at this
    // point, and that is deliberate: these two indicators track the SESSION, not the
    // socket. No new state is invented (`ConnectionHUD.STATUS_TEXT` has exactly four).
    this.client.on('JOIN_REJECTED', (data) => {
      const reason = data.reason || 'Unknown error';
      this.updateConnectionStatus('disconnected');
      this._showHostError(`Join failed: ${reason}`);
      if (this._joinRejectedCallback) this._joinRejectedCallback(data);
    });

    // D-78. `server/matchmaking.js` has sent HOST_REJECTED since the relay was written
    // — its `onHostRequest` returns `{ error }` and the reply goes out on the socket —
    // and NOTHING on this side listened. Not a MESSAGE_TYPES key, not an entry in
    // `MultiplayerClient`'s matchmaking routing list, not a handler here. So a host
    // whose request the relay refused saw `startHosting()`'s `connecting` status and
    // then nothing at all, indefinitely. This is JOIN_REJECTED above, mirrored: same
    // banner, same default reason, same optional callback — and the same status reset,
    // see the block above `JOIN_REJECTED`.
    this.client.on('HOST_REJECTED', (data) => {
      const reason = data.reason || 'Unknown error';
      this.updateConnectionStatus('disconnected');
      this._showHostError(`Host failed: ${reason}`);
      if (this._hostRejectedCallback) this._hostRejectedCallback(data);
    });

    this.client.on('PLAYER_JOINED', (data) => {
      this.players.push({
        id: data.playerId,
        name: data.character?.name || 'Player',
        color: data.character?.color || '#888888',
        // D-85: `!= null`, not `!== undefined`. A literal `health: null` on the wire
        // passed the old test and reached `PlayerListOverlay`, where
        // `Math.max(0, Math.min(100, null))` is **0** — a full-health player rendered as
        // an empty red bar. `null` and `undefined` both mean "the relay did not tell us",
        // and the sane default for an unknown is full health, which is what a player who
        // has just joined has. `PlayerListOverlay.js:61` carries the identical guard.
        health: data.health != null ? data.health : 100,
        position: data.position,
      });
      this._renderPlayerList();
      if (this._playerJoinedCallback) this._playerJoinedCallback(data);
    });

    this.client.on('PLAYER_LEFT', (data) => {
      this.players = this.players.filter(p => p.id !== data.playerId);
      this._renderPlayerList();
      if (this._playerLeftCallback) this._playerLeftCallback(data);
    });

    this.client.on('disconnect', () => {
      this.updateConnectionStatus('disconnected');
    });

    this.client.on('stateChange', (data) => {
      const statusMap = {
        disconnected: 'disconnected',
        connecting: 'connecting',
        connected: 'connected',
        reconnecting: 'reconnecting',
      };
      this.updateConnectionStatus(statusMap[data.to] || 'disconnected');
    });

    this.client.connectMatchmaking();
  }

  /** Browse available sessions. */
  browseSessions() {
    if (this.client) {
      this.client.browseSessions();
    } else {
      this._renderSessionList([]); // Offline mode — empty list
    }
  }

  /**
   * Validate the host form and start a hosted session. The body is
   * `SessionHosting.js` — it is the only part of this layer that reads the DOM.
   */
  async startHosting() {
    await startHosting(this);
  }

  // ── Joining ─────────────────────────────────────────────────────────────

  /**
   * Join an existing session.
   *
   * @param {string} sessionId
   * @param {Object} [sessionInfo] — the browsed session's `{name, mode, seed}`. **This is
   *   the only source of truth for a joiner's mode** — `JOIN_ACCEPTED` does not carry one
   *   (server/matchmaking.js) — and supplying it is what closes D-43.
   */
  async joinSession(sessionId, sessionInfo) {
    if (!sessionId) return;

    if (sessionInfo) {
      if (sessionInfo.mode) this._gameMode = sessionInfo.mode;
      if (sessionInfo.name) this._sessionName = sessionInfo.name;
      if (sessionInfo.seed !== undefined && sessionInfo.seed !== null) {
        this._sessionSeed = sessionInfo.seed;
      }
    }

    this.updateConnectionStatus('connecting');

    if (this.client) {
      try {
        await this.client.joinSession(sessionId);
        this.deps.log(`[SessionManager] Joined session: ${sessionId}`);
      } catch (err) {
        this.updateConnectionStatus('disconnected');
        this._showHostError(`Failed to join: ${err.message}`);
      }
    } else {
      // Offline simulation
      this.currentSessionId = sessionId;
      this.updateConnectionStatus('connected');
      this.deps.log(`[SessionManager] Simulated joining: ${sessionId} (offline)`);
    }
  }

  /**
   * Reclaim a session this client was already hosting — the page-reload path.
   *
   * ─── WHY THIS IS NOT `hostSession()` — D-109 ────────────────────────────────
   *
   * Both rejoin paths (`AutoRejoin.js`, `SessionRejoin.js`) sent `HOST` for a stored
   * record with `isHost: true`. `HOST` has exactly one meaning to the relay: *create a
   * session*. It does not look for an existing one, so re-hosting produced a second
   * session carrying the first one's name while the first was still being advertised —
   * an identical-looking row that no host was serving. Reload twice and there were three.
   *
   * The relay already supports what was actually wanted. `server/session.js._handleJoin`
   * treats a `JOIN` whose `playerId` it recognises as a reconnect, and `hostId` is just a
   * player id — so asserting the stored id over an ordinary `JOIN` restores this client
   * as the host of the original session, chunk-streaming rights included
   * (`_handleChunkData` compares against `hostId`).
   *
   * @param {string} sessionId
   * @param {Object} sessionInfo — `{name, mode, seed}`, as `joinSession()` takes.
   * @param {string} playerId — the id from the rejoin record.
   * @returns {Promise<boolean>} false when there is no client or no stored id, in which
   *   case the caller should fall back to hosting a fresh session.
   */
  async reclaimHostedSession(sessionId, sessionInfo, playerId) {
    if (!this.client || !sessionId || !playerId) return false;
    this.client.setPlayerId(playerId);
    this._reclaimingAsHost = true;
    await this.joinSession(sessionId, sessionInfo);
    return true;
  }

  /**
   * Leave the current session and go back to the lobby.
   *
   * ─── WHAT "LEAVE" HAS TO MEAN — D-108, D-109 ────────────────────────────────
   *
   * Three things, and before this it did none of them:
   *
   * 1. **The lobby survives.** `client.leaveSession()` used to be an alias for
   *    `disconnect()`, which closed the matchmaking socket for good; see that method in
   *    `Client.js`. `connectMatchmaking()` below is belt-and-braces — it returns early
   *    when a connection already exists, so it only bites when the socket died mid-game.
   *
   * 2. **The relay is told.** The `LEAVE` on the game socket is what lets
   *    `server/session.js` collect the session immediately instead of holding it through
   *    the 30 s reconnect grace (D-103).
   *
   * 3. **The rejoin record goes.** D-109. Exit-to-menu left `cuubz_last_session` behind,
   *    so the next page load ran `attemptAutoRejoin`, found the record, and — for a host
   *    — called `hostSession()`, which does not rejoin anything. It creates a **new**
   *    session with the old one's name. Every reload after an exit therefore minted
   *    another identically-named row in the browse list. Those are the duplicates.
   *    A deliberate exit is the one moment we know for certain the player is finished
   *    with that session, so it is the moment to forget it; a crash or a refresh
   *    mid-session does not come through here, which is exactly the case rejoin is for.
   */
  leaveSession() {
    if (this.client) {
      this.client.leaveSession();
      this.client.connectMatchmaking();
    }
    this.currentSessionId = null;
    this.hostingSessionId = null;
    this.players = [];
    this._gameMode = null;
    this._sessionName = null;
    this._sessionSeed = null;
    clearLastSession();
    this.deps.updateRejoinPanel();
    this.updateConnectionStatus('disconnected');
    this.hideInGameOverlays();
  }

  // ── Block deltas ────────────────────────────────────────────────────────

  /**
   * Register a BLOCK_BREAK / BLOCK_PLACE pair on the game connection.
   * @param {Function} onBreak
   * @param {Function} onPlace
   * @param {string} label — appears in the error text so a throw names which pair it came from.
   */
  _wireBlockCallbacks(onBreak, onPlace, label) {
    const wire = (event, handler) => {
      if (!handler) return;
      this.client.onGame(event, (data) => {
        try {
          handler(data);
        } catch (err) {
          console.error(`[SessionManager] Error in ${label}${event} handler:`, err.message);
        }
      });
    };
    wire('BLOCK_BREAK', onBreak);
    wire('BLOCK_PLACE', onPlace);
  }

  /**
   * Host-side block validation, registered from `startGame()` once `chunkManager` and the
   * dirty flush exist. The host marks chunks dirty so they reach IndexedDB.
   * @param {Function} onBlockBreakValidated
   * @param {Function} onBlockPlaceValidated
   */
  registerHostCallbacks(onBlockBreakValidated, onBlockPlaceValidated) {
    if (!this.client || !this.hostingSessionId) return;
    this._wireBlockCallbacks(onBlockBreakValidated, onBlockPlaceValidated, '');
    this.deps.log('[SessionManager] Host callbacks registered for IndexedDB persistence');
  }

  /**
   * Client-side block deltas, registered from `startGame()` when joining. Applies remote
   * deltas visually without persisting — only the host persists.
   * @param {Function} onBlockBreak
   * @param {Function} onBlockPlace
   */
  registerClientCallbacks(onBlockBreak, onBlockPlace) {
    if (!this.client || !this.currentSessionId || this.hostingSessionId) return;
    this._wireBlockCallbacks(onBlockBreak, onBlockPlace, 'client ');
    this.deps.log('[SessionManager] Client delta callbacks registered (visual only, no persistence)');
  }

  /** Dispose and clean up. */
  dispose() {
    if (this.client) {
      this.client.dispose();
      this.client = null;
    }
  }
}

/**
 * Build a `SessionManager`, connect it and put the session UI in its resting state.
 *
 * This is the former `initSessionUI()` **and** the three-line lazy re-init that
 * `rejoinSession()` and the auto-rejoin block in `init()` each carried a private copy of.
 * Collapsing them is safe because the two lazy copies did strictly less: they skipped the
 * `disconnected` status write and the overlay hide, both of which are no-ops when the game
 * has not started and are immediately superseded by `connecting`.
 *
 * @param {Object} deps — `main.js`'s `uiDeps`.
 * @returns {SessionManager}
 */
export function createSessionManager(deps) {
  const manager = new SessionManager(deps);
  const relayUrl = getRelayUrl();
  deps.log(`[SessionManager] Relay URL: ${relayUrl}`);
  manager.init(relayUrl);
  manager.updateConnectionStatus('disconnected');
  manager.hideInGameOverlays();
  deps.log('[SessionManager] Initialized with WebSocket client');
  return manager;
}
