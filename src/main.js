/**
 * Cuubz — Main Entry Point
 * Menu system, play/host/join flow, screen management, character & world management.
 */

import * as THREE from 'three';
import { CHUNK_D, CHUNK_W, ChunkManager } from './engine/world/ChunkManager.js';
import { Player } from './game/entities/Player.js';
import { BlockInteraction } from './game/systems/BlockInteractionSystem.js';
import { KeyboardInput } from './engine/input/Keyboard.js';
import { MouseInput } from './engine/input/Mouse.js';
import { TouchInput } from './engine/input/Touch.js';
import { MobIntegration } from './game/mobs/mobIntegration.js';
import { ChunkCompressor, ChunkStreamer } from './multiplayer/ChunkStreamer.js';
import { MultiplayerClient } from './multiplayer/Client.js';
import { HostManager } from './multiplayer/Host.js';
import { InventorySync } from './multiplayer/InventorySync.js';
import { PlayerListHUD } from './multiplayer/PlayerListHUD.js';
import { PlayerSyncManager } from './multiplayer/PlayerSync.js';
import { BiomeEffects } from './engine/renderer/BiomeEffects.js';
import { FirstPersonHand } from './engine/renderer/FirstPersonHand.js';
import { ItemTextureAtlas } from './engine/renderer/ItemTextureAtlas.js';
import { PerformanceSettings } from './engine/renderer/PerformanceSettings.js';
import { Skybox } from './engine/renderer/SkyRenderer.js';
import { PBRTextureAtlas } from './engine/renderer/TextureAtlas.js';
import { VoxelRenderer } from './engine/renderer/VoxelRenderer.js';
import { CraftingSystem } from './game/systems/CraftingSystem.js';
import { EQUIPMENT_SLOT_ORDER, Inventory, NAMED_ITEMS } from './game/systems/InventorySystem.js';
import { CuubzLogger } from './util/Logger.js';
import { BiomeSystem, computeHumidityMap } from './engine/world/BiomeSystem.js';
import { BLOCK_BY_ID, BLOCK_TYPES } from './engine/world/BlockRegistry.js';
import { Chunk, MAX_Y, MIN_Y, SEA_LEVEL } from './engine/world/ChunkData.js';
import { PersistenceManager } from './engine/world/Persistence.js';
// PR 14 — the reconcile (refactor.md §3.4, §8.1). `main.js` carried its own
// `BrowserCharacterManager` / `BrowserWorldManager` and never used these two, which have
// the only test coverage either class has. Option A: the tested classes win, the browser
// copies are deleted, and the browser-only behaviour they carried (world chunk cleanup)
// moved to `PersistenceManager.deleteWorld()`. The full ruling is refactor.md §8.1.
import { CharacterManager } from './game/entities/CharacterManager.js';
import { WorldManager } from './game/entities/WorldManager.js';
// `js/game.js` published its class as the global `window.CuubzGame`; main.js has always
// constructed it under that name. The alias keeps the call site (`new CuubzGame()`)
// byte-identical while the binding becomes an ordinary import. PR 17 rewrites both.
import { Game as CuubzGame } from './core/Game.js';
import { GameState } from './core/GameState.js';
// Test-only: hands the live GameState to the e2e harness. No game code reads it back.
import { publishGameState } from './testBridge.js';
// PR 15 — the UI layer (refactor.md §8.2, §13). `screens`, `modals`, `sessionUI`,
// `showScreen` and the four screen objects moved out of this file. The screens read
// the managers through the live-getter `uiDeps` object below, because every one of
// them is a `let` here that is still null when the UI is constructed.
import { UIManager } from './ui/UIManager.js';
import { CharacterScreen } from './ui/screens/CharacterScreen.js';
import { LobbyScreen } from './ui/screens/LobbyScreen.js';
import { SettingsScreen } from './ui/screens/SettingsScreen.js';
import { WorldScreen } from './ui/screens/WorldScreen.js';
import { escapeHtml } from './util/HTMLUtils.js';

