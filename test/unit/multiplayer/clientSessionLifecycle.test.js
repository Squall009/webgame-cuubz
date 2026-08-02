/**
 * Cuubz — leaving a session without leaving the lobby (D-105 … D-108)
 *
 * ─── THE BUG THIS FILE IS THE REGRESSION GATE FOR ───────────────────────────
 *
 * `MultiplayerClient.leaveSession()` was `leaveSession() { this.disconnect(); }`, and
 * `disconnect()` closes the **matchmaking** socket and nulls `_matchmakingConn`. Nothing
 * in the game reconnects it — `Bootstrap.js` calls `connectMatchmaking()` once per page
 * load — and `browseSessions()`, `hostSession()` and `joinSession()` are each guarded on
 * that field, so all three became silent no-ops after the first exit-to-menu. The player
 * saw a session list that never refreshed (rows left over from before the game they had
 * just played, which read as "duplicates"), clicks on those rows that did nothing, and a
 * Host button that produced no session on the relay.
 *
 * Every `it` below fails against the old code. The suite deliberately drives
 * `MultiplayerClient` rather than `WSConnection` — `test/unit/multiplayer/
 * multiplayerClient.test.js` covers the socket wrapper's queue, backoff and heartbeat in
 * isolation; what broke here was the layer that owns *two* sockets and confused them.
 */

import { describe, it, expect, vi } from 'vitest';
import { MultiplayerClient, WSConnection, CLIENT_STATE, MESSAGE_TYPES } from '../../../src/multiplayer/Client.js';

/**
 * A socket double. `openImmediately` mirrors what a browser does — `onopen` fires on a
 * later turn — but tests here want determinism, so it is driven by hand.
 */
function socketDouble() {
  const s = {
    readyState: 1,
    sent: [],
    send(raw) { s.sent.push(JSON.parse(raw)); },
    close() { s.readyState = 3; if (s.onclose) s.onclose({ code: 1000, reason: '' }); },
    types() { return s.sent.map(m => m.type); },
  };
  return s;
}

/**
 * A socket factory usable with `new` — `WSConnection.connect()` calls
 * `new this._wsFactory(url)`, and an arrow function is not constructible, so a factory
 * written as one throws into `connect()`'s catch and leaves `_socket` null.
 */
function factory(opened) {
  return function MockWebSocket(u) {
    const s = socketDouble();
    s.url = u;
    opened.push(s);
    return s; // an object return wins over the freshly-constructed `this`
  };
}

/** A `MultiplayerClient` with every socket it opens recorded, by URL. */
function clientWithSockets(url = 'ws://relay.test:8765') {
  const opened = [];
  const client = new MultiplayerClient({ url, wsFactory: factory(opened) });
  return { client, opened, socketFor: (frag) => opened.find(s => s.url.includes(frag)) };
}

/** Bring a connection up the way `onopen` would. */
function open(conn) {
  conn._socket.onopen();
}

