/**
 * Cuubz — LobbyScreen (PR 15)
 *
 * `refactor.md` §8.2: "host lobby tabs, browse panel". The two-tab lobby — Browse and
 * Host — its three character/world dropdowns, the session list, and the host error
 * banner. The three inline create forms are `./LobbyForms.js`.
 *
 * ─── WHAT IS DELIBERATELY *NOT* HERE ────────────────────────────────────────
 *
 * `SessionManager`, `REJOIN_STORAGE_KEY`, the rejoin panel, `updateConnectionStatus` and
 * the five `cuubz_last_session` write sites are **PR 16's** (§8.3) and are still in
 * `main.js`. This screen reaches the session manager through `deps.sessionManager`, a live
 * getter, and `main.js` keeps thin delegates for the three methods `SessionManager` calls
 * back into — `renderSessionList`, `showHostError`, `hideHostError`. Moving those two
 * halves in one PR would mean two extractions in one diff with no gate between them.
 *
 * `renderPlayerList` / `hidePlayerList` are the in-game overlay, not the lobby; §4.1 sends
 * them to `src/multiplayer/PlayerListHUD.js`.
 *
 * ─── THE THREE INLINE CREATE FORMS ──────────────────────────────────────────
 *
 * Both panels can create a character without leaving the lobby, and the host panel can
 * also create a world. They are `./LobbyForms.js`, split out in this same PR: they are
 * near-duplicates of each other and of `CharacterScreen`'s modal (**BUGS.md D-41**,
 * PR 29), and keeping them here put this file over §8.2's 400-line accept criterion.
 */

import { WorldManager } from '../../game/entities/WorldManager.js';
import { escapeHtml } from '../../util/HTMLUtils.js';
import { initBrowseCreateChar, initHostForm } from './LobbyForms.js';

export class LobbyScreen {
  /**
   * @param {import('../UIManager.js').UIManager} ui
   */
  constructor(ui) {
    this.ui = ui;
    this.deps = ui.deps;
  }

  /** Wire this screen's controls. Called once, from `UIManager.initNavigation`. */
  init() {
    document.getElementById('tab-browse').addEventListener('click', () => this.switchTab('browse'));
    document.getElementById('tab-host').addEventListener('click', () => this.switchTab('host'));

    document.getElementById('btn-refresh-sessions').addEventListener('click', () => {
      const sm = this.deps.sessionManager;
      if (sm) sm.browseSessions();
    });

    // The three inline create forms are `./LobbyForms.js` — see its header for why
    // they are a unit and why they were not unified with `CharacterScreen`'s modal.
    initBrowseCreateChar(this);
    initHostForm(this);

    // The browse dropdown is populated at init so the panel is usable the first time it
    // is opened, before any tab switch has happened.
    this.populateBrowseCharacterSelect();

    document.getElementById('btn-start-hosting').addEventListener('click', async () => {
      const sm = this.deps.sessionManager;
      if (sm) await sm.startHosting();
    });
  }

  // ── Tabs ──────────────────────────────────────────────────────────────

  /** @param {'browse'|'host'} tab */
  switchTab(tab) {
    const tabBrowse = document.getElementById('tab-browse');
    const tabHost = document.getElementById('tab-host');
    const { browsePanel, hostPanel } = this.ui.sessionUI;

    if (tab === 'browse') {
      tabBrowse.classList.add('active');
      tabHost.classList.remove('active');
      browsePanel.classList.remove('hidden');
      hostPanel.classList.add('hidden');
      const sm = this.deps.sessionManager;
      if (sm) sm.browseSessions();
      this.populateBrowseCharacterSelect();
    } else {
      tabHost.classList.add('active');
      tabBrowse.classList.remove('active');
      hostPanel.classList.remove('hidden');
      browsePanel.classList.add('hidden');
      this.populateHostCharacterSelect();
      this.populateHostWorldSelect();
    }
  }

  // ── Dropdowns ─────────────────────────────────────────────────────────

  populateHostCharacterSelect() {
    const select = document.getElementById('host-character-select');
    if (!select) return;
    select.innerHTML = '';
    const cm = this.deps.characterManager;
    const characters = cm ? cm.getAllCharacters() : [];

    if (characters.length === 0) {
      select.appendChild(this._option('', 'No characters — create one below'));
      return;
    }
    characters.forEach(c => select.appendChild(this._option(c.id, `${c.name} (${c.color})`)));
  }