(function() {
  'use strict';

  // Debug logging — set CuubzLogger.DEBUG = true in browser console to enable
  const _log = typeof CuubzLogger !== 'undefined' ? CuubzLogger.log : function() {};

  // ============================================================
  // Screen Management — PR 15
  // ============================================================
  //
  // `screens`, `modals`, `sessionUI` and `showScreen()` are `UIManager`'s now. The four
  // aliases below keep the ~40 call sites in this file byte-identical while the rest of
  // Phase 3 moves them out; PR 19 deletes the aliases with the last of their readers.

  /** @type {UIManager} */
  let ui = null;
  let screens = null;
  let sessionUI = null;
  function showScreen(name) { ui.show(name); }

  // PR 14 — `BrowserCharacterManager` (~130 lines) and its four constants stood here.
  // Deleted; `CharacterManager` from src/game/entities/ is imported above. See the
  // reconcile note on that import and refactor.md §8.1.

  // Global reference for game engine access
  let characterManager = null;
  let worldManager = null;
  let perfSettings = null; // PerformanceSettings instance
  let game = null; // CuubzGame instance (set in startGame)
  // PR 12 — the landing zone for the render-loop closure locals (refactor.md §1.6).
  // Created at the top of startGame()'s body, one per session. Everything that used to
  // be assigned ad-hoc onto `game` (chunkManager, renderer, skybox, frameCount, …) is a
  // declared field on this object; `gameState.game` is the CuubzGame instance above.
  // Null until the first startGame(), exactly as `game` is — every reader guards for it.
  let gameState = null;
  let _renderRafId = null;      // Track render loop rAF for cleanup on exit
  let _cleanupPauseMenu = null; // Cleanup function returned by setupPauseMenu()
  let mobIntegration = null; // Mob system instance

  /**
   * PR 15 — what the extracted UI reads this file's state through.
   *
   * Every field above is a `let` that is **null when `UIManager` is constructed** and
   * assigned later, inside `init()` or `startGame()`. A screen that captured
   * `characterManager` by value at construction would hold a permanent `null`, so this
   * object exposes them as getters and a screen reads through at the moment it needs
   * one. It is a deliberate bridge, and the smallest available: the alternative is
   * rewriting ~110 references in this file onto a context object in the same PR that
   * moves 700 lines of DOM code. **PR 17 and PR 19 delete these `let`s** when they
   * become fields on `Game` and `GameState`, and this object goes with them.
   */
  const uiDeps = {
    get characterManager() { return characterManager; },
    get worldManager() { return worldManager; },
    get perfSettings() { return perfSettings; },
    get sessionManager() { return sessionManager; },
    get gameState() { return gameState; },
    startGame: (mode) => startGame(mode),
    rebuildAtlasAndMaterials: (renderer, chunkManager) => rebuildAtlasAndMaterials(renderer, chunkManager),
    updateRejoinPanel: () => updateRejoinPanel(),
    log: (msg) => _log(msg),
  };

  // ============================================================
  // Character and World UI — PR 15
  // ============================================================
  //
  // `renderCharacterSlots`, `createCharacterSlotElement`, `escapeHtml`, `editingCharId`,
  // the character create/edit/delete modals, `renderWorldSlots`,
  // `createWorldSlotElement` and the world create/delete modals stood here — ~330 lines.
  // They are `src/ui/screens/CharacterScreen.js` and `WorldScreen.js`; `escapeHtml` is
  // `src/util/HTMLUtils.js`. `syncPerfSettingsUI` went to `SettingsScreen.js`.
  //
  // One delegate survives, and only because a caller outside the UI still names it:
  // `setupPauseMenu` syncs the performance controls, and that is PR 19's to move.
  // `renderCharacterSlots` and `renderWorldSlots` have NO remaining caller here — every
  // one of them was inside `initMenuNavigation` or a slot click handler, and both moved.
  function syncPerfSettingsUI() { ui.settings.syncUI(); }

  // ============================================================
  // Performance Settings Helpers
  // ============================================================

  /**
   * Apply performance settings to the live game engine.
   * @param {VoxelRenderer} renderer
   * @param {ChunkManager} chunkManager
   * @param {PBRTextureAtlas} textureAtlas
   */
  function applyPerfSettings(renderer, chunkManager, textureAtlas) {
    if (!perfSettings || !renderer) return;
    const s = perfSettings.get();

    // 1. Render distance (cheap)
    if (chunkManager) {
      chunkManager.setRenderDistance(s.renderDistance);
    }

    // 2. Shadow quality (cheap)
    renderer.setShadowQuality(s.shadowQuality);

    console.log(`[PerfSettings] Applied: rd=${s.renderDistance}, shadows=${s.shadowQuality}, tex=${s.textureResolution}, shading=${s.advancedShading}`);
  }

  /**
   * Rebuild texture atlas and materials when expensive settings change.
   * @param {VoxelRenderer} renderer
   * @param {ChunkManager} chunkManager
   * @returns {Promise<PBRTextureAtlas>}
   */
  async function rebuildAtlasAndMaterials(renderer, chunkManager) {
    if (!perfSettings || !renderer) return null;
    const s = perfSettings.get();

    const tileSize = PerformanceSettings.getTileSize(s.textureResolution);

    // Build new atlas with new tile size
    const newAtlas = new PBRTextureAtlas({ tileSize });
    await newAtlas.buildAtlas();

    // Rebuild PBR factory with new atlas + shading mode
    renderer.rebuildPBRFactory(newAtlas, s.advancedShading);

    // CRITICAL: Update chunk manager's atlas reference AND invalidate UV cache.
    // Without this, mesh rebuilds will compute UV coordinates against the OLD
    // atlas layout, causing UV mismatch with the new atlas textures → black
    // seam lines and corner dots from sampling gap pixels.
    if (chunkManager) {
      chunkManager.textureAtlas = newAtlas;
      chunkManager._uvLookupCache = null; // Force UV cache rebuild on next mesh build
      chunkManager.rebuildAllMeshes();
    }

    console.log(`[PerfSettings] Atlas rebuilt: tileSize=${tileSize}, advancedShading=${s.advancedShading}`);
    return newAtlas;
  }

  // ============================================================
  // Menu Navigation
  // ============================================================

  /**
   * PR 15 — this was ~500 lines wiring every screen in the game. The screen-specific
   * halves are `UIManager.initNavigation()` and the four screens' own `init()`.
   *
   * What is left is what does not belong to a screen: constructing the UI, the rejoin
   * buttons and `beforeunload`, which are **PR 16's** (§8.3 — `SessionManager` owns
   * `REJOIN_STORAGE_KEY`, the rejoin panel and the five `cuubz_last_session` sites).
   */
  function initMenuNavigation() {
    try {
      ui = new UIManager(uiDeps);
      screens = ui.screens;
      sessionUI = ui.sessionUI;
      ui.registerScreens({
        character: new CharacterScreen(ui),
        world: new WorldScreen(ui),
        lobby: new LobbyScreen(ui),
        settings: new SettingsScreen(ui),
      });
      ui.initNavigation();

      // ─── Rejoin panel (PR 16 takes these with SessionManager) ───
      const btnRejoin = document.getElementById('btn-rejoin-session');
      if (btnRejoin) {
        btnRejoin.addEventListener('click', async () => { await rejoinSession(); });
      }

      const btnClearRejoin = document.getElementById('btn-clear-rejoin');
      if (btnClearRejoin) {
        btnClearRejoin.addEventListener('click', () => {
          clearLastSession();
          updateRejoinPanel();
        });
      }

      initSessionUI();

      // ─── Save session state before page unload (F5, tab close, etc.) ───
      // If the user refreshes while in a session we can auto-rejoin rather than
      // dropping them back to the main menu.
      window.addEventListener('beforeunload', () => {
        try {
          if (sessionManager && sessionManager.hostingSessionId) {
            const world = worldManager ? worldManager.getSelectedWorld() : null;
            const char = characterManager ? characterManager.getSelectedCharacter() : null;
            localStorage.setItem('cuubz_last_session', JSON.stringify({
              sessionId: sessionManager.hostingSessionId,
              name: document.getElementById('host-session-name')?.value || 'My Session',
              mode: document.getElementById('host-mode-select')?.value || 'survival',
              seed: world ? world.seed : null,
              isHost: true,
              characterId: char ? char.id : null,
              worldId: world ? world.id : null,
              timestamp: Date.now(),
            }));
          } else if (sessionManager && sessionManager.currentSessionId) {
            localStorage.setItem('cuubz_last_session', JSON.stringify({
              sessionId: sessionManager.currentSessionId,
              name: 'Joined Session',
              mode: 'survival',
              isHost: false,
              characterId: characterManager ? characterManager.selectedId : null,
              timestamp: Date.now(),
            }));
          }
        } catch (e) { /* ignore localStorage errors */ }
      });

      _log('[Cuubz] initMenuNavigation complete');
    } catch (e) {
      console.error('[Cuubz] initMenuNavigation CRASHED:', e.message, '\n', e.stack);
    }
  }

  // ============================================================
  // Session UI Management
  // ============================================================

  let sessionManager = null;

  // PR 15 — `switchLobbyTab` and the three `populate*Select` functions are
  // `src/ui/screens/LobbyScreen.js`, with no delegate: every caller was a lobby control
  // and moved with them. `SessionManager` below does NOT call them, which was worth
  // checking rather than assuming — `renderSessionList`, `showHostError` and
  // `hideHostError` are the only three it reaches back into the UI for.

  /**
   * Update connection status indicator in lobby and HUD.
   * @param {'disconnected'|'connecting'|'connected'|'reconnecting'} status
   */
  function updateConnectionStatus(status) {
    const statusTexts = {
      disconnected: 'Disconnected',
      connecting: 'Connecting...',
      connected: 'Connected',
      reconnecting: 'Reconnecting...',
    };

    // Lobby connection status
    if (sessionUI.connectionStatus) {
      sessionUI.connectionStatus.className = `connection-status ${status}`;
      const textEl = sessionUI.connectionStatus.querySelector('.status-text');
      if (textEl) textEl.textContent = statusTexts[status] || status;
    }

    // In-game connection HUD
    if (sessionUI.connectionHud) {
      sessionUI.connectionHud.className = `connection-hud ${status}`;
      const hudText = sessionUI.connectionHud.querySelector('.status-text');
      if (hudText) hudText.textContent = statusTexts[status] || status;
    }
  }

  /**
   * Render the session list in browse panel.
   * @param {Array} sessions — Array of session objects from server
   */
  // PR 15 — the body is `LobbyScreen.renderSessionList`. `SessionManager` calls this
  // name in two places; PR 16 moves that class and the delegate goes with it.
  function renderSessionList(sessions) { ui.lobby.renderSessionList(sessions); }

  /**
   * Render the in-game player list overlay.
   * @param {Array} players — Array of player objects with name, color, health
   */
  function renderPlayerList(players) {
    const overlay = sessionUI.playerListOverlay;
    const itemsContainer = sessionUI.playerListItems;
    const countEl = sessionUI.playerCount;

    if (!overlay || !itemsContainer) return;

    // Show overlay when in multiplayer game
    overlay.classList.remove('hidden');
    itemsContainer.innerHTML = '';

    if (countEl) {
      countEl.textContent = players ? players.length : 0;
    }

    if (!players || players.length === 0) return;

    players.forEach(player => {
      const item = document.createElement('div');
      item.className = 'player-list-item';

      const healthPercent = player.health !== undefined ? Math.max(0, Math.min(100, player.health)) : 100;
      const healthColor = healthPercent > 60 ? '#4CAF50' : healthPercent > 30 ? '#f1c40f' : '#e74c3c';

      // Position info
      let posHtml = '';
      if (player.position) {
        const px = Math.round(player.position.x);
        const py = Math.round(player.position.y);
        const pz = Math.round(player.position.z);
        posHtml = `<span class="player-list-item-pos">(${px}, ${py}, ${pz})</span>`;
      }

      item.innerHTML = `
        <div class="player-list-item-header">
          <span class="player-color-dot" style="background:${escapeHtml(player.color || '#ffffff')}"></span>
          <span class="player-name-text">${escapeHtml(player.name || 'Player')}</span>
          <div class="player-health-bar">
            <div class="player-health-fill" style="width:${healthPercent}%;background:${healthColor};"></div>
          </div>
        </div>
        ${posHtml}
      `;

      itemsContainer.appendChild(item);
    });
  }

  /**
   * Hide the in-game player list overlay.
   */
  function hidePlayerList() {
    if (sessionUI.playerListOverlay) {
      sessionUI.playerListOverlay.classList.add('hidden');
    }
    if (sessionUI.connectionHud) {
      sessionUI.connectionHud.classList.add('hidden');
    }
  }

  // ============================================================
  // Session Rejoin
  // ============================================================

  const REJOIN_STORAGE_KEY = 'cuubz_last_session';
  const REJOIN_MAX_AGE = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Get the last saved session from localStorage.
   * Returns null if no session or session is too old.
   */
  function getLastSession() {
    try {
      const raw = localStorage.getItem(REJOIN_STORAGE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw);
      if (!data || !data.sessionId) return null;
      // Expire sessions older than 24 hours
      if (Date.now() - data.timestamp > REJOIN_MAX_AGE) {
        localStorage.removeItem(REJOIN_STORAGE_KEY);
        return null;
      }
      return data;
    } catch (e) {
      return null;
    }
  }

  /**
   * Clear the saved session from localStorage.
   */
  function clearLastSession() {
    try { localStorage.removeItem(REJOIN_STORAGE_KEY); } catch (e) {}
  }

  /**
   * Update the rejoin panel visibility and content.
   */
  function updateRejoinPanel() {
    const panel = document.getElementById('rejoin-panel');
    const nameEl = document.getElementById('rejoin-session-name');
    if (!panel) return;

    const session = getLastSession();
    if (session) {
      panel.classList.remove('hidden');
      if (nameEl) {
        nameEl.textContent = `${session.name} (${session.isHost ? 'hosting' : 'joined'}, ${session.mode})`;
      }
    } else {
      panel.classList.add('hidden');
    }
  }

  /**
   * Rejoin the last session.
   */
  async function rejoinSession() {
    const session = getLastSession();
    if (!session) return;

    // Ensure character is selected (use first available if none)
    const characters = characterManager ? characterManager.getAllCharacters() : [];
    if (characters.length > 0) {
      await characterManager.selectCharacter(characters[0].id);
    }

    // Ensure world is selected
    if (session.isHost && session.seed) {
      // For re-hosting, find or create a world with the session's seed
      const worlds = worldManager ? worldManager.getAllWorlds() : [];
      const existingWorld = worlds.find(w => w.seed === session.seed);
      if (existingWorld) {
        await worldManager.selectWorld(existingWorld.id);
      } else if (worlds.length > 0) {
        await worldManager.selectWorld(worlds[0].id);
      }
    } else if (!session.isHost && session.seed) {
      // For re-joining, create temp world with session seed
      const tempWorld = {
        id: `temp_${session.sessionId}`,
        name: session.name || 'Remote World',
        seed: session.seed,
        biomeMap: { dominantBiomes: ['Plains'], seed: session.seed },
        questProgress: {},
        chunkReferences: [],
      };
      worldManager.worlds.push(tempWorld);
      worldManager.selectedId = tempWorld.id;
    } else if (worldManager && worldManager.getAllWorlds().length > 0) {
      await worldManager.selectWorld(worldManager.getAllWorlds()[0].id);
    }

    if (!sessionManager) {
      // Initialize session manager if needed
      sessionManager = new SessionManager();
      const relayUrl = getRelayUrl();
      sessionManager.init(relayUrl);
    }

    updateConnectionStatus('connecting');

    if (session.isHost && sessionManager.client) {
      // Re-host the session
      try {
        await sessionManager.client.hostSession({
          name: session.name,
          seed: session.seed || Math.floor(Math.random() * 0xFFFFFFFF),
          mode: session.mode,
        });
        _log(`[Cuubz] Re-hosting session: ${session.name}`);
      } catch (err) {
        updateConnectionStatus('disconnected');
        showHostError(`Failed to re-host: ${err.message}`);
      }
    } else if (sessionManager.client) {
      // Re-join the session
      try {
        await sessionManager.joinSession(session.sessionId);
        _log(`[Cuubz] Re-joining session: ${session.sessionId}`);
      } catch (err) {
        updateConnectionStatus('disconnected');
        showHostError(`Failed to rejoin: ${err.message}`);
      }
    }

    // Start the game
    startGame(session.mode || 'survival');
  }

  /**
   * SessionManager — Handles multiplayer session lifecycle in the browser.
   * Wraps MultiplayerClient for UI integration.
   */
  class SessionManager {
    constructor() {
      this.client = null; // MultiplayerClient instance (created when connecting)
      this.sessions = [];
      this.currentSessionId = null;
      this.hostingSessionId = null;
      this.players = [];
      this._browseCallback = null;
      this._hostCreatedCallback = null;
      this._joinAcceptedCallback = null;
      this._joinRejectedCallback = null;
      this._playerJoinedCallback = null;
      this._playerLeftCallback = null;
    }

    /**
     * Initialize the WebSocket client for matchmaking.
     * @param {string} serverUrl — WebSocket URL for matchmaking (e.g., ws://localhost:8765)
     */
    init(serverUrl) {
      this._serverUrl = serverUrl || 'ws://localhost:8765';

      if (typeof MultiplayerClient !== 'undefined') {
        this.client = new MultiplayerClient({ url: this._serverUrl });
        this._wireClientEvents();
      } else {
        console.warn('[SessionManager] MultiplayerClient not loaded — offline mode');
      }
    }

    /** Wire up client events to UI updates */
    _wireClientEvents() {
      if (!this.client) return;

      this.client.on('SESSION_LIST', (data) => {
        this.sessions = data.sessions || [];
        renderSessionList(this.sessions);
        if (this._browseCallback) this._browseCallback(this.sessions);
      });

      this.client.on('HOST_CREATED', (data) => {
        this.hostingSessionId = data.sessionId;
        updateConnectionStatus('connected');
        // Persist session for rejoin
        try {
          localStorage.setItem('cuubz_last_session', JSON.stringify({
            sessionId: data.sessionId,
            name: data.name || 'My Session',
            mode: data.mode || 'survival',
            isHost: true,
            timestamp: Date.now(),
          }));
        } catch (e) { /* ignore localStorage errors */ }
        updateRejoinPanel();
        if (this._hostCreatedCallback) this._hostCreatedCallback(data);
      });

      this.client.on('JOIN_ACCEPTED', (data) => {
        this.currentSessionId = data.sessionId;
        updateConnectionStatus('connected');
        // Persist session for rejoin
        try {
          localStorage.setItem('cuubz_last_session', JSON.stringify({
            sessionId: data.sessionId,
            name: data.name || 'Joined Session',
            mode: data.mode || 'survival',
            isHost: false,
            timestamp: Date.now(),
          }));
        } catch (e) { /* ignore localStorage errors */ }
        updateRejoinPanel();
        if (this._joinAcceptedCallback) this._joinAcceptedCallback(data);
      });

      this.client.on('JOIN_REJECTED', (data) => {
        const reason = data.reason || 'Unknown error';
        showHostError(`Join failed: ${reason}`);
        if (this._joinRejectedCallback) this._joinRejectedCallback(data);
      });

      this.client.on('PLAYER_JOINED', (data) => {
        this.players.push({
          id: data.playerId,
          name: data.character?.name || 'Player',
          color: data.character?.color || '#888888',
          health: data.health !== undefined ? data.health : 100,
          position: data.position,
        });
        renderPlayerList(this.players);
        if (this._playerJoinedCallback) this._playerJoinedCallback(data);
      });

      this.client.on('PLAYER_LEFT', (data) => {
        this.players = this.players.filter(p => p.id !== data.playerId);
        renderPlayerList(this.players);
        if (this._playerLeftCallback) this._playerLeftCallback(data);
      });

      this.client.on('disconnect', () => {
        updateConnectionStatus('disconnected');
      });

      this.client.on('stateChange', (data) => {
        const statusMap = {
          disconnected: 'disconnected',
          connecting: 'connecting',
          connected: 'connected',
          reconnecting: 'reconnecting',
        };
        updateConnectionStatus(statusMap[data.to] || 'disconnected');
      });

      // Connect to matchmaking server
      this.client.connectMatchmaking();
    }

    /** Browse available sessions */
    browseSessions() {
      if (this.client) {
        this.client.browseSessions();
      } else {
        // Offline mode — show empty list
        renderSessionList([]);
      }
    }

    /**
     * Start hosting a multiplayer session.
     * Validates form inputs, sets character/world selection, creates the session on the server.
     * @param {Object} [options] — Optional configuration
     * @param {Function} [options.onBlockBreakValidated] — Called when remote player breaks block (host marks chunk dirty)
     * @param {Function} [options.onBlockPlaceValidated] — Called when remote player places block (host marks chunk dirty)
     */
    async startHosting(options = {}) {
      const nameInput = document.getElementById('host-session-name');
      const worldSelect = document.getElementById('host-world-select');
      const characterSelect = document.getElementById('host-character-select');
      const modeSelect = document.getElementById('host-mode-select');
      const maxPlayersSlider = document.getElementById('host-max-players');

      hideHostError();

      // Validate session name
      const name = nameInput ? nameInput.value.trim() : '';
      if (!name) {
        showHostError('Please enter a session name.');
        return;
      }
      if (name.length > 32) {
        showHostError('Session name must be 32 characters or less.');
        return;
      }

      // Validate character selection (required for hosting)
      const characterId = characterSelect ? characterSelect.value : '';
      if (!characterId) {
        showHostError('Please select or create a character to play as.');
        return;
      }
      const selectedCharacter = characterManager ? characterManager.getCharacter(characterId) : null;
      if (!selectedCharacter) {
        showHostError('Selected character not found.');
        return;
      }

      // Validate world selection
      const worldId = worldSelect ? worldSelect.value : '';
      if (!worldId) {
        showHostError('Please select or create a world to host.');
        return;
      }
      const selectedWorld = worldManager ? worldManager.getWorld(worldId) : null;
      if (!selectedWorld) {
        showHostError('Selected world not found.');
        return;
      }

      // Wire up character and world selection so startGame() finds them.
      // This is critical: startGame() checks characterManager.getSelectedCharacter()
      // and worldManager.getSelectedWorld(), which rely on selectedId.
      await characterManager.selectCharacter(characterId);
      await worldManager.selectWorld(worldId);
      _log(`[SessionManager] Selected character: ${selectedCharacter.name}, world: ${selectedWorld.name}`);

      const mode = modeSelect ? modeSelect.value : 'survival';
      const maxPlayers = parseInt(maxPlayersSlider ? maxPlayersSlider.value : '4', 10);

      updateConnectionStatus('connecting');

      if (this.client) {
        try {
          await this.client.hostSession({
            name,
            seed: selectedWorld.seed,
            mode,
            maxPlayers,
          });
          _log(`[SessionManager] Hosting session: ${name}`);
        } catch (err) {
          updateConnectionStatus('disconnected');
          showHostError(`Failed to host: ${err.message}`);
          return;
        }
      } else {
        // Offline simulation
        this.hostingSessionId = `session_${Date.now()}`;
        updateConnectionStatus('connected');
        _log(`[SessionManager] Simulated hosting: ${name} (offline)`);
      }

      // Start the game loop after session is created
      _log(`[SessionManager] Starting game in ${mode} mode (hosting)`);
      this._gameMode = mode; // Store for auto-rejoin
      startGame(mode);

      // ─── Initialize HostManager for server-authoritative validation ───
      // HostManager validates all remote player actions (movement, blocks, inventory).
      // It is wired in startGame() after the chunk manager is ready.
      if (typeof HostManager !== 'undefined' && this.client) {
        this._hostManager = new HostManager({ client: this.client });
        this._hostManager.onPlayerJoined = (data) => {
          _log(`[HostManager] Player joined: ${data.playerId} (${data.character?.name})`);
        };
        this._hostManager.onPlayerLeft = (data) => {
          _log(`[HostManager] Player left: ${data.playerId}`);
        };
        _log('[SessionManager] HostManager initialized for server-authoritative validation');
      }

      // Wire up block validation callbacks for host persistence to IndexedDB.
      // These fire when remote players break/place blocks — the host validates via relay,
      // then marks chunks dirty so they get flushed to ChunkStore on next interval.
      if (this.client) {
        const { onBlockBreakValidated, onBlockPlaceValidated } = options;

        if (onBlockBreakValidated) {
          this.client.onGame('BLOCK_BREAK', (data) => {
            try {
              onBlockBreakValidated(data);
            } catch (err) {
              console.error('[SessionManager] Error in BLOCK_BREAK handler:', err.message);
            }
          });
        }

        if (onBlockPlaceValidated) {
          this.client.onGame('BLOCK_PLACE', (data) => {
            try {
              onBlockPlaceValidated(data);
            } catch (err) {
              console.error('[SessionManager] Error in BLOCK_PLACE handler:', err.message);
            }
          });
        }

        _log('[SessionManager] Host block validation callbacks wired');
      }
    }

    /**
     * Join an existing session by its ID.
     * @param {string} sessionId
     */
    async joinSession(sessionId) {
      if (!sessionId) return;

      updateConnectionStatus('connecting');

      if (this.client) {
        try {
          await this.client.joinSession(sessionId);
          _log(`[SessionManager] Joined session: ${sessionId}`);
        } catch (err) {
          updateConnectionStatus('disconnected');
          showHostError(`Failed to join: ${err.message}`);
        }
      } else {
        // Offline simulation
        this.currentSessionId = sessionId;
        updateConnectionStatus('connected');
        _log(`[SessionManager] Simulated joining: ${sessionId} (offline)`);
      }
    }

    /** Leave the current session */
    leaveSession() {
      if (this.client) {
        this.client.leaveSession();
      }
      this.currentSessionId = null;
      this.hostingSessionId = null;
      this.players = [];
      updateConnectionStatus('disconnected');
      hidePlayerList();
    }

    /**
     * Register host-side block validation callbacks after game session starts.
     * Called from startGame() when chunkManager and dirtyFlush are available.
     * @param {Function} onBlockBreakValidated — (data: {x, y, z, chunkX, chunkZ}) => void
     * @param {Function} onBlockPlaceValidated — (data: {x, y, z, blockType, chunkX, chunkZ}) => void
     */
    registerHostCallbacks(onBlockBreakValidated, onBlockPlaceValidated) {
      if (!this.client || !this.hostingSessionId) return;

      if (onBlockBreakValidated) {
        this.client.onGame('BLOCK_BREAK', (data) => {
          try {
            onBlockBreakValidated(data);
          } catch (err) {
            console.error('[SessionManager] Error in BLOCK_BREAK handler:', err.message);
          }
        });
      }

      if (onBlockPlaceValidated) {
        this.client.onGame('BLOCK_PLACE', (data) => {
          try {
            onBlockPlaceValidated(data);
          } catch (err) {
            console.error('[SessionManager] Error in BLOCK_PLACE handler:', err.message);
          }
        });
      }

      _log('[SessionManager] Host callbacks registered for IndexedDB persistence');
    }

    /**
     * Register client-side block delta callbacks after game session starts.
     * Called from startGame() when joining a session (not hosting).
     * Applies remote deltas visually without persisting to IndexedDB — only the host persists.
     * @param {Function} onBlockBreak — (data: {x, y, z, chunkX, chunkZ}) => void
     * @param {Function} onBlockPlace — (data: {x, y, z, blockType, chunkX, chunkZ}) => void
     */
    registerClientCallbacks(onBlockBreak, onBlockPlace) {
      if (!this.client || !this.currentSessionId || this.hostingSessionId) return;

      if (onBlockBreak) {
        this.client.onGame('BLOCK_BREAK', (data) => {
          try {
            onBlockBreak(data);
          } catch (err) {
            console.error('[SessionManager] Error in client BLOCK_BREAK handler:', err.message);
          }
        });
      }

      if (onBlockPlace) {
        this.client.onGame('BLOCK_PLACE', (data) => {
          try {
            onBlockPlace(data);
          } catch (err) {
            console.error('[SessionManager] Error in client BLOCK_PLACE handler:', err.message);
          }
        });
      }

      _log('[SessionManager] Client delta callbacks registered (visual only, no persistence)');
    }

    /** Dispose and clean up */
    dispose() {
      if (this.client) {
        this.client.dispose();
        this.client = null;
      }
    }
  }

  // PR 15 — bodies in `LobbyScreen`. Twelve call sites, all inside `SessionManager`.
  function showHostError(message) { ui.lobby.showHostError(message); }
  function hideHostError() { ui.lobby.hideHostError(); }

  /**
   * Determine the correct WebSocket relay URL based on page origin.
   * The relay server runs on cuubz-relay.thehomelabguy.com with path-based routing:
   *   /matchmaking  → session discovery
   *   /session/:id  → game session
   * Nginx handles TLS termination — the game never specifies a port.
   *
   * @param {string} [pageOrigin] — Override for testing (e.g., 'https://webgame-cuubz.thehomelabguy.com')
   * @returns {string} WebSocket URL for the matchmaking relay server
   */
  function getRelayUrl(pageOrigin) {
    // Allow override via URL query parameter: ?relayUrl=wss://custom-host
    if (typeof location !== 'undefined' && location.search) {
      const params = new URLSearchParams(location.search);
      const relayOverride = params.get('relayUrl');
      if (relayOverride) return relayOverride;
    }

    // Fixed relay subdomain — works regardless of how the game is accessed.
    // Nginx handles TLS (wss://) and forwards to the relay on port 8765.
    const protocol = (typeof location !== 'undefined' && location.protocol === 'https:') ? 'wss' : 'ws';
    return `${protocol}://cuubz-relay.thehomelabguy.com`;
  }

  /** Initialize session UI — create SessionManager and set defaults */
  function initSessionUI() {
    // Create session manager instance
    sessionManager = new SessionManager();

    // Determine relay URL based on deployment context
    const relayUrl = getRelayUrl();
    _log(`[SessionManager] Relay URL: ${relayUrl}`);

    // Initialize WebSocket client with auto-detected relay URL
    sessionManager.init(relayUrl);

    // Default to disconnected state (will update when connection established)
    updateConnectionStatus('disconnected');

    // Hide in-game overlays by default
    hidePlayerList();

    _log('[SessionManager] Initialized with WebSocket client');
  }

  // ============================================================
  // Game Start
  // ============================================================

  /**
   * Start a session. Fifteen numbered steps, banner-marked below (PR 13).
   *
   * ─── WHAT PR 13 CHANGED ─────────────────────────────────────────────────────
   *
   * The body used to be `setTimeout(async () => { try { … } }, 200)` wrapping ~1,765
   * lines, of which `refactor.md` §1.6 counted 1,845 at ten or more spaces of
   * indentation. There were two such wrappers — the 200 ms one here and a 500 ms one
   * around the render-loop start — and both are now awaited sleeps. **The delays are
   * kept, deliberately:** the first is what gives the loading screen a paint before the
   * WebGL context is created, the second is what lets the last of the init settle before
   * the render loop starts taking the frame budget. They were behaviour, not scaffolding;
   * only the nesting was scaffolding.
   *
   * The step order is **load-bearing** and every banner below sits where the code already
   * put it. Three couplings in particular:
   *
   *   • the texture atlases (4) must be built before anything draws an item icon;
   *   • the chunk manager (7) must have run `checkRegion(0,0)` before the spawn search
   *     (8), which reads `memoryCache`;
   *   • the mob system (9) is constructed before the inventory exists and is handed it in
   *     step 13 — the `inventory: null` in its deps is that, not an oversight.
   *
   * ─── THE NUMBERING vs refactor.md §8.4 ──────────────────────────────────────
   *
   * §8.4 sketches `Game.init()` as fifteen steps and tells PR 17 to "preserve the existing
   * ordering exactly — it is load-order sensitive". **Its list did not match the existing
   * ordering** (BUGS.md D-36): it had multiplayer at 9, the hand at 10 and mobs at 11,
   * where the code runs mobs, then the hand, then multiplayer; and it had inventory before
   * block interaction, where the code does the reverse. PR 13 numbered these banners from
   * the code and corrected §8.4 to match. **If the two ever disagree again, the code is
   * right** — that is the whole reason §8.4 says what it says.
   *
   * PR 17 turns each banner into a private method on `Game`. It is not a mechanical cut
   * yet: the steps share ~160 init-only locals that PR 12 deliberately did not hoist
   * (only the 21 the render loop read). Those move to `GameState` as each step is lifted.
   */
  async function startGame(mode) {
    _log(`[Cuubz] Starting game in ${mode} mode...`);

    const selected = characterManager ? characterManager.getSelectedCharacter() : null;
    if (!selected) {
      console.warn('[Cuubz] No character selected!');
      showScreen('characterScreen');
      return;
    }

    _log(`[Cuubz] Playing as: ${selected.name} (${selected.color})`);

    // Show loading screen
    showScreen('loadingScreen');
    const loadingStatus = document.getElementById('loading-status');
    const loadingProgress = document.getElementById('loading-progress');

    // Get selected world
    const currentWorld = worldManager ? worldManager.getSelectedWorld() : null;
    if (!currentWorld) {
      console.warn('[Cuubz] No world selected!');
      showScreen('worldScreen');
      return;
    }

    loadingStatus.textContent = 'Initializing renderer...';
    if (loadingProgress) loadingProgress.style.width = '10%';

    // PR 13 — the wrapper is gone.
    //
    // Everything below used to sit inside `setTimeout(async () => { try { … } }, 200)`,
    // which is what refactor.md §1.6 means by "1,845 lines at ≥10 spaces". The 200 ms is
    // real behaviour — it is what gives the loading screen a paint before the renderer is
    // constructed — so it stays, as one awaited line rather than a level of nesting.
    //
    // Nothing awaits `startGame()`. The menu handlers and the auto-rejoin path both call
    // it and move on, exactly as they did when the wrapper made it return immediately.
    // The try/catch is therefore load-bearing rather than decorative: without it a throw
    // in here is an unhandled rejection instead of the loading-screen error message.
    await new Promise((resolve) => setTimeout(resolve, 200));

    try {
      // ─── PR 12: one state object per session ──────────────────────────
      //
      // Everything below that `renderLoop` needs is assigned onto this object as it is
      // created. The locals stay as locals — they are read ~700 times across the 1,800
      // lines of init below and rewriting all of those is PR 13/PR 17's job — but each
      // one is a `const` that is never reassigned, so the local and `gameState.x` can
      // never disagree. The two exceptions are handled where they occur:
      //   • the six `let x = null; if (…) x = new X()` systems get their
      //     `gameState.x = x` **after** the block that may assign them, never inside it;
      //   • `inventoryOpen` genuinely mutates at runtime, so it has no local at all and
      //     lives only on `gameState` (BUGS.md D-31).
      gameState = new GameState();
      gameState.currentWorld = currentWorld;
      gameState.currentCharacter = selected;

      // ══ Step 1 — hide screens / show loading ══════════════════════════════════════════════
      // The GameState above belongs to no step; it is the object every step below writes to.

      // Hide all UI screens
      Object.values(screens).forEach(el => { if (el) el.classList.add('hidden'); });

      const container = document.getElementById('game-container');
      container.innerHTML = '';

      // ══ Step 2 — renderer ═════════════════════════════════════════════════════════════════

      // Initialize VoxelRenderer
      loadingStatus.textContent = 'Building 3D scene...';
      if (loadingProgress) loadingProgress.style.width = '30%';

      const renderer = gameState.renderer = new VoxelRenderer(container, window.innerWidth, window.innerHeight);
      _log('[Cuubz] Renderer created');

      // ══ Step 3 — input ════════════════════════════════════════════════════════════════════

      // Initialize Input Systems
      loadingStatus.textContent = 'Setting up controls...';
      if (loadingProgress) loadingProgress.style.width = '40%';

      // No local alias: the render loop was `keyboard`'s only reader.
      gameState.keyboard = new KeyboardInput();
      const touch = gameState.touch = new TouchInput();
      const canvas = gameState.canvas = renderer.domElement;
      const mouse = gameState.mouse = new MouseInput(canvas);

      // Request pointer lock on canvas click
      canvas.addEventListener('click', () => {
        if (!mouse.locked) {
          mouse.requestPointerLock();
        }
      });

      // Initialize Terrain Generation (handled internally by ChunkManager)
      const sensitivity = gameState.sensitivity = 0.002;
      loadingStatus.textContent = 'Initializing workers...';
      if (loadingProgress) loadingProgress.style.width = '50%';

      // ══ Step 4 — texture atlas ════════════════════════════════════════════════════════════
      // Two atlases and both `buildAtlas()` calls are awaited here. Everything downstream
      // that draws an item icon depends on them, which is what makes this order load-bearing.

      // Initialize Texture Atlas (async)
      loadingStatus.textContent = 'Loading textures...';
      if (loadingProgress) loadingProgress.style.width = '60%';

      // Determine tile size from settings
      const perfTexRes = perfSettings ? perfSettings.get('textureResolution') : 'high';
      const tileSize = PerformanceSettings.getTileSize(perfTexRes);
      const textureAtlas = gameState.textureAtlas = new PBRTextureAtlas({ tileSize });
      await textureAtlas.buildAtlas();

      // Build item texture atlas for hotbar/inventory UI
      const itemAtlas = gameState.itemAtlas = new ItemTextureAtlas({ tileSize: 64 });
      await itemAtlas.buildAtlas();

      // ══ Step 5 — PBR + shadows ════════════════════════════════════════════════════════════

      // Initialize PBR material factory with the triple atlas
      const advancedShading = perfSettings ? perfSettings.get('advancedShading') : true;
      renderer.initPBR(textureAtlas, advancedShading);

      // Apply shadow quality from settings
      if (perfSettings) {
        renderer.setShadowQuality(perfSettings.get('shadowQuality'));
      }

      // ══ Step 6 — skybox ═══════════════════════════════════════════════════════════════════

      // ─── Initialize Day/Night Cycle (Skybox) ─────────
      let skybox = null;
      if (typeof Skybox !== 'undefined') {
        skybox = new Skybox(renderer, { startTime: 8, cycleDuration: 300 });
        skybox.init();
        // Wire up the HUD day-night indicator
        const dayNightEl = document.getElementById('day-night-indicator');
        if (dayNightEl) {
          skybox.setNightIndicatorElement(dayNightEl);
        }
        _log('[Cuubz] Day/night cycle initialized (5-min cycle, starting at 8:00)');
      }
      // Assigned after the `if`, never inside it, so `null` (no Skybox) is recorded too.
      gameState.skybox = skybox;

      // Wire up texture atlas to debug overlay (top-right corner)
      const atlasOverlay = document.getElementById('atlas-overlay');
      const atlasCanvasEl = document.getElementById('atlas-canvas');
      if (atlasOverlay && atlasCanvasEl && textureAtlas.diffuseCanvas) {
        const ctx = atlasCanvasEl.getContext('2d');
        const srcW = textureAtlas.diffuseCanvas.width;
        const srcH = textureAtlas.diffuseCanvas.height;

        // Scale canvas to fit nicely in the overlay (max 300px wide)
        const maxDisplayWidth = Math.min(300, window.innerWidth - 40);
        const scale = maxDisplayWidth / srcW;
        atlasCanvasEl.width = Math.round(srcW * scale);
        atlasCanvasEl.height = Math.round(srcH * scale);

        // Draw the atlas scaled down
        ctx.imageSmoothingEnabled = false; // Keep pixelated
        ctx.drawImage(textureAtlas.diffuseCanvas, 0, 0, atlasCanvasEl.width, atlasCanvasEl.height);

        // Draw block ID labels on each tile for visual verification
        const debugInfo = textureAtlas.debugInfo;
        if (debugInfo) {
          ctx.font = `bold ${Math.max(8, Math.round(10 * scale))}px monospace`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          for (const info of debugInfo) {
            const x = info.col * srcW / textureAtlas.gridW;
            const y = info.row * srcH / textureAtlas.gridH;
            const w = srcW / textureAtlas.gridW;
            const h = srcH / textureAtlas.gridH;

            // Draw label background
            ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
            ctx.fillRect(x * scale, y * scale, w * scale, Math.min(h * scale, 14 * scale));

            // Draw block ID text
            ctx.fillStyle = '#ffffff';
            const label = `${info.blockId}_${info.faceName}`;
            ctx.fillText(label, (x + w / 2) * scale, (y + h / 2 - 1) * scale);
          }
        }

        // Draw grid lines
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.lineWidth = 1;
        for (let col = 0; col <= textureAtlas.gridW; col++) {
          const gx = (col * srcW / textureAtlas.gridW) * scale;
          ctx.beginPath();
          ctx.moveTo(gx, 0);
          ctx.lineTo(gx, atlasCanvasEl.height);
          ctx.stroke();
        }
        for (let row = 0; row <= textureAtlas.gridH; row++) {
          const gy = (row * srcH / textureAtlas.gridH) * scale;
          ctx.beginPath();
          ctx.moveTo(0, gy);
          ctx.lineTo(atlasCanvasEl.width, gy);
          ctx.stroke();
        }

        // atlasOverlay stays hidden — remove this line to show debug overlay during gameplay
      // Texture atlas built — no log
      }

      // ══ Step 7 — chunk manager ════════════════════════════════════════════════════════════
      // Also decides host vs joining client, loads or creates the manifest, starts the 5 s
      // flush timer, and runs the initial checkRegion(0,0). The single slowest step.

      // Determine if this is a joining client (not host) — clients don't generate chunks
      const isJoiningClient = sessionManager && sessionManager.currentSessionId && !sessionManager.hostingSessionId;
      console.log(`[JOIN] isJoiningClient=${isJoiningClient} currentSessionId=${sessionManager?.currentSessionId} hostingSessionId=${sessionManager?.hostingSessionId}`);

      // Initialize Chunk Manager (monolith — workers + IndexedDB + flush + region tracking)
      loadingStatus.textContent = 'Loading chunks...';
      if (loadingProgress) loadingProgress.style.width = '85%';

      const worldName = gameState.worldName = currentWorld.id;
      const renderDist = perfSettings ? perfSettings.get('renderDistance') : 8;
      const chunkManager = gameState.chunkManager = new ChunkManager({
        renderer: renderer,
        worldName: worldName,
        worldSeed: currentWorld.seed,
        genParams: {}, // Use defaults from ChunkManager
        renderDistance: renderDist,
        regionRadius: 16,   // 32×32 pre-generation range
        textureAtlas: textureAtlas,
        clientMode: isJoiningClient, // Clients receive all chunks from host
      });

      await chunkManager.init();

      if (isJoiningClient) {
        // Client: no local generation, no IndexedDB, no flush — all chunks come from host
        _log('[Cuubz] Client mode: chunk generation disabled, awaiting chunks from host');
      } else {
        // Host: load existing world or create new manifest
        const manifest = await chunkManager.loadManifest();
        if (!manifest) {
          await chunkManager.createNewWorld();
          _log(`[Cuubz] Created new world manifest for "${worldName}"`);
        } else {
          _log(`[Cuubz] Loaded existing world manifest (${manifest.generatedChunks.length} chunks saved)`);
        }

        // Start timers: flush dirty every 5s
        chunkManager.startFlushTimer(5000);

        // Trigger initial load around spawn position (awaits completion)
        // console.log('[Cuubz] Starting region check at (0, 0)...');
        await chunkManager.checkRegion(0, 0);
        
        // Safety net: drain any remaining generation queue items
        let genWait = 0;
        while ((chunkManager._genQueue.length > 0 || chunkManager._generating.size > 0) && genWait < 30) {
          await new Promise(r => setTimeout(r, 200));
          genWait++;
        }
        // console.log(`[Cuubz] Initial load complete — memoryCache: ${chunkManager.memoryCache.size}, generating: ${chunkManager._generating.size}`);
      }
      
      chunkManager.updateRenderChunks(0, 0);

      // Graceful shutdown handlers
      chunkManager._setupGracefulShutdown();

      // Wire up host block validation callbacks for multiplayer persistence to IndexedDB.
      if (sessionManager && sessionManager.hostingSessionId) {
        const applyRemoteBlockChange = (data, newBlockType) => {
          try {
            chunkManager.applyBlockChange(data.x, data.y, data.z, newBlockType);
          } catch (err) {
            console.error('[Cuubz] Error applying remote block change:', err.message);
          }
        };

        sessionManager.registerHostCallbacks(
          (data) => applyRemoteBlockChange(data, 0),
          (data) => applyRemoteBlockChange(data, data.blockType || 1)
        );
      } else if (sessionManager && sessionManager.currentSessionId) {
        const applyRemoteDelta = (data, newBlockType) => {
          try {
            // Client applies visually without persisting — mark dirty=false after
            chunkManager.applyBlockChange(data.x, data.y, data.z, newBlockType);
            // Clear dirty flag since client shouldn't flush to storage
            const cx = Math.floor(data.x / CHUNK_W);
            const cz = Math.floor(data.z / CHUNK_D);
            const key = ChunkManager.key(cx, cz);
            const chunk = chunkManager.memoryCache.get(key);
            if (chunk) chunk.dirty = false;
          } catch (err) {
            console.error('[Cuubz] Error applying client delta:', err.message);
          }
        };

        sessionManager.registerClientCallbacks(
          (data) => applyRemoteDelta(data, 0),
          (data) => applyRemoteDelta(data, data.blockType || 1)
        );
      }

      // ══ Step 8 — player at spawn ══════════════════════════════════════════════════════════
      // Spawn search reads chunkManager.memoryCache, so it cannot move above step 7.

      // Wait briefly for initial chunks to populate memoryCache, then calculate spawn position
      await new Promise(resolve => setTimeout(resolve, 200));

      // Determine spawn position
      let bestSpawnX = 0, bestSpawnZ = 0, bestSpawnY = -1, bestScore = -Infinity;

      // ─── Client-side: skip spawn search, use default position ───
      // Clients have no chunks at spawn time — host's chunks will stream in.
      // The player will fall to terrain when chunks arrive.
      if (isJoiningClient) {
        bestSpawnX = 0;
        bestSpawnZ = 0;
        bestSpawnY = SEA_LEVEL + 2; // Spawn above sea level, will fall to terrain
        console.log(`[Cuubz] Client spawn: X=${bestSpawnX + 0.5} Y=${bestSpawnY} Z=${bestSpawnZ + 0.5} (no chunks yet, will fall to terrain)`);
      } else {
        // console.log(`[Cuubz] Spawn search: ${chunkManager.memoryCache.size} chunks in cache`);

        // Calculate spawn — search loaded chunks for solid surface with headroom above.
        // Strategy: prefer GRASS/DIRT/SAND near sea level, fall back to any solid block if needed.

        function getBlockAt(chunk, lx, ly, lz) {
          return chunk.getBlock(lx, ly, lz);
        }

        // Surface blocks — prefer these for spawn (natural terrain topside)
        const SURFACE_BLOCKS = new Set([BLOCK_TYPES.GRASS, BLOCK_TYPES.DIRT, BLOCK_TYPES.SAND]);

        // Search only the center 8×8 area (around origin) for spawn.
        // Avoids spawning on edge of the 32×32 pre-generated region where terrain features tend to cluster.
        const spawnSearchRadius = 4; // 8x8 centered on chunk (0,0)

        for (const [key, chunk] of chunkManager.memoryCache) {
          if (!chunk || !chunk.blocks) continue;
          const { cx, cz } = ChunkManager.parseKey(key);

          // Only search within center spawnSearchRadius chunks from origin
          if (Math.abs(cx) > spawnSearchRadius || Math.abs(cz) > spawnSearchRadius) continue;

          for (let lx = 0; lx < 16; lx++) {
            for (let lz = 0; lz < 16; lz++) {
              for (let y = Math.min(MAX_Y - 1, 150); y >= MIN_Y; y--) {
                const block = getBlockAt(chunk, lx, y, lz);
                if (!BLOCK_BY_ID[block] || BLOCK_BY_ID[block].category !== 'solid') continue;

                // Prefer surface blocks above sea level
                const isSurface = SURFACE_BLOCKS.has(block);
                const aboveSea = y > SEA_LEVEL;

                // Check column clear (headroom for player — 2 blocks above feet)
                let colClear = true;
                for (let cy = y + 1; cy <= y + 3; cy++) {
                  const cBlock = getBlockAt(chunk, lx, cy, lz);
                  if (cBlock !== BLOCK_TYPES.AIR && cBlock !== BLOCK_TYPES.WATER) { colClear = false; break; }
                }
                if (!colClear) continue;

                // Score: elevation primary + surface bonus + above-sea bonus
                const worldX = cx * 16 + lx;
                const worldZ = cz * 16 + lz;
                let score = y * 100;           // Elevation is the primary factor (×100 to dominate bonuses)
                if (isSurface) score += 500;    // Surface block bonus
                if (aboveSea) score += 1000;     // Above-sea bonus

                if (score > bestScore) {
                  bestSpawnX = worldX;
                  bestSpawnZ = worldZ;
                  bestSpawnY = y;
                  bestScore = score;
                }
              }
            }
          }
        }
      }

      const spawnHeight = gameState.spawnHeight = bestSpawnY >= 0 ? bestSpawnY + 1.625 + 2 : SEA_LEVEL + 2;
      // console.log(`[Cuubz] Spawn at X=${bestSpawnX} Z=${bestSpawnZ} Y=${spawnHeight} (surface=${bestSpawnY}, chunks=${chunkManager.memoryCache.size})`);

      if (bestSpawnY < 0) {
        //console.warn("No valid spawn found — using default") — falling back to sea level. Check chunk generation.');
      }

      // Initialize Player at terrain level
      loadingStatus.textContent = 'Creating player...';
      if (loadingProgress) loadingProgress.style.width = '90%';

      const player = gameState.player = new Player();

      // Check if character has a saved position for this world
      const savedSpawn = (selected.spawnPoints && selected.spawnPoints[currentWorld.id]) || null;
      if (savedSpawn) {
        // Restore last saved position
        player.position.x = savedSpawn.x;
        player.position.y = savedSpawn.y;
        player.position.z = savedSpawn.z;
        _log(`[Cuubz] Restored saved position: ${savedSpawn.x.toFixed(1)}, ${savedSpawn.y.toFixed(1)}, ${savedSpawn.z.toFixed(1)}`);
      } else {
        // No saved position — use calculated terrain spawn
        player.position.x = bestSpawnX + 0.5; // Center in chunk column
        player.position.y = spawnHeight;
        player.position.z = bestSpawnZ + 0.5;
      }
      player.pitch = -Math.PI / 8; // Sync with initial camera pitch

      // Player placed — position logged only on error
      
      player.linkWorld(worldManager);

      // ─── Multiplayer: Send JOIN to game session ───
      // Must be after spawn search so we send the actual spawn position.
      if (sessionManager && sessionManager.client) {
        const charData = characterManager ? characterManager.getSelectedCharacter() : null;
        const spawnPos = { x: player.position.x, y: player.position.y, z: player.position.z };
        sessionManager.client.joinGame(
          charData ? { name: charData.name, color: charData.color } : { name: 'Player', color: '#ffffff' },
          spawnPos,
          { yaw: 0, pitch: 0 }
        );
        if (sessionManager.client._pendingGameJoin) {
          console.log('[JOIN] joinGame QUEUED — game session not connected yet, will send when ready');
        } else {
          console.log(`[JOIN] joinGame SENT immediately to game session at ${JSON.stringify(spawnPos)}`);
        }
      }

      // Initialize Biome Effects System (wire up visual effects per biome)
      const biomeEffects = gameState.biomeEffects = new BiomeEffects();
      if (renderer.scene && renderer.renderer) {
        biomeEffects.init(renderer.scene, renderer.renderer);
      // Biome Effects initialized — no log
      } else {
        // If Three.js not ready yet, initialize on next frame when available
        setTimeout(() => {
          if (renderer.scene && renderer.renderer) {
            biomeEffects.init(renderer.scene, renderer.renderer);
      // Biome Effects initialized — no log
          }
        }, 100);
      }

      // Handle mouse movement for camera rotation (pointer lock) — must be after player exists
      document.addEventListener('mousemove', (e) => {
        if (document.pointerLockElement === canvas) {
          player.yaw -= e.movementX * sensitivity;
          player.pitch -= e.movementY * sensitivity;
          // Clamp pitch to avoid flipping at gimbal lock limits
          player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, player.pitch));
        }
      });

      // Initialize Game Engine
      loadingStatus.textContent = 'Starting game loop...';
      if (loadingProgress) loadingProgress.style.width = '90%';

      game = new CuubzGame();
      game.player = player;
      game.setMode(mode || 'survival');
      gameState.game = game;
      // `renderer`, `chunkManager`, `skybox`, `frameCount` and `attackCooldown` were
      // assigned onto `game` here. They are declared fields on GameState now and are
      // set at the point each is constructed — refactor.md §7 PR 12, "fold the ad-hoc
      // props in". `game.player` stays because CuubzGame.setMode() uses it to push
      // creative-mode physics onto the player; it is the same object as
      // `gameState.player` and neither is ever reassigned.
      // D-37, fixed in PR 14. This line read `characterManager.storage` while the class it
      // ran against (`BrowserCharacterManager`) named the field `this.persistence`, so the
      // ternary's truthy branch yielded `undefined` every time. The reconcile settles on
      // one name — `storage`, the tested class's — and this is now the live handle:
      // `savePlayerState()` below writes through it rather than reaching into the manager,
      // which is what stops it from going quietly dead again.
      gameState.persistence = characterManager ? characterManager.storage : null;

      // ══ Step 9 — mob system ═══════════════════════════════════════════════════════════════
      // Constructed before the inventory exists and handed it at step 12 — the `inventory: null`
      // in its deps is that, not an oversight.

      // ─── Initialize Mob System (stub — inventory + survival set after their init) ──
      try {
        mobIntegration = new MobIntegration();
        const deps = {
          scene: renderer.scene,
          camera: renderer.camera,
          player: player,
          inventory: null, // Set after Inventory constructor below
          survivalSystem: null, // Not wired yet
          worldSeed: currentWorld.seed,
          onMobDeath: (mob, drops) => {
            _log(`[Cuubz] Mob died: ${mob.mobType}, drops:`, drops);
          },
        };
        mobIntegration.init(deps);
        _log('[Cuubz] Mob system initialized');
      } catch (e) {
        console.warn('[Cuubz] Failed to init mob system:', e.message);
      }

      // Set up camera at player eye level — looking slightly downward to see terrain
      const initCamPos = new THREE.Vector3(player.position.x, player.position.y + 1.6, player.position.z);
      renderer.updateCamera(initCamPos, 0, -Math.PI / 8);

      // ══ Step 10 — first-person hand ═══════════════════════════════════════════════════════

      // ─── Initialize First-Person Hand ──────────────
      let firstPersonHand = null;
      if (typeof FirstPersonHand !== 'undefined') {
        firstPersonHand = new FirstPersonHand(renderer.camera, { itemAtlas });
      }
      gameState.firstPersonHand = firstPersonHand;

      // ══ Step 11 — multiplayer (host or client) ════════════════════════════════════════════
      // PlayerSync, PlayerListHUD, ChunkStreamer, and the CHUNK_DATA / TIME_SYNC handlers.
      // Every one is a no-op without a sessionManager.client, which is why solo skips it all.

      // ─── Initialize Multiplayer Player Sync ─────────
      let playerSync = null;
      if (typeof PlayerSyncManager !== 'undefined' && sessionManager && sessionManager.client) {
        playerSync = new PlayerSyncManager();
        playerSync.setGameMode(mode || 'survival');

        // Wire session events to player sync
        // Handle WELCOME — it includes existing players already in the session
        sessionManager.client.onGame('WELCOME', (data) => {
          console.log('[JOIN] WELCOME received:', JSON.stringify(data).substring(0, 300));
          if (data.players && Array.isArray(data.players) && data.players.length > 0) {
            for (const p of data.players) {
              // Skip self
              if (p.playerId === sessionManager.client.playerId) continue;
              const state = playerSync.addPlayer(p.playerId, {
                name: p.name || 'Player',
                color: p.color || '#888888',
                position: p.position,
              });
              if (state.mesh && renderer.scene) renderer.scene.add(state.mesh);
              if (state.nameTag && renderer.scene) renderer.scene.add(state.nameTag);
              if (state.healthBar && renderer.scene) renderer.scene.add(state.healthBar);
              _log(`[Cuubz] Existing player from WELCOME: ${p.playerId} (${p.name})`);
            }
          }
        });

        sessionManager.client.onGame('PLAYER_JOINED', (data) => {
          const state = playerSync.addPlayer(data.playerId, {
            name: data.character?.name || 'Player',
            color: data.character?.color || '#888888',
            position: data.position,
          });
          if (state.mesh && renderer.scene) renderer.scene.add(state.mesh);
          if (state.nameTag && renderer.scene) renderer.scene.add(state.nameTag);
          if (state.healthBar && renderer.scene) renderer.scene.add(state.healthBar);
          _log(`[Cuubz] Remote player joined: ${data.playerId} (${state.name})`);
        });

        sessionManager.client.onGame('PLAYER_MOVE', (data) => {
          playerSync.processServerUpdate(data.playerId, {
            position: data.position,
            yaw: data.rotation?.yaw,
            pitch: data.rotation?.pitch,
          });
        });

        sessionManager.client.onGame('PLAYER_LEFT', (data) => {
          const removed = playerSync.removePlayer(data.playerId);
          _log(`[Cuubz] Remote player left: ${data.playerId}`);
        });

        _log('[Cuubz] PlayerSyncManager initialized for multiplayer');
      }
      gameState.playerSync = playerSync;

      // ─── Initialize PlayerListHUD (connected to live player data) ───
      let playerListHUD = null;
      if (typeof PlayerListHUD !== 'undefined' && sessionManager && sessionManager.client) {
        const overlayEl = document.getElementById('player-list-overlay');
        const countEl = document.getElementById('player-count');
        const itemsEl = document.getElementById('player-list-items');

        if (overlayEl && itemsEl) {
          playerListHUD = new PlayerListHUD({ overlay: overlayEl, count: countEl, items: itemsEl });

          // Build initial player list: include local player + any remote players
          const localChar = characterManager ? characterManager.getSelectedCharacter() : null;
          const initialPlayers = [];
          if (localChar) {
            initialPlayers.push({
              id: 'local',
              name: localChar.name,
              color: localChar.color || '#4CAF50',
              health: 100,
            });
          }
          playerListHUD.updatePlayers(initialPlayers);

          // Wire WELCOME — add existing players already in the session
          sessionManager.client.onGame('WELCOME', (data) => {
            if (playerListHUD && data.players && Array.isArray(data.players)) {
              for (const p of data.players) {
                // Skip self
                if (p.playerId === sessionManager.client.playerId) continue;
                playerListHUD.addPlayer({
                  id: p.playerId,
                  name: p.name || 'Player',
                  color: p.color || '#888888',
                  health: 100,
                  position: p.position,
                });
              }
            }
          });

          // Wire PLAYER_JOINED to add to HUD
          sessionManager.client.onGame('PLAYER_JOINED', (data) => {
            if (playerListHUD) {
              playerListHUD.addPlayer({
                id: data.playerId,
                name: data.character?.name || 'Player',
                color: data.character?.color || '#888888',
                health: data.health !== undefined ? data.health : 100,
              });
            }
          });

          // Wire PLAYER_LEFT to remove from HUD
          sessionManager.client.onGame('PLAYER_LEFT', (data) => {
            if (playerListHUD) {
              playerListHUD.removePlayer(data.playerId);
            }
          });

          // Wire PLAYER_MOVE to update health + position in HUD
          sessionManager.client.onGame('PLAYER_MOVE', (data) => {
            if (playerListHUD && data.playerId) {
              const update = { id: data.playerId };
              if (data.health !== undefined) update.health = data.health;
              if (data.position) update.position = data.position;
              playerListHUD.addPlayer(update);
            }
          });

          _log('[Cuubz] PlayerListHUD initialized and wired to live player data');
        }
      }
      gameState.playerListHUD = playerListHUD;

      // ─── Initialize ChunkStreamer (host-side proactive chunk streaming) ───
      let chunkStreamer = null;
      if (typeof ChunkStreamer !== 'undefined' && sessionManager && sessionManager.hostingSessionId) {
        chunkStreamer = new ChunkStreamer({
          chunkGrid: chunkManager,
          options: {
            loadRadius: 6,
            unloadRadius: 8,
            streamInterval: 500,  // Tick every 500ms for faster streaming
            maxChunksPerTick: 32, // Stream up to 32 chunks per tick
            compressData: true,
          },
        });

        // Register host player position — use actual playerId so server can route messages
        const hostPlayerId = sessionManager.client.playerId || 'host';
        chunkStreamer.updatePlayerPosition(hostPlayerId, { x: player.position.x, y: player.position.y, z: player.position.z });

        // Update remote player positions from PlayerSyncManager
        // This is done in the render loop

        // When chunks are streamed, send them via the game session relay
        // Don't include targetPlayers — let server broadcast to all non-host players
        chunkStreamer.onChunkStreamed = (payload) => {
          if (sessionManager.client && sessionManager.client.isGameSessionConnected) {
            const cx = payload.chunkX;
            const cz = payload.chunkZ;

            // Extract 1-deep edge strips from neighbor chunks for correct
            // water face culling at chunk boundaries on the client side.
            // Each edge strip is 16 × 256 = 4096 bytes, RLE-compressed.
            const neighborEdges = {};
            const edgeConfigs = [
              { dir: 'positiveX', dx: 1, dz: 0, edgeX: 0, edgeZ: null, stripIdx: (z, y) => z * 256 + y },
              { dir: 'negativeX', dx: -1, dz: 0, edgeX: 15, edgeZ: null, stripIdx: (z, y) => z * 256 + y },
              { dir: 'positiveZ', dx: 0, dz: 1, edgeX: null, edgeZ: 0, stripIdx: (x, y) => x * 256 + y },
              { dir: 'negativeZ', dx: 0, dz: -1, edgeX: null, edgeZ: 15, stripIdx: (x, y) => x * 256 + y },
            ];

            for (const ec of edgeConfigs) {
              const neighbor = chunkManager.getChunkData(cx + ec.dx, cz + ec.dz);
              if (neighbor && neighbor.blocks) {
                const strip = new Uint8Array(16 * 256);
                if (ec.edgeX !== null) {
                  for (let z = 0; z < 16; z++) {
                    for (let y = 0; y < 256; y++) {
                      strip[ec.stripIdx(z, y)] = neighbor.blocks[ec.edgeX + z * 16 + y * 256];
                    }
                  }
                } else {
                  for (let x = 0; x < 16; x++) {
                    for (let y = 0; y < 256; y++) {
                      strip[ec.stripIdx(x, y)] = neighbor.blocks[x + ec.edgeZ * 16 + y * 256];
                    }
                  }
                }
                // Convert to regular Array for JSON serialization (WebSocket uses JSON.stringify)
                neighborEdges[ec.dir] = Array.from(ChunkCompressor.compress(strip).data);
              }
            }

            // Get humidityMap from the chunk — needed for vertex color tinting on clients
            const chunkData = chunkManager.getChunkData(cx, cz);
            let humidityMap;
            if (chunkData && chunkData.humidityMap) {
              humidityMap = Array.from(chunkData.humidityMap);
            } else if (typeof computeHumidityMap === 'function') {
              // Fallback: compute humidityMap for the chunk (e.g., if loaded from cache)
              humidityMap = Array.from(computeHumidityMap(chunkManager.worldSeed, cx, cz, chunkManager.genParams));
            } else {
              humidityMap = undefined;
            }

            const msg = {
              type: 'CHUNK_DATA',
              chunkX: cx,
              chunkZ: cz,
              data: payload.data,
              compressed: payload.compressed,
              dirty: payload.dirty,
              neighborEdges: Object.keys(neighborEdges).length > 0 ? neighborEdges : undefined,
              humidityMap: humidityMap,
              // Only send to players who need this chunk (prevents unnecessary re-streaming
              // to players who already have it, which was causing excessive mesh rebuilds)
              targetPlayers: payload.players,
            };
            sessionManager.client._gameSessionConn?.send(msg);
          }
        };

        chunkStreamer.onChunkLoaded = (info) => {
          _log(`[ChunkStreamer] Chunk loaded: ${info.key}`);
        };

        chunkStreamer.start();
        _log('[Cuubz] ChunkStreamer initialized for host-side proactive chunk streaming');
      }
      gameState.chunkStreamer = chunkStreamer;

      // ─── Client-side CHUNK_DATA handling (receive streamed chunks from host) ───
      if (sessionManager && sessionManager.currentSessionId && !sessionManager.hostingSessionId) {
        sessionManager.client.onGame('CHUNK_DATA', (data) => {
          try {
            if (!data || data.chunkX === undefined || data.chunkZ === undefined) return;
            if (!data.data) return;
            // Must be a valid Array (JSON-deserialized from WebSocket)
            if (!Array.isArray(data.data)) return;

            const cx = data.chunkX;
            const cz = data.chunkZ;
            const key = ChunkManager.key(cx, cz);

            // Decompress if needed — data arrives as a regular Array (JSON serialized via WebSocket)
            const rawArr = data.data;
            const blockData = data.compressed
              ? ChunkCompressor.decompress({ method: 'rle', data: new Uint8Array(rawArr), originalLength: 16 * 16 * 256 })
              : new Uint8Array(rawArr);

            if (!blockData || blockData.length === 0) return;

            // If chunk is already loaded, apply as dirty update (only if data changed)
            const existing = chunkManager.memoryCache.get(key);
            if (existing) {
              // Compare blocks to avoid unnecessary mesh rebuilds — only update if changed
              let changed = false;
              for (let i = 0; i < Math.min(blockData.length, existing.blocks.length); i++) {
                if (existing.blocks[i] !== blockData[i]) {
                  existing.blocks[i] = blockData[i];
                  changed = true;
                }
              }
              if (changed) {
                existing.dirty = true;
                existing.changed = true; // Trigger mesh rebuild only if data changed
                _log(`[Cuubz] Applied streamed chunk update: ${key} (${blockData.length} blocks)`);
              }
              // Update humidityMap if provided (even if block data didn't change)
              if (data.humidityMap) {
                existing.humidityMap = new Float32Array(data.humidityMap);
              } else if (typeof computeHumidityMap === 'function' && !existing.humidityMap) {
                existing.humidityMap = computeHumidityMap(chunkManager.worldSeed, cx, cz, chunkManager.genParams);
              }
            } else {
              // Chunk not loaded — create it from host data
              const newChunk = new Chunk(cx, cz);
              for (let i = 0; i < Math.min(blockData.length, newChunk.blocks.length); i++) {
                newChunk.blocks[i] = blockData[i];
              }
              newChunk.dirty = false; // Host data is authoritative
              newChunk.changed = true; // Trigger mesh rebuild

              // Store humidity map for vertex color tinting
              if (data.humidityMap) {
                newChunk.humidityMap = new Float32Array(data.humidityMap);
              } else if (typeof computeHumidityMap === 'function') {
                newChunk.humidityMap = computeHumidityMap(chunkManager.worldSeed, cx, cz, chunkManager.genParams);
              }

              // Store virtual neighbor edge strips (if provided by host)
              // These prevent false water side faces at chunk boundaries
              // Edge data arrives as regular Arrays (JSON serialized)
              if (data.neighborEdges) {
                const edgeDirs = ['positiveX', 'negativeX', 'positiveZ', 'negativeZ'];
                for (const dir of edgeDirs) {
                  if (data.neighborEdges[dir]) {
                    const edgeArr = Array.isArray(data.neighborEdges[dir])
                      ? data.neighborEdges[dir]
                      : Array.from(data.neighborEdges[dir]);
                    const decompressed = ChunkCompressor.decompress({
                      method: 'rle',
                      data: new Uint8Array(edgeArr),
                      originalLength: 16 * 256
                    });
                    newChunk.neighborEdges[dir] = decompressed;
                  }
                }
              }

              chunkManager.memoryCache.set(key, newChunk);
              _log(`[Cuubz] Received streamed chunk: ${key} (${blockData.length} blocks)`);
            }
          } catch (err) {
            console.error('[Cuubz] Error processing CHUNK_DATA:', err.message);
          }
        });
        _log('[Cuubz] CHUNK_DATA handler registered for receiving streamed chunks');
      }

      // ─── Client-side TIME_SYNC handling (receive time-of-day from host) ───
      if (sessionManager && sessionManager.currentSessionId && !sessionManager.hostingSessionId) {
        sessionManager.client.onGame('TIME_SYNC', (data) => {
          try {
            if (!data || data.timeOfDay === undefined) return;
            if (skybox) {
              skybox.timeOfDay = ((data.timeOfDay % 24) + 24) % 24;
              skybox.timePaused = !!data.timePaused;
            }
          } catch (err) {
            console.error('[Cuubz] Error processing TIME_SYNC:', err.message);
          }
        });
        _log('[Cuubz] TIME_SYNC handler registered for time-of-day sync from host');
      }

      // ══ Step 12 — block interaction ═══════════════════════════════════════════════════════

      // Initialize Block Interaction system
      const blockInteraction = gameState.blockInteraction = new BlockInteraction({
        renderer: renderer,
        chunkManager: chunkManager,
        mouse: mouse,
        player: player,
        touch: touch, // Mobile break/place support
      });

      // ══ Step 13 — inventory + systems ═════════════════════════════════════════════════════
      // Inventory, crafting, inventory sync, the saved-inventory load, dropped items, and the
      // ~700 lines of hotbar / inventory / crafting DOM code that hang off them.

      // ─── Initialize Inventory System ────────────────
      const inventory = gameState.inventory = new Inventory();
      player.inventory = inventory;

      // Wire inventory into mob system for auto-loot
      if (mobIntegration && mobIntegration.getManager()) {
        mobIntegration.getManager().setPlayerInventory(inventory);
      }

      // ─── Initialize Crafting System ─────────────────
      const crafting = gameState.crafting = new CraftingSystem(inventory);

      // ─── Multiplayer: Inventory Sync ────────────────
      let inventorySync = null;
      if (typeof InventorySync !== 'undefined' && sessionManager && sessionManager.client) {
        inventorySync = new InventorySync(inventory, { playerId: sessionManager.client.playerId });

        // On join: send full inventory to host
        if (sessionManager.currentSessionId && !sessionManager.hostingSessionId) {
          const joinPayload = inventorySync.createJoinPayload();
          sessionManager.client.sendInventory(joinPayload);
          _log('[Cuubz] Sent initial inventory to host on join');
        }

        // Start periodic diff sync (5s interval)
        inventorySync.startPeriodicSync((payload) => {
          if (sessionManager.client && sessionManager.client.isGameSessionConnected) {
            sessionManager.client.sendInventory(payload);
          }
        });

        // Handle incoming inventory sync from host
        sessionManager.client.onGame('INVENTORY_SYNC', (data) => {
          if (inventorySync && data.playerId && data.inventory) {
            // Only apply host's authoritative sync for our own inventory
            if (data.playerId === sessionManager.client.playerId) {
              inventorySync.applyRemoteSync(data.playerId, data.inventory);
            }
          }
        });

        _log('[Cuubz] InventorySync initialized');
      }

      // Load saved inventory from character data
      const selectedChar = characterManager ? characterManager.getSelectedCharacter() : null;
      if (selectedChar) {
        try {
          const savedInv = Inventory.deserialize({
            rows: 4, cols: 9,
            selectedHotbarSlot: 0,
            slots: selectedChar.inventory || [],
            equipment: selectedChar.equipment || {},
          });
          // Copy saved slots into our inventory
          for (let i = 0; i < savedInv.totalSlots; i++) {
            inventory.slots[i] = savedInv.slots[i];
          }
          // Copy saved equipment
          if (typeof EQUIPMENT_SLOT_ORDER !== 'undefined') {
            for (const slot of EQUIPMENT_SLOT_ORDER) {
              if (savedInv.equipment[slot]) {
                inventory.equipment[slot] = { ...savedInv.equipment[slot] };
              }
            }
          }
          _log('[Cuubz] Loaded saved inventory with ' + savedInv.getItems().length + ' items' +
            (Object.keys(savedInv.equipment || {}).length > 0 ? ' and equipment' : ''));
        } catch(e) {
          _log('[Cuubz] Failed to load saved inventory: ' + e.message);
        }

        // Initialize HUD armor indicator from loaded equipment
        const armorStats = inventory.getEquipmentStats();
        const armorIndicatorHud = document.getElementById('armor-indicator');
        const hudDefense = document.getElementById('hud-defense');
        if (armorIndicatorHud && hudDefense) {
          if (armorStats.totalArmor > 0) {
            hudDefense.textContent = armorStats.totalArmor;
            armorIndicatorHud.classList.remove('hidden');
          }
        }
      }

      // Wire inventory to block interaction (for block drops)
      blockInteraction.inventory = inventory;

      // Wire block broken callback to spawn dropped items
      blockInteraction.onBlockBroken = (dropType, worldPos) => {
        droppedItems.addDrop(dropType, worldPos);
      };

      // Wire break-started callback to trigger first-person hand swing
      blockInteraction.onBreakStarted = () => {
        if (firstPersonHand) firstPersonHand.swing();
      };

      // ─── Dropped Items System ──────────────────────
      const droppedItems = gameState.droppedItems = {
        drops: [],
        scene: renderer.scene,

        addDrop(typeId, worldPos) {
          const color = getBlockColor(typeId);
          const geo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
          const mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.85 });
          const mesh = new THREE.Mesh(geo, mat);
          mesh.position.set(worldPos.x + 0.5, worldPos.y + 0.5, worldPos.z + 0.5);
          this.scene.add(mesh);

          this.drops.push({
            mesh,
            typeId,
            velocity: {
              x: (Math.random() - 0.5) * 2,
              y: 3 + Math.random() * 2,
              z: (Math.random() - 0.5) * 2,
            },
            bobPhase: Math.random() * Math.PI * 2,
            landed: false,
            landedY: worldPos.y + 0.5,
            lifetime: 120, // seconds before disappearing
          });
        },

        update(delta, playerPos, inventory) {
          for (let i = this.drops.length - 1; i >= 0; i--) {
            const drop = this.drops[i];

            // Gravity when not landed
            if (!drop.landed) {
              drop.velocity.y -= 15 * delta;
              drop.mesh.position.x += drop.velocity.x * delta;
              drop.mesh.position.y += drop.velocity.y * delta;
              drop.mesh.position.z += drop.velocity.z * delta;
              drop.mesh.rotation.y += delta * 3;

              // Check if landed
              if (drop.mesh.position.y <= drop.landedY) {
                drop.mesh.position.y = drop.landedY;
                drop.landed = true;
                drop.velocity.x = 0;
                drop.velocity.y = 0;
                drop.velocity.z = 0;
              }
            } else {
              // Bob animation when landed
              drop.bobPhase += delta * 3;
              drop.mesh.position.y = drop.landedY + Math.sin(drop.bobPhase) * 0.1;
              drop.mesh.rotation.y += delta * 1.5;
            }

            // Pickup check — player within 3 blocks
            const dx = drop.mesh.position.x - playerPos.x;
            const dy = drop.mesh.position.y - playerPos.y;
            const dz = drop.mesh.position.z - playerPos.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

            if (dist < 3) {
              // Pickup!
              const result = inventory.addItem(drop.typeId, 1);
              if (result.added > 0) {
                this.scene.remove(drop.mesh);
                drop.mesh.geometry.dispose();
                drop.mesh.material.dispose();
                this.drops.splice(i, 1);
                _log('[Cuubz] Picked up item: ' + drop.typeId);
              }
              continue;
            }

            // Lifetime decay
            drop.lifetime -= delta;
            if (drop.lifetime <= 0) {
              this.scene.remove(drop.mesh);
              drop.mesh.geometry.dispose();
              drop.mesh.material.dispose();
              this.drops.splice(i, 1);
            }
          }
        },

        clear() {
          for (const drop of this.drops) {
            this.scene.remove(drop.mesh);
            drop.mesh.geometry.dispose();
            drop.mesh.material.dispose();
          }
          this.drops = [];
        },
      };

      // ─── Block Color Helper (fallback for dropped items) ────────────────
      function getBlockColor(blockType) {
        const colors = {
          0: '#888888', 1: '#333333', 2: '#808080', 3: '#8B4513', 4: '#228B22',
          5: '#F4A460', 6: '#808080', 7: '#4169E1', 8: '#2c2c2c', 9: '#CD853F',
          10: '#FFD700', 11: '#00CED1', 12: '#888888', 13: '#FFFFFF', 14: '#DCDCDC',
          15: '#FF4500', 16: '#B22222', 17: '#FF6347', 18: '#87CEEB', 19: '#B0C4DE',
          32: '#8B4513', 33: '#228B22', 34: '#DEB887', 35: '#1a0a2e', 36: '#36454F',
          37: '#32CD32', 38: '#9400D3', 39: '#8B0000', 40: '#FF0000', 41: '#FFD700',
          42: '#FF69B4', 43: '#FFD700', 44: '#FFA500', 45: '#FFFF00',
        };
        if (typeof blockType === 'string') {
          const namedColors = {
            coal: '#2c2c2c', iron_ore: '#CD853F', gold_ore: '#FFD700',
            diamond: '#00CED1', corrupt_crystal: '#9400D3',
            apple: '#FF0000', cooked_meat: '#8B4513', berry: '#8B008B',
            bread: '#DEB887', golden_apple: '#FFD700',
          };
          return namedColors[blockType] || '#888888';
        }
        return colors[blockType] || '#888888';
      }

      // ─── Item Texture Rendering ────────────────────────────────────────
      // Draw an item icon onto a canvas element using the item texture atlas
      // or the block texture atlas for block items.
      function renderItemIcon(canvasEl, typeId) {
        const ctx = canvasEl.getContext('2d');
        const w = canvasEl.width;
        const h = canvasEl.height;
        ctx.clearRect(0, 0, w, h);

        // Try item atlas first (for named items)
        if (typeof typeId === 'string' && itemAtlas.slotMap[typeId]) {
          const src = itemAtlas.canvas;
          const slot = itemAtlas.slotMap[typeId];
          const srcCell = itemAtlas.tileSize + itemAtlas._gap;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(src, itemAtlas._gap + slot.col * srcCell, itemAtlas._gap + slot.row * srcCell, itemAtlas.tileSize, itemAtlas.tileSize, 0, 0, w, h);
        } else if (typeof typeId === 'number' && itemAtlas.slotMap[typeId]) {
          // Block item registered in item atlas
          const src = itemAtlas.canvas;
          const slot = itemAtlas.slotMap[typeId];
          const srcCell = itemAtlas.tileSize + itemAtlas._gap;
          ctx.imageSmoothingEnabled = false;
          ctx.drawImage(src, itemAtlas._gap + slot.col * srcCell, itemAtlas._gap + slot.row * srcCell, itemAtlas.tileSize, itemAtlas.tileSize, 0, 0, w, h);
        } else if (typeof typeId === 'number' && textureAtlas.tileMap[typeId]) {
          // Fall back to block atlas — draw the top face texture
          const blockEntry = textureAtlas.tileMap[typeId];
          let tile = blockEntry.tiles.top || blockEntry.tiles.side || blockEntry.tiles.all;
          if (tile) {
            const src = textureAtlas.diffuseCanvas;
            const srcCell = textureAtlas.tileSize + textureAtlas._gap;
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(src, textureAtlas._gap + tile.col * srcCell, textureAtlas._gap + tile.row * srcCell, textureAtlas.tileSize, textureAtlas.tileSize, 0, 0, w, h);
          }
        }
      }

      // ─── Hotbar UI Update ──────────────────────────────────────────────
      function updateHotbarUI() {
        const hotbarSlots = document.querySelectorAll('.hotbar-slot');
        for (let i = 0; i < 9; i++) {
          const globalIndex = inventory.hotbarSlotIndex(i);
          const slot = inventory.getSlot(globalIndex);
          const el = hotbarSlots[i];
          if (!el) continue;

          // Update active state
          el.classList.toggle('active', i === inventory.selectedHotbarSlot);

          // Remove old canvas if present
          const oldCanvas = el.querySelector('canvas.item-icon');
          if (oldCanvas) oldCanvas.remove();
          const oldCount = el.querySelector('.hotbar-item-count');
          if (oldCount) oldCount.remove();

          if (slot) {
            const name = inventory.getDisplayName(slot.typeId);

            // Create canvas for item icon
            const canvas = document.createElement('canvas');
            canvas.className = 'item-icon';
            canvas.width = 48;
            canvas.height = 48;
            renderItemIcon(canvas, slot.typeId);
            el.appendChild(canvas);

            // Show count badge if > 1
            if (slot.count > 1) {
              const countEl = document.createElement('span');
              countEl.className = 'hotbar-item-count';
              countEl.textContent = slot.count;
              el.appendChild(countEl);
            }

            el.title = name + (slot.count > 1 ? ' (x' + slot.count + ')' : '');
          } else {
            el.innerHTML = '';
            el.title = '';
          }
        }
      }

      // The render loop drives the hotbar every 5 frames and the inventory screen on
      // mobile tap, and both live at main.js top level now — so they reach these two
      // through `state` rather than through the closure. PR 15 moves them to
      // src/ui/hud/Hotbar.js and src/ui/overlays/InventoryScreen.js (§13).
      gameState.updateHotbarUI = updateHotbarUI;

      // Wire inventory callbacks for hotbar updates
      inventory.onSlotChange = (index, slot) => {
        updateHotbarUI();
        if (gameState.inventoryOpen) renderInventoryCraftingUI();
      };
      inventory.onSelectionChange = () => {
        updateHotbarUI();
        // Update first-person hand to show the selected item
        if (firstPersonHand) {
          const item = inventory.getSelectedItem();
          firstPersonHand.setItem(item ? item.typeId : null);
        }
      };

      // Initial hotbar render
      updateHotbarUI();

      // Set first-person hand to the initially selected item
      if (firstPersonHand) {
        const item = inventory.getSelectedItem();
        firstPersonHand.setItem(item ? item.typeId : null);
      }

      // ─── Inventory + Crafting Screen ────────────────
      //
      // BUGS.md D-31: `inventoryOpen` was a `let` here. It is the one hoisted value
      // that genuinely mutates at runtime, so it gets no local alias — `gameState`
      // is its only home. That is what lets the Escape handler in setupPauseMenu()
      // read it; see the restored block there.
      const craftingScreen = document.getElementById('crafting-screen');
      const btnCloseCrafting = document.getElementById('btn-close-crafting');

      // ─── Inventory Drag State (document-level handlers) ────────────────
      let _invDrag = null; // { fromSlot, typeId, count, ghostEl }
      let _invClickStart = null; // { slot, x, y } to distinguish click vs drag

      /**
       * Check if player is within 4 blocks of a crafting table (block ID 162).
       */
      function checkNearCraftingTable(player, chunkManager) {
        const px = Math.floor(player.position.x);
        const py = Math.floor(player.position.y);
        const pz = Math.floor(player.position.z);
        const range = 4;

        for (let dx = -range; dx <= range; dx++) {
          for (let dy = -range; dy <= range; dy++) {
            for (let dz = -range; dz <= range; dz++) {
              const wx = px + dx, wy = py + dy, wz = pz + dz;
              const block = chunkManager.getVoxel(wx, wy, wz);
              if (block === BLOCK_TYPES.CRAFTING_TABLE) return true;
            }
          }
        }
        return false;
      }

      /**
       * Render the interactive inventory grid with drag-and-drop support.
       */
      function renderInventoryGrid(container) {
        if (!container) return;
        container.innerHTML = '';

        for (let i = 0; i < inventory.totalSlots; i++) {
          const slot = inventory.getSlot(i);
          const isHotbar = inventory.isHotbarSlot(i);
          const div = document.createElement('div');
          div.className = 'inventory-slot' + (isHotbar ? ' hotbar' : '');
          div.dataset.slot = i;

          if (slot) {
            const name = inventory.getDisplayName(slot.typeId);

            // Create canvas for item icon
            const canvas = document.createElement('canvas');
            canvas.className = 'item-icon';
            canvas.width = 48;
            canvas.height = 48;
            renderItemIcon(canvas, slot.typeId);
            div.appendChild(canvas);

            // Show count badge if > 1
            if (slot.count > 1) {
              const countEl = document.createElement('span');
              countEl.className = 'item-count';
              countEl.textContent = slot.count;
              div.appendChild(countEl);
            }

            div.title = name + (slot.count > 1 ? ' (x' + slot.count + ')' : '');
          } else {
            div.title = 'Empty slot';
          }

          // ── Right-click: split stack (move 1 to nearest compatible slot) ──
          div.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            const fromIdx = parseInt(div.dataset.slot);
            const fromSlot = inventory.getSlot(fromIdx);
            if (!fromSlot || fromSlot.count <= 1) return;

            // Find nearest empty slot or matching slot with space
            let targetIdx = -1;
            for (let j = 0; j < inventory.totalSlots; j++) {
              if (j === fromIdx) continue;
              const target = inventory.getSlot(j);
              if (!target) { targetIdx = j; break; }
              if (inventory.itemsMatch(target.typeId, fromSlot.typeId)) {
                const maxStack = inventory.getMaxStack(fromSlot.typeId);
                if (target.count < maxStack) { targetIdx = j; break; }
              }
            }
            if (targetIdx >= 0) {
              const maxStack = inventory.getMaxStack(fromSlot.typeId);
              const target = inventory.getSlot(targetIdx);
              const space = target ? (maxStack - target.count) : maxStack;
              const moveCount = Math.min(1, fromSlot.count, space);
              fromSlot.count -= moveCount;
              if (fromSlot.count <= 0) inventory.clearSlot(fromIdx);
              if (!target) {
                inventory.setSlot(targetIdx, { typeId: fromSlot.typeId, count: moveCount });
              } else {
                target.count += moveCount;
                inventory._notifySlotChange(targetIdx);
              }
              inventory._notifySlotChange(fromIdx);
              renderInventoryCraftingUI();
              updateHotbarUI();
            }
          });

          container.appendChild(div);
        }
      }

      /**
       * Render the equipment panel UI (4 armor slots + stats).
       */
      function renderEquipmentUI() {
        const container = document.getElementById('equipment-slots');
        const defenseEl = document.getElementById('defense-value');
        const toughnessEl = document.getElementById('toughness-value');
        if (!container) return;

        // Update stats
        const stats = inventory.getEquipmentStats();
        if (defenseEl) defenseEl.textContent = stats.totalArmor;
        if (toughnessEl) toughnessEl.textContent = stats.totalToughness;

        // Update HUD armor indicator
        const armorIndicator = document.getElementById('armor-indicator');
        const hudDefense = document.getElementById('hud-defense');
        if (armorIndicator && hudDefense) {
          if (stats.totalArmor > 0) {
            hudDefense.textContent = stats.totalArmor;
            armorIndicator.classList.remove('hidden');
          } else {
            armorIndicator.classList.add('hidden');
          }
        }

        // Render each slot
        const slots = container.querySelectorAll('.equipment-slot');
        for (const slotEl of slots) {
          const slotName = slotEl.dataset.slot;
          const iconContainer = slotEl.querySelector('.equip-slot-icon');
          const item = inventory.getEquippedItem(slotName);

          // Clear previous content
          iconContainer.innerHTML = '';

          if (item) {
            slotEl.classList.add('occupied');

            // Draw item icon
            const canvas = document.createElement('canvas');
            canvas.className = 'item-icon';
            canvas.width = 48;
            canvas.height = 48;
            renderItemIcon(canvas, item.typeId);
            iconContainer.appendChild(canvas);

            // Show armor value badge
            const def = NAMED_ITEMS[item.typeId];
            if (def) {
              const badge = document.createElement('span');
              badge.className = 'equip-stat-badge';
              badge.textContent = '🛡' + (def.armorValue || 0);
              slotEl.appendChild(badge);
            }

            slotEl.title = inventory.getDisplayName(item.typeId);
          } else {
            slotEl.classList.remove('occupied');
            slotEl.title = 'Empty - drag armor here';
          }
        }
      }

      // ── Document-level drag-and-drop handlers (only active when inventory is open) ──
      // These handle the full drag lifecycle: mousedown → mousemove (start drag) → mouseup (drop or click)

      document.addEventListener('mousedown', function invMouseDown(e) {
        if (!gameState.inventoryOpen || e.button !== 0) return;
        const slotEl = e.target.closest('.inventory-slot');
        const equipEl = e.target.closest('.equipment-slot');
        if (slotEl) {
          e.preventDefault();
          _invClickStart = { slot: parseInt(slotEl.dataset.slot), x: e.clientX, y: e.clientY };
        } else if (equipEl) {
          e.preventDefault();
          _invClickStart = { equipSlot: equipEl.dataset.slot, x: e.clientX, y: e.clientY };
        }
      });

      document.addEventListener('mousemove', function invMouseMove(e) {
        if (!_invClickStart) return;
        const dx = e.clientX - _invClickStart.x;
        const dy = e.clientY - _invClickStart.y;
        if (Math.sqrt(dx * dx + dy * dy) <= 5) return;

        // Start drag
        if (!_invDrag) {
          let typeId = null;
          let count = 0;
          let fromSlot = null;
          let fromEquipSlot = null;

          if (_invClickStart.slot !== undefined) {
            // Dragging from inventory slot
            const slot = inventory.getSlot(_invClickStart.slot);
            if (slot) {
              fromSlot = _invClickStart.slot;
              typeId = slot.typeId;
              count = slot.count;
              inventory.setSlot(fromSlot, null);
            }
          } else if (_invClickStart.equipSlot) {
            // Dragging from equipment slot
            const item = inventory.getEquippedItem(_invClickStart.equipSlot);
            if (item) {
              fromEquipSlot = _invClickStart.equipSlot;
              typeId = item.typeId;
              count = item.count;
              inventory.unequipItem(fromEquipSlot);
            }
          }

          if (typeId) {
            _invDrag = { fromSlot, fromEquipSlot, typeId, count };
            renderInventoryCraftingUI();
            updateHotbarUI();

            // Create drag ghost
            const ghost = document.createElement('div');
            ghost.style.cssText = 'position:fixed;pointer-events:none;z-index:10000;width:48px;height:48px;margin:-24px 0 0 -24px;';
            const canvas = document.createElement('canvas');
            canvas.width = 48; canvas.height = 48;
            canvas.style.cssText = 'width:40px;height:40px;image-rendering:pixelated;';
            renderItemIcon(canvas, typeId);
            ghost.appendChild(canvas);
            document.body.appendChild(ghost);
            _invDrag.ghostEl = ghost;
          }
        }
        if (_invDrag && _invDrag.ghostEl) {
          _invDrag.ghostEl.style.left = e.clientX + 'px';
          _invDrag.ghostEl.style.top = e.clientY + 'px';
        }
      });

      document.addEventListener('mouseup', function invMouseUp(e) {
        if (!_invClickStart) return;
        const dx = e.clientX - _invClickStart.x;
        const dy = e.clientY - _invClickStart.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const fromIdx = _invClickStart.slot;
        _invClickStart = null;

        // ── Drag drop ──
        if (_invDrag) {
          if (_invDrag.ghostEl) _invDrag.ghostEl.remove();
          const targetEl = document.elementFromPoint(e.clientX, e.clientY);
          const slotEl = targetEl ? targetEl.closest('.inventory-slot') : null;
          const equipEl = targetEl ? targetEl.closest('.equipment-slot') : null;

          // ── Dropped on equipment slot ──
          if (equipEl) {
            const equipSlotName = equipEl.dataset.slot;

            if (inventory.isEquippable(_invDrag.typeId) && inventory.getEquipmentSlot(_invDrag.typeId) === equipSlotName) {
              // Equip the item — if slot was occupied, return old item to inventory
              const oldItem = inventory.equipItem(equipSlotName, _invDrag.typeId);
              if (oldItem) {
                // Try to add old item to inventory; if full, drop it
                const result = inventory.addItem(oldItem.typeId, oldItem.count);
                if (result.remaining > 0) {
                  // Inventory full — put old item back in equipment slot
                  inventory.equipItem(equipSlotName, oldItem.typeId);
                  // Restore dragged item to its origin
                  if (_invDrag.fromSlot !== undefined && _invDrag.fromSlot !== null) {
                    inventory.setSlot(_invDrag.fromSlot, { typeId: _invDrag.typeId, count: _invDrag.count });
                  } else if (_invDrag.fromEquipSlot) {
                    inventory.equipItem(_invDrag.fromEquipSlot, _invDrag.typeId);
                  }
                }
              }
            } else {
              // Can't equip this item — restore to origin
              if (_invDrag.fromSlot !== undefined && _invDrag.fromSlot !== null) {
                inventory.setSlot(_invDrag.fromSlot, { typeId: _invDrag.typeId, count: _invDrag.count });
              } else if (_invDrag.fromEquipSlot) {
                inventory.equipItem(_invDrag.fromEquipSlot, _invDrag.typeId);
              }
            }
          } else if (slotEl) {
            // ── Dropped on inventory slot ──
            const toIdx = parseInt(slotEl.dataset.slot);
            const toSlot = inventory.getSlot(toIdx);

            // If dragging from equipment slot, just place into inventory
            if (_invDrag.fromEquipSlot) {
              if (!toSlot) {
                // Empty slot — place the item
                inventory.setSlot(toIdx, { typeId: _invDrag.typeId, count: _invDrag.count });
              } else if (inventory.itemsMatch(toSlot.typeId, _invDrag.typeId)) {
                // Same type — try to stack
                const maxStack = inventory.getMaxStack(_invDrag.typeId);
                const space = maxStack - toSlot.count;
                if (space > 0) {
                  const move = Math.min(space, _invDrag.count);
                  toSlot.count += move;
                  if (_invDrag.count - move > 0) {
                    inventory.addItem(_invDrag.typeId, _invDrag.count - move);
                  }
                } else {
                  // No space — put the dragged item elsewhere, keep the slotted item
                  inventory.addItem(_invDrag.typeId, _invDrag.count);
                }
              } else {
                // Different type — swap: place dragged item, move slotted item elsewhere
                inventory.setSlot(toIdx, { typeId: _invDrag.typeId, count: _invDrag.count });
                inventory.addItem(toSlot.typeId, toSlot.count);
              }
            } else if (toIdx === _invDrag.fromSlot) {
              inventory.setSlot(toIdx, { typeId: _invDrag.typeId, count: _invDrag.count });
            } else if (!toSlot) {
              inventory.setSlot(toIdx, { typeId: _invDrag.typeId, count: _invDrag.count });
            } else if (inventory.itemsMatch(toSlot.typeId, _invDrag.typeId)) {
              const maxStack = inventory.getMaxStack(_invDrag.typeId);
              const space = maxStack - toSlot.count;
              if (space > 0) {
                const move = Math.min(space, _invDrag.count);
                toSlot.count += move;
                if (_invDrag.count - move > 0) {
                  inventory.setSlot(_invDrag.fromSlot, { typeId: _invDrag.typeId, count: _invDrag.count - move });
                }
              } else {
                inventory.setSlot(_invDrag.fromSlot, { typeId: toSlot.typeId, count: toSlot.count });
                inventory.setSlot(toIdx, { typeId: _invDrag.typeId, count: _invDrag.count });
              }
            } else {
              inventory.setSlot(_invDrag.fromSlot, { typeId: toSlot.typeId, count: toSlot.count });
              inventory.setSlot(toIdx, { typeId: _invDrag.typeId, count: _invDrag.count });
            }
          } else {
            // Dropped outside — restore to origin
            if (_invDrag.fromSlot !== undefined && _invDrag.fromSlot !== null) {
              inventory.setSlot(_invDrag.fromSlot, { typeId: _invDrag.typeId, count: _invDrag.count });
            } else if (_invDrag.fromEquipSlot) {
              inventory.equipItem(_invDrag.fromEquipSlot, _invDrag.typeId);
            }
          }
          _invDrag = null;
          renderInventoryCraftingUI();
          updateHotbarUI();
          return;
        }

        // ── Simple click (no drag) ──
        if (dist <= 5 && e.button === 0) {
          // Click on equipment slot → unequip to hotbar
          if (_invClickStart && _invClickStart.equipSlot) {
            const equipSlotName = _invClickStart.equipSlot;
            const item = inventory.unequipItem(equipSlotName);
            if (item) {
              const result = inventory.addItem(item.typeId, item.count);
              if (result.remaining > 0) {
                // Inventory full — re-equip
                inventory.equipItem(equipSlotName, item.typeId);
              }
            }
            renderInventoryCraftingUI();
            updateHotbarUI();
            return;
          }

          // Click on inventory slot
          const fromSlot = inventory.getSlot(fromIdx);
          const isHotbar = inventory.isHotbarSlot(fromIdx);
          if (fromSlot) {
            // Quick-equip armor: if item is equippable and target equipment slot is empty, equip directly
            if (inventory.isEquippable(fromSlot.typeId)) {
              const equipSlot = inventory.getEquipmentSlot(fromSlot.typeId);
              if (equipSlot && !inventory.getEquippedItem(equipSlot)) {
                inventory.setSlot(fromIdx, null);
                inventory.equipItem(equipSlot, fromSlot.typeId);
                renderInventoryCraftingUI();
                updateHotbarUI();
                return;
              }
            }

            if (!isHotbar) {
              const hotbarIdx = inventory.hotbarSlotIndex(inventory.selectedHotbarSlot);
              const hotbarSlot = inventory.getSlot(hotbarIdx);
              if (!hotbarSlot) {
                inventory.setSlot(hotbarIdx, { typeId: fromSlot.typeId, count: fromSlot.count });
                inventory.clearSlot(fromIdx);
              } else if (inventory.itemsMatch(hotbarSlot.typeId, fromSlot.typeId)) {
                const maxStack = inventory.getMaxStack(fromSlot.typeId);
                const space = maxStack - hotbarSlot.count;
                if (space > 0) {
                  const move = Math.min(space, fromSlot.count);
                  hotbarSlot.count += move;
                  fromSlot.count -= move;
                  if (fromSlot.count <= 0) inventory.clearSlot(fromIdx);
                  inventory._notifySlotChange(hotbarIdx);
                }
              } else {
                inventory.swapSlots(fromIdx, hotbarIdx);
              }
            } else {
              inventory.selectHotbarSlot(fromIdx - inventory.hotbarStart);
            }
            renderInventoryCraftingUI();
            updateHotbarUI();
          }
        }
      });

      /**
       * Render the combined inventory + crafting UI — recipe list + interactive inventory grid.
       */
      function renderInventoryCraftingUI() {
        const recipeList = document.getElementById('crafting-recipe-list');
        const invGrid = document.getElementById('crafting-inv-grid');
        const stationIndicator = document.getElementById('crafting-station-indicator');

        if (!recipeList || !invGrid) return;

        // Check crafting table proximity
        const atTable = checkNearCraftingTable(player, game.chunkManager);
        if (stationIndicator) {
          stationIndicator.classList.toggle('hidden', !atTable);
        }

        // Get craftable recipes
        const recipes = crafting.getCraftableRecipes(inventory, atTable);

        // Render recipe list
        recipeList.innerHTML = '';
        if (recipes.length === 0) {
          recipeList.innerHTML = '<div class="crafting-empty-msg">No recipes available. Gather materials or find a crafting table.</div>';
        } else {
          for (const recipe of recipes) {
            const card = document.createElement('div');
            card.className = 'recipe-card';
            card.dataset.recipeId = recipe.id;

            // Ingredients
            let cardHTML = '<div class="recipe-ingredients">';
            for (let i = 0; i < recipe.ingredients.length; i++) {
              if (i > 0) cardHTML += '<span class="recipe-plus">+</span>';
              const ing = recipe.ingredients[i];
              // Resolve actual typeId to display (handles typeIds array)
              const displayTypeId = crafting._getIngredientType(inventory, ing);
              cardHTML += `<div class="recipe-ing-slot">
                <canvas class="item-icon" width="32" height="32" data-typeid="${displayTypeId}"></canvas>
                <span class="ing-count">${ing.count}</span>
              </div>`;
            }
            cardHTML += '</div>';

            // Output
            const outCount = recipe.output.count || 1;
            cardHTML += `<div class="recipe-arrow">→</div>
              <div class="recipe-output">
                <canvas class="item-icon" width="40" height="40" data-typeid="${recipe.output.typeId}"></canvas>
                ${outCount > 1 ? `<span class="output-count">${outCount}</span>` : ''}
              </div>`;

            // Name
            cardHTML += `<div class="recipe-name">${recipe.name}</div>`;

            card.innerHTML = cardHTML;

            // Click → craft
            card.addEventListener('click', () => {
              crafting.craftRecipe(recipe.id, inventory);
              renderInventoryCraftingUI();
              updateHotbarUI();
            });

            recipeList.appendChild(card);

            // Draw icons after DOM insertion
            card.querySelectorAll('canvas[data-typeid]').forEach(canvas => {
              const typeId = canvas.dataset.typeid;
              // Preserve type: numeric strings that are pure numbers → parseInt, otherwise keep as string
              renderItemIcon(canvas, /^\d+$/.test(typeId) ? parseInt(typeId, 10) : typeId);
            });
          }
        }

        // Render interactive inventory grid
        renderInventoryGrid(invGrid);

        // Render equipment panel
        renderEquipmentUI();
      }

      /**
       * Toggle inventory + crafting screen open/closed.
       */
      function toggleInventoryScreen() {
        gameState.inventoryOpen = !gameState.inventoryOpen;
        const hotbarContainer = document.getElementById('hotbar-container');

        if (gameState.inventoryOpen) {
          // Unlock mouse so player can use inventory UI
          if (document.pointerLockElement) {
            document.exitPointerLock();
          }
          // Hide hotbar when inventory screen is open
          if (hotbarContainer) hotbarContainer.classList.add('hidden');
          renderInventoryCraftingUI();
          craftingScreen.classList.remove('hidden');
        } else {
          // Re-lock mouse when closing inventory
          gameState.renderer.domElement.requestPointerLock();
          // Show hotbar when inventory screen is closed
          if (hotbarContainer) hotbarContainer.classList.remove('hidden');
          craftingScreen.classList.add('hidden');
        }
      }
      gameState.toggleInventoryScreen = toggleInventoryScreen;

      if (btnCloseCrafting) {
        btnCloseCrafting.addEventListener('click', () => {
          gameState.inventoryOpen = false;
          gameState.renderer.domElement.requestPointerLock();
          const hotbarContainer = document.getElementById('hotbar-container');
          if (hotbarContainer) hotbarContainer.classList.remove('hidden');
          craftingScreen.classList.add('hidden');
        });
      }

      // Mobile crafting button
      const mobileCraftBtn = document.getElementById('btn-crafting-mobile');
      if (mobileCraftBtn) {
        mobileCraftBtn.addEventListener('touchstart', (e) => {
          e.preventDefault();
          if (!gameState.inventoryOpen) toggleInventoryScreen();
        });
      }

      // ══ Step 14 — HUD, input shortcuts and the periodic save ══════════════════════════════

      // ─── Keyboard Shortcuts ────────────────────────
      document.addEventListener('keydown', function gameKeyHandler(e) {
        if (game.paused || !game.running) return;

        // Number keys 1-9 for hotbar selection
        if (e.key >= '1' && e.key <= '9') {
          e.preventDefault();
          inventory.selectByNumber(parseInt(e.key));
          updateHotbarUI();
        }

        // E for inventory + crafting screen
        if (e.key === 'e' || e.key === 'E') {
          e.preventDefault();
          toggleInventoryScreen();
        }
      });

      // Scroll wheel for hotbar cycling
      document.addEventListener('wheel', function gameWheelHandler(e) {
        if (game.paused || !game.running) return;
        if (gameState.inventoryOpen) return; // Don't cycle when inventory is open
        inventory.cycleSelection(e.deltaY > 0 ? 1 : -1);
        updateHotbarUI();
      });

      // ─── Periodic Save (every 30 seconds) ──────────
      function savePlayerState() {
        const selected = characterManager ? characterManager.getSelectedCharacter() : null;
        if (!selected) return;

        // Save inventory
        const serialized = inventory.serialize();
        selected.inventory = serialized.slots;
        selected.equipment = serialized.equipment;

        // Save spawn point
        selected.spawnPoints = selected.spawnPoints || {};
        selected.spawnPoints[currentWorld.id] = {
          x: player.position.x,
          y: player.position.y,
          z: player.position.z,
        };

        // D-37: was `characterManager.persistence.saveCharacter(...)` — the other half of
        // the field-name split. `gameState.persistence` is the same object and is set at
        // step 8; reading it here is what keeps that field honest.
        if (!gameState.persistence) return;
        gameState.persistence.saveCharacter(selected);
        _log('[Cuubz] Saved player state');
      }

      // Save every 30 seconds
      const saveIntervalId = setInterval(() => {
        if (!game.paused && game.running) {
          savePlayerState();
        }
      }, 30000);

      // Save when pausing (Escape key)
      document.addEventListener('keydown', function saveOnPause(e) {
        if (e.key === 'Escape' && !game.paused) {
          savePlayerState();
        }
      });

      // Clean up save interval on game stop
      const origStop = game.stop.bind(game);
      game.stop = function() {
        savePlayerState();
        droppedItems.clear();
        clearInterval(saveIntervalId);
        origStop();
      };

      // Start game loop
      loadingStatus.textContent = 'Almost ready...';
      if (loadingProgress) loadingProgress.style.width = '100%';

      // ══ Step 15 — start the render loop ═══════════════════════════════════════════════════

      // Create a simple world-like object for collision detection.
      // No local alias: the render loop was its only reader.
      gameState.chunkWorld = {
        getBlockAtWorld: function(bx, by, bz) {
          return chunkManager.getVoxel(Math.floor(bx), Math.floor(by), Math.floor(bz));
        }
      };

      // The same again for the 500 ms that let the last of the init settle before the
      // render loop starts taking the frame budget. Awaiting it preserves the delay and
      // removes the last level of nesting from this function.
      await new Promise((resolve) => setTimeout(resolve, 500));

      game.start(mode);
      // Show HUD (contains hotbar) when game starts
      const hud = document.getElementById('hud');
      if (hud) hud.classList.remove('hidden');

      // Cancel any old render loop from a previous session before starting fresh.
      if (_renderRafId) { cancelAnimationFrame(_renderRafId); _renderRafId = null; }

      // ─── Wire up Pause Menu & Settings ────────────
      // Clean up any previous session's pause menu listeners before setting up fresh
      if (typeof _cleanupPauseMenu === 'function') {
        _cleanupPauseMenu();
        _cleanupPauseMenu = null;
      }
      _cleanupPauseMenu = setupPauseMenu(gameState);

      game.lastTime = performance.now();
      // renderLoop lives at main.js top level now (PR 12). `gameState` is the only
      // thing it needs, and passing it here is what proves the closure is severed.
      _renderRafId = requestAnimationFrame(() => renderLoop(gameState));

      // The e2e harness drives block placement through this handle — it is the
      // reason test/e2e/saveLoad.js can assert a *player edit* round-trips, rather
      // than only generated terrain. See src/testBridge.js.
      publishGameState(gameState);

      _log('[Cuubz] Game started successfully in ' + mode + ' mode');
    } catch (err) {
      console.error('[Cuubz] Game init failed:', err);
      loadingStatus.textContent = 'Error: ' + err.message;
      _log('[Cuubz] Game init error:', err.stack);
    }
  }

  // ============================================================
  // Debug Stats Overlay & Pause Menu
  // ============================================================

  /**
   * FPS tracking state — shared across frames for rolling average.
   */
  let _fpsFrames = 0;
  let _fpsLastTime = performance.now();
  let _currentFps = 0;

  // ─── Main render loop (PR 12) ───────────────────────────────────────────────
  //
  // This used to be declared inside `startGame()`'s `setTimeout` closure and read two
  // dozen of its locals by name (refactor.md §1.6). It sits at main.js top level now and
  // takes the `GameState` as its only argument, which is the PR 12 acceptance criterion
  // made structural: it cannot reference a `startGame` local because none is in scope
  // here. The only other names it reaches for are main.js-level ones that Phase 3 owns —
  // `_renderRafId`, `sessionManager` (§13 → SessionManager.js), `mobIntegration`
  // (→ MobSystem) and `updateDebugStats` (→ ui/hud/DebugStats.js) — plus module imports.
  //
  // PR 18 moves this to src/engine/loop/RenderLoop.js. Nothing about it needs to change
  // to make that a file move.
  function renderLoop(state) {
    // Always schedule the next frame first, so a throw below cannot stop the loop.
    _renderRafId = requestAnimationFrame(() => renderLoop(state));
    if (!state.game.running) return;

    // When paused, just render the scene (don't update game logic)
    if (state.game.paused) {
      state.renderer.render();
      return;
    }

    const now = performance.now();
    state.game.delta = Math.min((now - state.game.lastTime) / 1000, 0.1);
    state.game.lastTime = now;

    // Decay attack cooldown
    if (state.attackCooldown > 0) {
      state.attackCooldown -= state.game.delta;
      if (state.attackCooldown < 0) state.attackCooldown = 0;
    }

    // Update keyboard just-pressed flags
    state.keyboard.update();
    
    // Update touch input (clears per-frame state)
    state.touch.update();

    // Update mouse pointer lock state
    if (document.pointerLockElement === state.canvas) {
      state.mouse.locked = true;
    } else {
      state.mouse.locked = false;
    }

    // Apply mouse movement to player yaw/pitch (pointer lock)
    if (state.mouse._onMouseMoveBound) {
      // Mouse movement handled via pointerlockchange event
    }

    // Build merged input state (keyboard OR touch — both can contribute)
    const jumpRaw = state.keyboard.jumpAction.held || state.touch.jump;
    const jumpDown = state.keyboard.jumpAction.down || state.touch.jumpJustPressed;
    const inputState = {
      forward: state.keyboard.forward || (state.touch.joystickY < -0.3),
      backward: state.keyboard.backward || (state.touch.joystickY > 0.3),
      left: state.keyboard.left || (state.touch.joystickX < -0.3),
      right: state.keyboard.right || (state.touch.joystickX > 0.3),
      jumpHeld: jumpRaw,
      jumpDown: jumpDown,
      sprint: state.keyboard.sprint, // No mobile sprint yet — could add a dedicated button later
      sneak: state.keyboard.sneakAction.held,
    };

    // Update player physics with input (pass chunkWorld for collision)
    state.player.update(state.game.delta, inputState, state.chunkWorld);
    
    // ─── Multiplayer: Send movement updates (~20Hz) ───
    if (sessionManager && sessionManager.client && sessionManager.client.isGameSessionConnected && state.frameCount % 3 === 0) {
      sessionManager.client.sendMove(
        { x: state.player.position.x, y: state.player.position.y, z: state.player.position.z },
        { yaw: state.player.yaw, pitch: state.player.pitch }
      );
    }
    
    // Apply touch look deltas to player rotation (swipe right half of screen)
    const look = state.touch.consumeLookDeltas();
    if (look.x !== 0 || look.y !== 0) {
      state.player.yaw -= look.x * state.sensitivity;
      state.player.pitch -= look.y * state.sensitivity;
      // Clamp pitch to avoid flipping at gimbal lock limits
      state.player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, state.player.pitch));
    }
    
    // Mobile inventory toggle
    if (state.touch.inventoryToggled) {
      state.toggleInventoryScreen();
    }
    
    // Update fly mode indicator HUD (creative only)
    const flyIndicator = document.getElementById('fly-mode-indicator');
    if (state.player.flyMode && !state.player.gravityEnabled) {
      if (flyIndicator) flyIndicator.classList.remove('hidden');
    } else {
      if (flyIndicator) flyIndicator.classList.add('hidden');
    }

    // Update HUD armor indicator periodically
    if (state.frameCount % 10 === 0) {
      const armorStats = state.inventory.getEquipmentStats();
      const armorHud = document.getElementById('armor-indicator');
      const hudDefense = document.getElementById('hud-defense');
      if (armorHud && hudDefense) {
        if (armorStats.totalArmor > 0) {
          hudDefense.textContent = armorStats.totalArmor;
          armorHud.classList.remove('hidden');
        } else {
          armorHud.classList.add('hidden');
        }
      }
    }
    
    // Debug: log player state every 60 frames (disabled — too verbose)

    // Update camera to follow player at eye level.
    // This MUST happen before blockInteraction.update() so raycasting
    // uses the current frame's camera position/direction, not stale data
    // from the previous frame. Without this, moving while interacting
    // causes the raycast to be misaligned with the crosshair.
    const camPos = new THREE.Vector3(state.player.position.x, state.player.position.y + 1.6, state.player.position.z);
    state.renderer.updateCamera(camPos, state.player.yaw, state.player.pitch);

    // Update sky dome to follow the player (prevents seeing through the skybox)
    state.renderer.updateSkyPosition(camPos);

    // Update shadow camera to follow the player
    state.renderer.updateShadowCamera(state.player.position);

    // Update day/night cycle (advances time, updates sky color, sun/moon, fog, clouds)
    if (state.skybox) {
      state.skybox.update(state.game.delta, state.player.position);
    }

    // Update block interaction (break/place/attack)
    // Runs AFTER camera update so raycasting uses the current frame's
    // camera position/direction. This ensures accurate targeting while
    // the player is moving.
    if (state.blockInteraction) {
      state.blockInteraction.update(state.game.delta);
    }

    // Update first-person hand animation
    if (state.firstPersonHand) {
      state.firstPersonHand.update(state.game.delta);
    }

    // ─── Player Attack Mobs (Left Click) ────────────────
    // Uses mouse.leftClick (held state) so holding left-click
    // repeatedly attacks mobs with a cooldown between hits.
    // The cooldown is based on the weapon's attack speed.
    // Must run BEFORE mouse.update() clears justClickedLeft.
    if (mobIntegration && state.mouse && state.mouse.leftClick && state.renderer.camera && state.attackCooldown <= 0) {
      try {
        const mobManager = mobIntegration.getManager();
        if (mobManager) {
          const origin = state.renderer.camera.position;
          const direction = new THREE.Vector3();
          state.renderer.camera.getWorldDirection(direction);
          const maxDist = 7;
          const hit = mobManager.raycastMobs(origin, direction, maxDist);
          if (hit) {
            // Get attack damage
            const damage = state.inventory.getAttackDamage();

            // Calculate cooldown from weapon attack speed
            // Minecraft base = 4.0 attacks/sec, weapon attackSpeed is a modifier
            // e.g. sword: -2.4 → actual = 1.6 att/sec → cooldown = 0.625s
            let attackCooldown = 0.25; // Default fist speed (4 att/sec)
            const item = state.inventory.getSelectedItem();
            if (item && typeof item.typeId === 'string') {
              const def = (typeof NAMED_ITEMS !== 'undefined' && NAMED_ITEMS[item.typeId]);
              if (def && def.attackSpeed !== undefined) {
                const actualSpeed = 4.0 + def.attackSpeed;
                if (actualSpeed > 0) {
                  attackCooldown = 1.0 / actualSpeed;
                }
              }
            }
            state.attackCooldown = attackCooldown;

            // Apply damage and knockback
            hit.mob.takeDamage(damage, 'player_attack');
            const dx = hit.mob.position.x - state.player.position.x;
            const dz = hit.mob.position.z - state.player.position.z;
            const dist = Math.sqrt(dx*dx + dz*dz) || 1;
            hit.mob.knockback(dx/dist, dz/dist, 0.5 + damage * 0.1);

            // Trigger hand swing animation
            if (state.firstPersonHand) state.firstPersonHand.swing();

            // Prevent block breaking this frame (mob attack takes priority)
            if (state.blockInteraction) state.blockInteraction._attackOverride = true;
          }
        }
      } catch(e) {
        if (state.frameCount < 10) console.warn('[Cuubz] Mob attack error:', e.message);
      }
    }

    // Update mouse input (clears just-clicked flags) — AFTER blockInteraction and mob attack read them
    state.mouse.update();

    // ─── Multiplayer: Sync remote player positions ───
    if (state.playerSync) {
      state.playerSync.update(state.game.delta);
    }

    // ─── Multiplayer: Update player list HUD positions (every 30 frames ≈ 0.5s) ───
    if (state.playerListHUD && state.frameCount % 30 === 0) {
      // Update local player position
      state.playerListHUD.addPlayer({
        id: 'local',
        position: { x: state.player.position.x, y: state.player.position.y, z: state.player.position.z },
      });
      // Update remote player positions from PlayerSyncManager
      if (state.playerSync) {
        for (const remotePlayer of state.playerSync.getActivePlayers()) {
          state.playerListHUD.addPlayer({
            id: remotePlayer.playerId,
            position: { ...remotePlayer.authoritativePosition },
          });
        }
      }
    }

    // ─── Multiplayer: Update ChunkStreamer with player positions (host) ───
    if (state.chunkStreamer) {
      // Update host player position — use actual playerId so server can route messages
      const hostPid = sessionManager.client.playerId || 'host';
      state.chunkStreamer.updatePlayerPosition(hostPid, {
        x: state.player.position.x,
        y: state.player.position.y,
        z: state.player.position.z,
      });
      // Update remote player positions from PlayerSyncManager
      if (state.playerSync) {
        const activePlayers = state.playerSync.getActivePlayers();
        if (activePlayers.length > 0 && state.frameCount % 60 === 0) {
          console.log(`[CHUNK_STREAM] Updating ${activePlayers.length} remote player positions in chunkStreamer`);
          for (const rp of activePlayers) {
            console.log(`[CHUNK_STREAM]   ${rp.playerId.substring(0,8)} @ (${Math.floor(rp.authoritativePosition.x)},${Math.floor(rp.authoritativePosition.z)})`);
          }
        }
        for (const remotePlayer of activePlayers) {
          state.chunkStreamer.updatePlayerPosition(remotePlayer.playerId, remotePlayer.authoritativePosition);
        }
      }
    }

    // ─── Multiplayer: Sync time of day to clients (host, every ~0.5s) ───
    if (sessionManager && sessionManager.hostingSessionId && state.skybox && state.frameCount % 30 === 0) {
      if (sessionManager.client && sessionManager.client._gameSessionConn) {
        sessionManager.client._gameSessionConn.send({
          type: 'TIME_SYNC',
          timeOfDay: state.skybox.timeOfDay,
          timePaused: state.skybox.timePaused,
        });
        if (state.frameCount % 300 === 0) {
          console.log(`[TIME_SYNC] Sent: timeOfDay=${state.skybox.timeOfDay.toFixed(2)}, paused=${state.skybox.timePaused}`);
        }
      }
    }

    // ─── Multiplayer: Send block changes to game session ───
    if (state.blockInteraction && sessionManager && sessionManager.client && sessionManager.client.isGameSessionConnected) {
      if (state.blockInteraction._lastBroken) {
        console.log(`[BREAK] Sending network break: (${state.blockInteraction._lastBroken.x},${state.blockInteraction._lastBroken.y},${state.blockInteraction._lastBroken.z})`);
        sessionManager.client.breakBlock(state.blockInteraction._lastBroken.x, state.blockInteraction._lastBroken.y, state.blockInteraction._lastBroken.z);
        state.blockInteraction._lastBroken = null;
      }
      if (state.blockInteraction._lastPlaced) {
        console.log(`[PLACE] Sending network place: (${state.blockInteraction._lastPlaced.x},${state.blockInteraction._lastPlaced.y},${state.blockInteraction._lastPlaced.z}) type=${state.blockInteraction._lastPlaced.blockType}`);
        sessionManager.client.placeBlock(state.blockInteraction._lastPlaced.x, state.blockInteraction._lastPlaced.y, state.blockInteraction._lastPlaced.z, state.blockInteraction._lastPlaced.blockType);
        state.blockInteraction._lastPlaced = null;
      }
    }

    // Update dropped items (floating drops with pickup)
    if (state.droppedItems && state.droppedItems.drops.length > 0) {
      state.droppedItems.update(state.game.delta, state.player.position, state.inventory);
    }

    // Scroll wheel for hotbar cycling
    if (state.mouse.scrollDelta !== 0) {
      state.inventory.cycleSelection(state.mouse.scrollDelta > 0 ? 1 : -1);
      state.mouse.scrollDelta = 0;
    }

    // Update hotbar UI periodically
    if (state.frameCount % 5 === 0) {
      state.updateHotbarUI();
    }

    // Emergency rescue: only teleport if player falls completely out of the world.
    // The old threshold was spawnHeight-10 which fired whenever you entered
    // a cave or deep hole (e.g. spawnHeight=34 → fires at Y=24, above bedrock).
    // Now only fires at MIN_Y-5 — the player must be genuinely below bedrock.
    if (state.player.position.y < MIN_Y - 5) {
      state.player.position.y = state.spawnHeight;
      state.player.velocity.y = 0;
    }

    // Update PBR materials with shadow data + day/night lighting
    const pbrFactory = state.renderer.getPBRFactory();
    if (pbrFactory) {
      const shadowData = state.renderer.getShadowData();
      if (shadowData) {
        pbrFactory.updateShadowData(shadowData.map, shadowData.matrix);
      } else {
        // Log the first five frames with no shadow data, then stay quiet.
        state.shadowMissingCount++;
        if (state.shadowMissingCount <= 5) {
          console.warn('[Shadow] getShadowData returned null (frame', state.frameCount, ')');
        }
      }

      // Update PBR lighting uniforms from skybox (sun direction, color, intensity, ambient)
      if (state.skybox) {
        state.skybox.updatePBRFactory(pbrFactory);
      }
    } else {
      state.noPbrCount++;
      if (state.noPbrCount <= 3) {
        console.warn('[Shadow] No PBR factory available');
      }
    }

    // Update Biome Effects (particles only — sky/fog handled by day/night cycle)
    if (state.biomeEffects && state.chunkManager) {
      // Determine current biome using biomeSystem at player position
      const wx = Math.floor(state.player.position.x);
      const wz = Math.floor(state.player.position.z);
      let biomeData = null;
      try {
        biomeData = BiomeSystem.getBiomeAtWorldPos(wx, wz, state.chunkManager.worldSeed);
      } catch(e) { /* Fallback to default */ }

      if (biomeData) {
        state.biomeEffects.setBiome(biomeData.id);
        
        // Set player/camera positions for particle spawning & billboarding
        state.biomeEffects.setPlayerPosition(state.player.position.x, state.player.position.y, state.player.position.z);
        state.biomeEffects.setCameraPosition(camPos);

        // Spawn bubble particles in lava/toxic biomes
        if (biomeData.id === 'lava' && Math.random() < 0.02) {
          state.biomeEffects.spawnLavaBubbles(
            state.player.position.x + (Math.random() - 0.5) * 40,
            state.player.position.y - 2,
            state.player.position.z + (Math.random() - 0.5) * 40
          );
        } else if (biomeData.id === 'corrupt' && Math.random() < 0.015) {
          state.biomeEffects.spawnToxicBubbles(
            state.player.position.x + (Math.random() - 0.5) * 40,
            state.player.position.y - 2,
            state.player.position.z + (Math.random() - 0.5) * 40
          );
        }
      }

      // Update animation timers & particles
      // Pass skybox base color so biome tint blends with day/night cycle
      state.biomeEffects.update(state.game.delta, state.skybox ? state.skybox._baseSkyColor : null, state.skybox ? state.skybox.getFogDensity() : undefined);

      // Update the sky dome shader with the final blended sky color.
      // The sky dome (gradient sphere) was hardcoded to blue and never
      // received day/night or biome color updates — this fixes that.
      const finalSky = state.biomeEffects.getFinalSkyColor();
      if (finalSky) {
        // Create gradient: top slightly darker than horizon
        const topColor = finalSky.clone();
        topColor.r = Math.max(0, topColor.r * 0.6);
        topColor.g = Math.max(0, topColor.g * 0.6);
        topColor.b = Math.max(0, topColor.b * 0.85);
        state.renderer.updateSkyColors(finalSky, topColor);
      }
    }

    // Render scene
    state.renderer.render();

    // DEBUG: Hover raycasting — show block ID at crosshair center
    const tooltip = document.getElementById('block-tooltip');
    const tooltipId = document.getElementById('tooltip-block-id');
    const tooltipName = document.getElementById('tooltip-block-name');
    if (state.renderer.camera && state.renderer.chunkGroup) {
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(new THREE.Vector2(0, 0), state.renderer.camera);
      raycaster.far = 7; // Same as block interaction range

      const intersects = raycaster.intersectObjects(state.renderer.chunkGroup.children, true);
      if (intersects.length > 0) {
        const hit = intersects[0];
        const obj = hit.object;
        if (obj.userData && obj.userData.chunkKey && obj.userData.blockIdToName) {
          // Calculate block position from intersection point.
          // Mesh position is the chunk origin in world space.
          // IMPORTANT: hit.point sits on the surface, so floor() can land
          // in the air block above. We check both the hit position and
          // one block below to find the actual solid block.
          const meshPos = obj.position;

          const localX = Math.floor(hit.point.x - meshPos.x);
          const localY = Math.floor(hit.point.y - meshPos.y);
          const localZ = Math.floor(hit.point.z - meshPos.z);

          // Clamp to chunk bounds (X/Z: 0-15, Y: -32 to 64)
          if (localX >= 0 && localX < 16 && localZ >= 0 && localZ < 16 && localY >= -32 && localY <= 64) {
            try {
              // First check the exact hit position
              let blockId = obj.userData.chunkData.getBlock(localX, localY, localZ);

              // If that's air/cave_air, check one block below (hit point is on surface boundary)
              if ((blockId === BLOCK_TYPES.AIR || blockId === BLOCK_TYPES.CAVE_AIR) && localY > -32) {
                blockId = obj.userData.chunkData.getBlock(localX, localY - 1, localZ);
              }

              const blockName = obj.userData.blockIdToName[blockId] || 'unknown';

              tooltipId.textContent = `ID: ${blockId}`;
              tooltipName.textContent = blockName.replace(/_/g, ' ');
              tooltip.classList.remove('hidden');
            } catch (e) {
              // Block out of range — hide tooltip
              tooltip.classList.add('hidden');
            }
          } else {
            tooltip.classList.add('hidden');
          }
        } else {
          tooltip.classList.add('hidden');
        }
      } else {
        tooltip.classList.add('hidden');
      }
    }

    // Update render chunks for player position (per-frame mesh rebuild + unload)
    if (state.chunkManager) {
      state.chunkManager.updateRenderChunks(state.player.position.x, state.player.position.z);
    }



    // ─── Update Mob System ──────────────────────
    if (mobIntegration) {
      try {
        // Pass a biome lookup function so each chunk spawns its own biome's mobs
        const getBiomeFn = (wx, wz) => {
          try {
            const bd = BiomeSystem.getBiomeAtWorldPos(wx, wz, state.chunkManager.worldSeed);
            return bd ? bd.id : undefined;
          } catch(e) { return undefined; }
        };
        mobIntegration.update(state.game.delta, state.chunkWorld, state.player.position, state.chunkManager.renderDistance || 6, getBiomeFn);
      } catch(e) {
        if (state.frameCount < 10) console.warn('[Cuubz] Mob update error:', e.message);
      }
    }

    // ─── Debug Stats Overlay Update ──────────────
    updateDebugStats(state);

    // BUGS.md D-34 — this increment did not exist. `frameCount` was set to 0 once in
    // startGame() and never touched again, so every `frameCount % N === 0` throttle
    // above was permanently true and every `frameCount < 10` rate limit never expired.
    // Counting at the END of the frame rather than the start keeps frame 0 doing a full
    // pass of all six throttled paths, which is what they did before this line existed —
    // the first hotbar render, the first TIME_SYNC and the first sendMove still happen
    // immediately rather than 5, 30 and 3 frames in.
    state.frameCount++;
  }

  function updateDebugStats(state) {
    const statsEl = document.getElementById('debug-stats');
    if (!statsEl || !state.chunkManager) return;

    // FPS calculation (rolling over ~1 second window)
    _fpsFrames++;
    const now = performance.now();
    if (now - _fpsLastTime >= 1000) {
      _currentFps = Math.round(_fpsFrames * 1000 / (now - _fpsLastTime));
      _fpsFrames = 0;
      _fpsLastTime = now;
    }

    // Count active chunks (with mesh rendered) and dirty count
    let activeChunks = 0, dirtyCount = 0;
    for (const [key, chunk] of state.chunkManager.memoryCache) {
      if (state.chunkManager.loadedMeshes.has(key)) activeChunks++;
      if (chunk.dirty) dirtyCount++;
    }

    // §4.2 gives GameState a `stats` field; this is its only writer. The overlay reads
    // the DOM, but PR 19's DebugStats component will read these instead.
    state.stats.fps = _currentFps;
    state.stats.activeChunks = activeChunks;
    state.stats.dirtyCount = dirtyCount;

    // Update DOM elements
    const fpsEl = document.getElementById('stats-fps');
    const chunksEl = document.getElementById('stats-chunks');
    const dirtyEl = document.getElementById('stats-dirty');
    const manifestEl = document.getElementById('stats-manifest');

    if (fpsEl) fpsEl.textContent = `FPS: ${_currentFps}`;
    if (chunksEl) chunksEl.textContent = `Chunks: ${activeChunks} / ${state.chunkManager.memoryCache.size}`;
    if (dirtyEl) dirtyEl.textContent = `Dirty: ${dirtyCount}`;
    if (manifestEl && state.chunkManager.stats) {
      manifestEl.textContent = `Manifest writes: ${state.chunkManager.stats.manifestWrites || 0}`;
    }
  }

  // Takes the GameState, not the CuubzGame — PR 12. Every reference below that used to
  // read `game.chunkManager` / `game.renderer` / `game.skybox` now reads it off `state`,
  // and the four lifecycle flags go through `state.game`. That is what makes the Escape
  // handler able to see `state.inventoryOpen`, which is BUGS.md D-31. PR 19 moves this
  // whole function to src/ui/overlays/PauseMenu.js (§13) and it needs no other argument.
  function setupPauseMenu(state) {
    const pauseMenu = document.getElementById('pause-menu');
    const resumeBtn = document.getElementById('btn-resume-game');
    const debugStats = document.getElementById('debug-stats');

    // Settings sliders
    const tickSlider = document.getElementById('setting-tick-interval');
    const chunksSlider = document.getElementById('setting-chunks-per-tick');
    const distanceSlider = document.getElementById('setting-render-distance');

    // Value displays
    const tickVal = document.getElementById('tick-val');
    const chunksVal = document.getElementById('chunks-val');
    const distanceVal = document.getElementById('distance-val');

    if (!pauseMenu || !resumeBtn) return function() {};

    // Show debug stats overlay when game starts
    if (debugStats) {
      debugStats.classList.remove('hidden');
    }

    // ── Escape key handler ──
    const onPause = function(e) {
      if (e.key === 'Escape') {
        e.preventDefault();
        const isPaused = !pauseMenu.classList.contains('hidden');

        if (!isPaused) {
          // D-31 — CLOSED HERE. This block existed and never ran: it read
          // `typeof inventoryOpen !== 'undefined' && inventoryOpen` for a `let` declared
          // inside startGame()'s setTimeout closure, which was never in scope in this
          // function, so the guard was permanently false and pressing Escape with the
          // inventory open left the crafting screen sitting on top of the pause menu.
          // PR 11's `no-undef` found it and deleted the dead code; PR 12 is what makes it
          // fixable, because `inventoryOpen` is a field on the GameState now and this
          // handler is holding it. No `typeof` guard and no `window` global: `state` is a
          // parameter, so if it were ever wrong this would throw rather than go quiet.
          if (state.inventoryOpen) {
            state.inventoryOpen = false;
            const craftingScreenEl = document.getElementById('crafting-screen');
            if (craftingScreenEl) craftingScreenEl.classList.add('hidden');
          }

          // Pause game
          state.game.paused = true;
          pauseMenu.classList.remove('hidden');
          // Hide hotbar when paused
          const hotbarContainer = document.getElementById('hotbar-container');
          if (hotbarContainer) hotbarContainer.classList.add('hidden');
          document.exitPointerLock();
          // Stop all timers while paused
          if (state.chunkManager) {
            state.chunkManager.stopRegionCheck();
            state.chunkManager.stopFlushTimer();
          }
        } else {
          // Resume game
          resumeGame();
        }
      }
    };

    function resumeGame() {
      state.game.paused = false;
      pauseMenu.classList.add('hidden');
      // Show hotbar when resuming
      const hotbarContainer = document.getElementById('hotbar-container');
      if (hotbarContainer) hotbarContainer.classList.remove('hidden');
      state.renderer.domElement.requestPointerLock();
      // Restart all timers on resume
      if (state.chunkManager) {
        state.chunkManager.startRegionCheck(500);
        state.chunkManager.startFlushTimer(5000);
      }
    }

    const onExit = function() {
      // Stop the game loop
      state.game.running = false;
      state.game.paused = false;

      // Cancel render loop animation frame
      if (_renderRafId) {
        cancelAnimationFrame(_renderRafId);
        _renderRafId = null;
      }

      // Stop chunk manager timers and dispose resources
      if (state.chunkManager) {
        state.chunkManager.dispose();
      }

      // Exit pointer lock
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }

      // Hide in-game HUD overlays
      const hud = document.getElementById('hud');
      if (hud) hud.classList.add('hidden');
      const pauseMenuEl = document.getElementById('pause-menu');
      if (pauseMenuEl) pauseMenuEl.classList.add('hidden');
      const debugStatsEl = document.getElementById('debug-stats');
      if (debugStatsEl) debugStatsEl.classList.add('hidden');
      const craftingScreenEl = document.getElementById('crafting-screen');
      if (craftingScreenEl) craftingScreenEl.classList.add('hidden');
      const touchControlsEl = document.getElementById('touch-controls');
      if (touchControlsEl) touchControlsEl.classList.add('hidden');
      const crosshairEl = document.getElementById('crosshair');
      if (crosshairEl) crosshairEl.classList.add('hidden');
      const flyIndicatorEl = document.getElementById('fly-mode-indicator');
      if (flyIndicatorEl) flyIndicatorEl.classList.add('hidden');
      const connectionHudEl = document.getElementById('connection-hud');
      if (connectionHudEl) connectionHudEl.classList.add('hidden');
      const playerListOverlayEl = document.getElementById('player-list-overlay');
      if (playerListOverlayEl) playerListOverlayEl.classList.add('hidden');
      const armorIndicatorEl = document.getElementById('armor-indicator');
      if (armorIndicatorEl) armorIndicatorEl.classList.add('hidden');

      // Clean up Three.js renderer
      if (state.renderer) {
        const container = document.getElementById('game-container');
        if (container) container.innerHTML = '';
        if (state.renderer.renderer) {
          state.renderer.renderer.dispose();
        }
      }

      // ── Clean up multiplayer session ──
      if (typeof sessionManager !== 'undefined' && sessionManager) {
        sessionManager.leaveSession();
      }

      // ── Clean up chunk streamer ──
      if (state.chunkStreamer) {
        state.chunkStreamer.stop();
        state.chunkStreamer.dispose();
        state.chunkStreamer = null;
      }

      // ── Clean up player sync ──
      // clearAll() disposes every remote-player mesh and clears the map
      // (playerSync.js:523-531) — that is the whole teardown. There was a
      // game.playerSync.reset() call here; PlayerSyncManager has no reset()
      // (it belongs to PingTracker, playerSync.js:103), so this threw on EVERY
      // exit — including solo, since playerSync is created whenever
      // sessionManager.client exists — skipping the six cleanup steps below and
      // showScreen('mainMenu'), which left the page blank. DEPLOY.md D-14.
      if (state.playerSync) {
        state.playerSync.clearAll();
        state.playerSync = null;
      }

      // ── Clean up player list HUD ──
      if (state.playerListHUD) {
        state.playerListHUD.destroy();
        state.playerListHUD = null;
      }

      // ── Clean up block interaction ──
      if (state.blockInteraction) {
        state.blockInteraction.dispose();
        state.blockInteraction = null;
      }

      // ── Clean up first-person hand ──
      if (state.firstPersonHand) {
        state.firstPersonHand.dispose();
        state.firstPersonHand = null;
      }

      // ── Clean up dropped items ──
      if (state.droppedItems) {
        state.droppedItems.clear();
        state.droppedItems = null;
      }

      // ── Clean up mob integration ──
      if (typeof mobIntegration !== 'undefined' && mobIntegration) {
        mobIntegration.destroy();
        mobIntegration = null;
      }

      // Clean up event listeners from this session
      if (typeof _cleanupPauseMenu === 'function') {
        _cleanupPauseMenu();
        _cleanupPauseMenu = null;
      }

      // Show main menu
      showScreen('mainMenu');
      _log('[Cuubz] Exited to main menu');
    };

    const exitBtn = document.getElementById('btn-exit-menu');

    document.addEventListener('keydown', onPause);
    resumeBtn.addEventListener('click', resumeGame);
    if (exitBtn) exitBtn.addEventListener('click', onExit);

    // Settings: Region Check Interval (was Chunk Tick Interval)
    if (tickSlider && tickVal) {
      tickSlider.value = 500; // Default region check interval
      tickVal.textContent = tickSlider.value;
      tickSlider.addEventListener('input', () => {
        const val = parseInt(tickSlider.value);
        tickVal.textContent = val;
        if (state.chunkManager) {
          state.chunkManager.stopRegionCheck();
          state.chunkManager.startRegionCheck(val);
        }
      });
    }

    // Settings: Chunks Per Tick → now controls flush interval
    if (chunksSlider && chunksVal) {
      chunksSlider.value = 5; // Default flush interval in seconds
      chunksVal.textContent = chunksSlider.value + 's';
      chunksSlider.addEventListener('input', () => {
        const val = parseInt(chunksSlider.value);
        chunksVal.textContent = val + 's';
        if (state.chunkManager) {
          state.chunkManager.stopFlushTimer();
          state.chunkManager.startFlushTimer(val * 1000);
        }
      });
    }

    // ─── Pause Menu Performance Settings ─────────────────────
    // Sync UI with current settings on pause
    if (perfSettings) syncPerfSettingsUI();

    const pausePerfRenderDist = document.getElementById('pause-perf-render-distance');
    const pausePerfShadows = document.getElementById('pause-perf-shadows');
    const pausePerfTextureRes = document.getElementById('pause-perf-texture-res');
    const pausePerfAdvShading = document.getElementById('pause-perf-advanced-shading');

    if (pausePerfRenderDist && perfSettings) {
      pausePerfRenderDist.addEventListener('change', () => {
        const val = parseInt(pausePerfRenderDist.value, 10);
        perfSettings.set('renderDistance', val);
        syncPerfSettingsUI();
        if (state.chunkManager) {
          state.chunkManager.setRenderDistance(val);
        }
      });
    }

    if (pausePerfShadows && perfSettings) {
      pausePerfShadows.addEventListener('change', () => {
        const val = pausePerfShadows.value;
        perfSettings.set('shadowQuality', val);
        syncPerfSettingsUI();
        if (state.renderer) {
          state.renderer.setShadowQuality(val);
        }
      });
    }

    if (pausePerfTextureRes && perfSettings) {
      pausePerfTextureRes.addEventListener('change', async () => {
        const val = pausePerfTextureRes.value;
        perfSettings.set('textureResolution', val);
        syncPerfSettingsUI();
        await rebuildAtlasAndMaterials(state.renderer, state.chunkManager);
      });
    }

    if (pausePerfAdvShading && perfSettings) {
      pausePerfAdvShading.addEventListener('change', async () => {
        const val = pausePerfAdvShading.checked;
        perfSettings.set('advancedShading', val);
        syncPerfSettingsUI();
        await rebuildAtlasAndMaterials(state.renderer, state.chunkManager);
      });
    }

    // Pause Time of Day checkbox
    const pauseTimeCheckbox = document.getElementById('pause-pause-time');
    if (pauseTimeCheckbox && state.skybox) {
      pauseTimeCheckbox.checked = !state.skybox.timePaused; // checked = time running
      pauseTimeCheckbox.addEventListener('change', () => {
        state.skybox.timePaused = !pauseTimeCheckbox.checked;
        _log(`[Cuubz] Time of day ${state.skybox.timePaused ? 'PAUSED' : 'RESUMED'}`);
        // Immediately broadcast time change to clients.
        // Use hostingSessionId as the guard — the host is the authority on time,
        // and time sync is independent of chunk streaming.
        if (sessionManager && sessionManager.hostingSessionId &&
            sessionManager.client && sessionManager.client._gameSessionConn) {
          sessionManager.client._gameSessionConn.send({
            type: 'TIME_SYNC',
            timeOfDay: state.skybox.timeOfDay,
            timePaused: state.skybox.timePaused,
          });
          _log(`[Cuubz] TIME_SYNC sent: timePaused=${state.skybox.timePaused}`);
        }
      });
    }

    // Return cleanup function so listeners can be removed on exit or re-init
    return function cleanup() {
      document.removeEventListener('keydown', onPause);
      resumeBtn.removeEventListener('click', resumeGame);
      if (exitBtn) exitBtn.removeEventListener('click', onExit);
    };
  }

  // ============================================================
  // Mobile Detection
  // ============================================================

  function detectMobile() {
    const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const isNarrowScreen = window.innerWidth < 768;

    if (isTouchDevice || isNarrowScreen) {
      document.getElementById('touch-controls').classList.remove('hidden');
      _log('[Cuubz] Mobile/touch controls enabled');
    }
  }

  // ============================================================
  // Initialization
  // ============================================================

  async function init() {
    _log('[Cuubz] INIT STARTING');
    try {
      _log('[Cuubz] Initializing...');

      // Initialize PersistenceManager (IndexedDB)
      const persistence = new PersistenceManager();
      await persistence.init();
      _log('[Cuubz] IndexedDB initialized');

      // Initialize CharacterManager
      characterManager = new CharacterManager(persistence);
      await characterManager.init();
      _log(`[Cuubz] Loaded ${characterManager.getAllCharacters().length} characters`);

      // Initialize WorldManager
      worldManager = new WorldManager(persistence);
      await worldManager.init();
      _log(`[Cuubz] Loaded ${worldManager.getAllWorlds().length} worlds`);

      // Initialize Performance Settings (before menu nav so handlers have it)
      try {
        perfSettings = new PerformanceSettings();
        perfSettings.load();
        _log(`[Cuubz] Performance settings loaded: ${JSON.stringify(perfSettings.get())}`);
      } catch (e) {
        console.error('[Cuubz] Performance settings init error:', e);
        perfSettings = null;
      }

      _log('[Cuubz] Calling initMenuNavigation');
      try {
        initMenuNavigation();
      } catch (e) {
        console.error('[Cuubz] initMenuNavigation ERROR:', e);
      }

      // Sync UI after menu handlers are wired
      if (perfSettings) syncPerfSettingsUI();

      try {
        detectMobile();
      } catch (e) {
        console.error('[Cuubz] detectMobile ERROR:', e);
      }

      // ─── Auto-Rejoin: Check if we were in a session before page refresh ───
      const lastSession = getLastSession();
      if (lastSession && lastSession.sessionId) {
        _log(`[Cuubz] Found saved session: ${lastSession.sessionId} (${lastSession.isHost ? 'host' : 'joiner'})`);

        // Check if the relay still has this session active
        try {
          const relayUrl = getRelayUrl();
          const httpUrl = relayUrl.replace('wss://', 'https://').replace('ws://', 'http://');
          const resp = await fetch(`${httpUrl}/sessions`, { signal: AbortSignal.timeout(3000) });
          if (resp.ok) {
            const sessions = await resp.json();
            const activeSession = sessions.find(s => s.sessionId === lastSession.sessionId);
            if (activeSession) {
              _log(`[Cuubz] Session ${lastSession.sessionId} is still active on relay — auto-rejoining`);

              // Ensure character is selected
              const characters = characterManager.getAllCharacters();
              if (characters.length > 0) {
                await characterManager.selectCharacter(characters[0].id);
              }

              // Ensure world is selected (for host) or create temp world (for joiner)
              if (lastSession.isHost && lastSession.seed) {
                const worlds = worldManager.getAllWorlds();
                const existingWorld = worlds.find(w => w.seed === lastSession.seed);
                if (existingWorld) {
                  await worldManager.selectWorld(existingWorld.id);
                } else if (worlds.length > 0) {
                  await worldManager.selectWorld(worlds[0].id);
                }
              } else if (!lastSession.isHost && lastSession.seed) {
                const tempWorld = {
                  id: `temp_${lastSession.sessionId}`,
                  name: lastSession.name || 'Remote World',
                  seed: lastSession.seed,
                  biomeMap: { dominantBiomes: ['Plains'], seed: lastSession.seed },
                  questProgress: {},
                  chunkReferences: [],
                };
                worldManager.worlds.push(tempWorld);
                worldManager.selectedId = tempWorld.id;
              } else if (worldManager.getAllWorlds().length > 0) {
                await worldManager.selectWorld(worldManager.getAllWorlds()[0].id);
              }

              // Initialize session manager and rejoin
              sessionManager = new SessionManager();
              sessionManager.init(relayUrl);

              updateConnectionStatus('connecting');
              showScreen('loadingScreen');
              document.getElementById('loading-status').textContent =
                lastSession.isHost ? 'Re-hosting session...' : 'Re-joining session...';

              if (lastSession.isHost && sessionManager.client) {
                try {
                  await sessionManager.client.hostSession({
                    name: lastSession.name,
                    seed: lastSession.seed || Math.floor(Math.random() * 0xFFFFFFFF),
                    mode: lastSession.mode || 'survival',
                  });
                  _log(`[Cuubz] Re-hosting session: ${lastSession.name}`);
                } catch (err) {
                  _log(`[Cuubz] Re-host failed: ${err.message}`);
                  showScreen('mainMenu');
                  return;
                }
              } else if (sessionManager.client) {
                try {
                  await sessionManager.joinSession(lastSession.sessionId);
                  _log(`[Cuubz] Re-joining session: ${lastSession.sessionId}`);
                } catch (err) {
                  _log(`[Cuubz] Re-join failed: ${err.message}`);
                  showScreen('mainMenu');
                  return;
                }
              }

              // Start the game
              startGame(lastSession.mode || 'survival');
              // console.info, not console.error — this is a success milestone.
              // CuubzLogger.log is console.log gated on DEBUG=false (js/util/logger.js:39),
              // i.e. silent in production, which is why someone reached for console.error
              // to force visibility. The logger is correct; the severity was not.
              console.info('[Cuubz] === AUTO-REJOIN COMPLETE ===');
              return; // Skip showing main menu
            }
          }
        } catch (err) {
          _log(`[Cuubz] Could not check relay for auto-rejoin: ${err.message}`);
        }

        // Session not found on relay — show main menu with rejoin panel
        _log(`[Cuubz] Session ${lastSession.sessionId} no longer active on relay`);
      }

      showScreen('mainMenu');
      console.info('[Cuubz] === INIT COMPLETE ==='); // success milestone — see AUTO-REJOIN above
    } catch (err) {
      console.error('[Cuubz] FATAL init error:', err.message, err.stack);
    }
  }

  // ─── Save session state before page unload ───
  // This ensures that if the user refreshes or closes the tab,
  // we can auto-rejoin on the next load.
  window.addEventListener('beforeunload', () => {
    try {
      if (sessionManager && sessionManager.hostingSessionId) {
        const selected = characterManager ? characterManager.getSelectedCharacter() : null;
        const world = worldManager ? worldManager.getSelectedWorld() : null;
        localStorage.setItem(REJOIN_STORAGE_KEY, JSON.stringify({
          sessionId: sessionManager.hostingSessionId,
          name: selected ? selected.name : 'My Session',
          mode: sessionManager._gameMode || 'survival',
          isHost: true,
          seed: world ? world.seed : null,
          timestamp: Date.now(),
        }));
      } else if (sessionManager && sessionManager.currentSessionId) {
        const selected = characterManager ? characterManager.getSelectedCharacter() : null;
        localStorage.setItem(REJOIN_STORAGE_KEY, JSON.stringify({
          sessionId: sessionManager.currentSessionId,
          name: selected ? selected.name : 'Joined Session',
          mode: sessionManager._gameMode || 'survival',
          isHost: false,
          timestamp: Date.now(),
        }));
      }
    } catch (e) { /* ignore localStorage errors */ }
  });

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