describe('MultiplayerClient session lifecycle (BUGS.md D-105 … D-108)', () => {
  describe('leaveSession keeps the lobby alive — D-108', () => {
    it('sends LEAVE on matchmaking and keeps the socket', () => {
      const { client } = clientWithSockets();
      client.connectMatchmaking();
      open(client._matchmakingConn);
      client._currentSessionId = 'session_1';

      client.leaveSession();

      expect(client._matchmakingConn).not.toBe(null);
      expect(client.isMatchmakingConnected).toBe(true);
      const leave = client._matchmakingConn._socket.sent.find(m => m.type === MESSAGE_TYPES.LEAVE);
      expect(leave).toBeTruthy();
      expect(leave.sessionId).toBe('session_1');
    });

    it('leaves browse, host and join working afterwards — the reported symptom', () => {
      const { client } = clientWithSockets();
      client.connectMatchmaking();
      open(client._matchmakingConn);
      const mm = client._matchmakingConn._socket;

      client._currentSessionId = 'session_1';
      client.leaveSession();
      mm.sent.length = 0;

      client.browseSessions();
      client.hostSession({ name: 'Second Session', seed: 7, mode: 'creative', maxPlayers: 2 });
      client.joinSession('session_2');

      // Before D-108 all three of these were dropped on the floor with no error: the
      // guard is `if (this._matchmakingConn)` and the field had been nulled.
      expect(mm.types()).toEqual([MESSAGE_TYPES.BROWSE, MESSAGE_TYPES.HOST, MESSAGE_TYPES.JOIN]);
      expect(mm.sent[1].name).toBe('Second Session');
      expect(mm.sent[1].maxPlayers).toBe(2);
      expect(mm.sent[2].sessionId).toBe('session_2');
    });

    it('sends an explicit LEAVE on the game socket and drops it', () => {
      const { client, socketFor } = clientWithSockets();
      client.connectMatchmaking();
      open(client._matchmakingConn);
      client._connectToGameSession('session_1');
      open(client._gameSessionConn);
      const game = socketFor('/session/session_1');

      client.leaveSession();

      // The relay reads this as "deliberate", which is what lets `server/session.js`
      // collect the session immediately instead of holding it 30 s. D-103.
      expect(game.types()).toContain(MESSAGE_TYPES.LEAVE);
      expect(game.readyState).toBe(3);
      expect(client._gameSessionConn).toBe(null);
      expect(client._currentSessionId).toBe(null);
    });

    it('rebuilds the matchmaking socket if it died during the game', () => {
      const { client } = clientWithSockets();
      client.connectMatchmaking();
      open(client._matchmakingConn);
      client._matchmakingConn.dispose();
      client._matchmakingConn = null;

      client.leaveSession();

      expect(client._matchmakingConn).not.toBe(null);
    });

    it('disconnect() is still the full teardown — the two are not the same thing', () => {
      const { client } = clientWithSockets();
      client.connectMatchmaking();
      open(client._matchmakingConn);

      client.disconnect();

      expect(client._matchmakingConn).toBe(null);
      expect(client._gameSessionConn).toBe(null);
    });
  });

  describe('the player id is taken once — D-105', () => {
    it('a second WELCOME does not rename the player', () => {
      const { client } = clientWithSockets();
      client.connectMatchmaking();
      open(client._matchmakingConn);

      client._matchmakingConn._handleMessage({ type: MESSAGE_TYPES.WELCOME, playerId: 'player_first' });
      expect(client.playerId).toBe('player_first');

      // A matchmaking reconnect draws a new id from the relay. Adopting it used to
      // rename the host mid-session, after which `session.js._handleChunkData` refused
      // the host's own chunk streams as "Non-host sent CHUNK_DATA".
      client._matchmakingConn._handleMessage({ type: MESSAGE_TYPES.WELCOME, playerId: 'player_second' });
      expect(client.playerId).toBe('player_first');
    });

    it('joinGame sends the retained id, not the latest one', () => {
      const { client, socketFor } = clientWithSockets();
      client.connectMatchmaking();
      open(client._matchmakingConn);
      client._matchmakingConn._handleMessage({ type: MESSAGE_TYPES.WELCOME, playerId: 'player_host' });
      client._matchmakingConn._handleMessage({ type: MESSAGE_TYPES.WELCOME, playerId: 'player_reconnected' });

      client._connectToGameSession('session_1');
      open(client._gameSessionConn);
      client.joinGame({ name: 'Ada', color: '#fff' }, { x: 0, y: 20, z: 0 }, { yaw: 0, pitch: 0 });

      const join = socketFor('/session/session_1').sent.find(m => m.type === MESSAGE_TYPES.JOIN);
      expect(join.playerId).toBe('player_host');
    });

    it('setPlayerId adopts a stored id, and a later WELCOME cannot overwrite it', () => {
      const { client } = clientWithSockets();
      client.setPlayerId('player_from_rejoin_record');
      client.connectMatchmaking();
      open(client._matchmakingConn);
      client._matchmakingConn._handleMessage({ type: MESSAGE_TYPES.WELCOME, playerId: 'player_fresh' });

      // This is what makes a reclaim a reclaim: the relay matches `JOIN` against
      // `hostId`, so the reloaded page has to assert the id it hosted under. D-109.
      expect(client.playerId).toBe('player_from_rejoin_record');
    });
  });

  describe('connecting to a game session — D-108', () => {
    it('re-entering the same session is a no-op, so a reconnect does not churn sockets', () => {
      const { client, opened } = clientWithSockets();
      client.connectMatchmaking();
      client._connectToGameSession('session_1');
      const first = client._gameSessionConn;
      const count = opened.length;

      client._connectToGameSession('session_1');

      expect(client._gameSessionConn).toBe(first);
      expect(opened.length).toBe(count);
    });

    it('a different session replaces the socket instead of being ignored', () => {
      const { client, socketFor } = clientWithSockets();
      client.connectMatchmaking();
      open(client._matchmakingConn);
      client._connectToGameSession('session_1');
      open(client._gameSessionConn);

      client._connectToGameSession('session_2');

      // The old guard was `if (this._gameSessionConn) return`, so hosting a second
      // session in one page never opened its socket: the relay created the session, no
      // host ever joined it, and it sat in the browse list unenterable.
      expect(client._connectedGameSessionId).toBe('session_2');
      expect(socketFor('/session/session_2')).toBeTruthy();
      expect(socketFor('/session/session_1').readyState).toBe(3);
    });

    it('HOST_CREATED for a second session connects to that second session', () => {
      const { client, socketFor } = clientWithSockets();
      client.connectMatchmaking();
      open(client._matchmakingConn);

      client._matchmakingConn._handleMessage({ type: MESSAGE_TYPES.HOST_CREATED, sessionId: 'session_1' });
      open(client._gameSessionConn);
      client.leaveSession();
      client._matchmakingConn._handleMessage({ type: MESSAGE_TYPES.HOST_CREATED, sessionId: 'session_2' });

      expect(socketFor('/session/session_2')).toBeTruthy();
      expect(client._connectedGameSessionId).toBe('session_2');
    });
  });
});