  populateHostWorldSelect() {
    const select = document.getElementById('host-world-select');
    if (!select) return;
    select.innerHTML = '';
    const wm = this.deps.worldManager;
    const worlds = wm ? wm.getAllWorlds() : [];

    if (worlds.length === 0) {
      select.appendChild(this._option('', 'No worlds — create one below'));
      return;
    }
    worlds.forEach(w => select.appendChild(this._option(w.id, `${w.name} (seed: ${WorldManager.formatSeed(w.seed)})`)));
  }

  populateBrowseCharacterSelect() {
    const select = document.getElementById('browse-character-select');
    if (!select) return;
    select.innerHTML = '';
    const cm = this.deps.characterManager;
    const characters = cm ? cm.getAllCharacters() : [];

    if (characters.length === 0) {
      select.appendChild(this._option('', 'No characters — create one below'));
      return;
    }
    characters.forEach(c => select.appendChild(this._option(c.id, c.name)));
  }

  _option(value, text) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = text;
    return opt;
  }

  // ── Session list ──────────────────────────────────────────────────────

  /**
   * Render the browsable session list. Called by `SessionManager` through a delegate in
   * `main.js`, not from this file.
   *
   * @param {Array} sessions
   */
  renderSessionList(sessions) {
    const container = this.ui.sessionUI.sessionList;
    const noMsg = this.ui.sessionUI.noSessionsMsg;
    if (!container) return;

    container.innerHTML = '';

    if (!sessions || sessions.length === 0) {
      if (noMsg) noMsg.classList.remove('hidden');
      return;
    }
    if (noMsg) noMsg.classList.add('hidden');

    sessions.forEach(session => {
      const item = document.createElement('div');
      item.className = 'session-item';
      const playerCount = session.players || 0;
      const maxPlayers = session.maxPlayers || 4;
      const mode = session.mode || 'survival';
      const isFull = playerCount >= maxPlayers;

      item.innerHTML = `
        <div class="session-info">
          <div class="session-name">${escapeHtml(session.name)}</div>
          <div class="session-details">${mode.charAt(0).toUpperCase() + mode.slice(1)} · ${session.seed ? 'Seed: ' + session.seed : ''}</div>
        </div>
        <div class="session-players">
          ${isFull ? '<span style="color:#e74c3c;">Full</span>' : `${playerCount}/${maxPlayers}`}
        </div>
      `;

      if (!isFull) {
        item.addEventListener('click', () => this._joinSession(session, mode));
      } else {
        item.style.opacity = '0.5';
        item.style.cursor = 'not-allowed';
      }

      container.appendChild(item);
    });
  }

  async _joinSession(session, mode) {
    const sm = this.deps.sessionManager;
    if (!sm) return;

    const browseCharSelect = document.getElementById('browse-character-select');
    const characterId = browseCharSelect ? browseCharSelect.value : '';
    if (!characterId) {
      alert('Please select or create a character to play as.');
      return;
    }
    await this.deps.characterManager.selectCharacter(characterId);

    // For joining, stand up a temporary world carrying the session's seed so
    // `startGame()` has something to generate local chunks against. The host's world
    // state is authoritative; this exists only for local rendering. It is pushed straight
    // onto `worldManager.worlds` rather than created through `createWorld`, so it is never
    // persisted — which is the intent, and is why it does not consume one of the three
    // world slots.
    const wm = this.deps.worldManager;
    const sessionSeed = session.seed || Math.floor(Math.random() * 0xFFFFFFFF);
    if (!wm.selectedId || !wm.getSelectedWorld()) {
      const tempWorld = {
        id: `temp_${session.sessionId}`,
        name: session.name || 'Remote World',
        seed: sessionSeed,
        biomeMap: { dominantBiomes: ['Plains'], seed: sessionSeed },
        questProgress: {},
        chunkReferences: [],
      };
      wm.worlds.push(tempWorld);
      wm.selectedId = tempWorld.id;
    }

    // PR 16 — the session's real identity goes in with the join. `JOIN_ACCEPTED` carries
    // neither `mode` nor `name` (server/matchmaking.js), so this is the **only** point at
    // which a joiner's client can know what it is joining. Before PR 16 nothing carried it
    // and the rejoin record hard-coded `'survival'` — `BUGS.md` D-43.
    await sm.joinSession(session.sessionId, { mode, name: session.name, seed: sessionSeed });
    this.deps.log(`[SessionManager] Starting game in ${mode} mode (joining)`);
    console.log('[JOIN] joinSession called, waiting for game session connect...');
    this.deps.startGame(mode);
  }

  // ── Host error banner (called by SessionManager through main.js) ──────

  showHostError(message) {
    const errorEl = document.getElementById('host-error');
    if (!errorEl) return;
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }

  hideHostError() {
    const errorEl = document.getElementById('host-error');
    if (errorEl) errorEl.classList.add('hidden');
  }
}