describe('WSConnection reconnection (BUGS.md D-106, D-107)', () => {
  it('honours maxReconnectAttempts instead of retrying forever', () => {
    vi.useFakeTimers();
    const conn = new WSConnection({
      url: 'ws://dead.test',
      wsFactory: null, // no factory → connect() lands in DISCONNECTED without a socket
      options: { maxReconnectAttempts: 3, reconnectBaseDelay: 10, reconnectMaxDelay: 10 },
    });

    // `maxReconnectAttempts` was declared in DEFAULT_CONFIG and read by nothing.
    for (let i = 0; i < 10; i++) conn._scheduleReconnect();
    expect(conn.reconnectAttempts).toBe(3);

    conn.dispose();
    vi.useRealTimers();
  });

  it('autoReconnect: false actually stops reconnection', () => {
    const conn = new WSConnection({
      url: 'ws://dead.test',
      wsFactory: null,
      options: { autoReconnect: false },
    });

    conn._scheduleReconnect();

    // The old spelling for this was `reconnectBaseDelay = 0`, commented "effectively
    // disables reconnect". `_calculateReconnectDelay` floors at `Math.max(100, …)`, so
    // it produced a 100 ms retry loop instead — the opposite of the intent.
    expect(conn.reconnectAttempts).toBe(0);
    expect(conn.state).not.toBe(CLIENT_STATE.RECONNECTING);
  });

  it('a base delay of 0 does not mean "no reconnect" — the trap D-106 was built on', () => {
    const conn = new WSConnection({
      url: 'ws://dead.test',
      wsFactory: null,
      options: { reconnectBaseDelay: 0 },
    });
    expect(conn._calculateReconnectDelay()).toBe(100);
    conn.dispose();
  });

  it('a heartbeat timeout drops the socket without announcing a LEAVE — D-107', () => {
    vi.useFakeTimers();
    const opened = [];
    const conn = new WSConnection({
      url: 'ws://relay.test/session/session_1',
      wsFactory: factory(opened),
      options: { heartbeatInterval: 1000, heartbeatTimeout: 500, reconnectBaseDelay: 100000 },
    });
    conn.connect();
    const socket = opened[0];
    conn._socket.onopen();
    socket.sent.length = 0;

    vi.advanceTimersByTime(1000); // heartbeat goes out
    expect(socket.types()).toEqual([MESSAGE_TYPES.HEARTBEAT]);
    vi.advanceTimersByTime(600);  // …and is never acknowledged

    // A quiet socket is not a departing player. Now that the relay treats a host's
    // explicit LEAVE as "destroy this session immediately" (D-103), saying LEAVE here
    // would tear down a live game over a backgrounded tab.
    expect(socket.types()).toEqual([MESSAGE_TYPES.HEARTBEAT]);
    expect(conn.state).toBe(CLIENT_STATE.RECONNECTING);

    conn.dispose();
    vi.useRealTimers();
  });

  it('disconnect() still says LEAVE — that is the difference between the two paths', () => {
    const opened = [];
    const conn = new WSConnection({
      url: 'ws://relay.test/session/session_1',
      wsFactory: factory(opened),
      options: { heartbeatInterval: 999999 },
    });
    conn.connect();
    const socket = opened[0];
    conn._socket.onopen();
    socket.sent.length = 0;

    conn.disconnect();

    expect(socket.types()).toEqual([MESSAGE_TYPES.LEAVE]);
  });
});
