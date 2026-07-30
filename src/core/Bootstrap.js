/**
 * Cuubz — the bootstrap (PR 18)
 *
 * ─── WHAT THIS IS ───────────────────────────────────────────────────────────
 *
 * The last of `src/main.js`. That file was 3,268 lines in Phase 0 and 898 when PR 18
 * opened; what is left of it is here, and **`src/main.js` is deleted**. `refactor.md`
 * §8.6 and §13.
 *
 * Everything else it once held now has an owner:
 *
 *   src/ui/UIManager.js + src/ui/screens/   the screens and the menus       (PR 15)
 *   src/multiplayer/SessionManager.js       the session layer               (PR 16)
 *   src/multiplayer/SessionRejoin.js        the rejoin panel, manual rejoin (PR 16)
 *   src/core/Game.js + src/core/init/       `startGame()`, all fifteen steps (PR 17)
 *   src/engine/loop/                        the render loop and its six steps(PR 18)
 *   src/ui/hud/DebugStats.js                the debug overlay               (PR 18)
 *   src/ui/overlays/PauseMenu.js            `setupPauseMenu`                (PR 18)
 *   src/multiplayer/AutoRejoin.js           the `/sessions` probe in `start()`(PR 18)
 *
 * ─── THE IIFE IS GONE ───────────────────────────────────────────────────────
 *
 * `main.js` wrapped everything in `(function() { 'use strict'; … })()` because it was
 * loaded as a classic `<script>` and its top level *was* the global scope. An ES module
 * has its own scope and is strict by default, so the wrapper bought nothing: the
 * module-scoped `let`s below are exactly as private as the IIFE's were.
 *
 * ─── WHY THE `let`s ARE STILL `let`s ────────────────────────────────────────
 *
 * Every one of them is `null` when the UI is constructed and assigned later inside
 * `start()`. That is what `uiDeps` and `gameDeps` are for — decision 27's live getters.
 * PR 19 and beyond fold them into a session object; this PR moves the file, not the
 * shape.
 *
 * **D-42 — `applyPerfSettings()` was deleted here, not moved.** It was defined in
 * `main.js` and never called, by anything, ever. Both halves of it already run inline at
 * construction time — `init/initScene.js` step 5 (`renderer.setShadowQuality(...)`) and
 * `init/initWorld.js` step 7 (`renderDistance` in the chunk manager options) — and
 * neither could have called it: step 5 has no chunk manager yet and step 7 sets the
 * render distance through the constructor. Its third parameter, `textureAtlas`, was
 * never read by a single line of its body. The pause menu applies both settings live,
 * per control. Nothing else referenced it.
 */

import { PerformanceSettings } from '../engine/renderer/PerformanceSettings.js';
import { PBRTextureAtlas } from '../engine/renderer/TextureAtlas.js';
import { CuubzLogger } from '../util/Logger.js';
import { PersistenceManager } from '../engine/world/Persistence.js';
import { CharacterManager } from '../game/entities/CharacterManager.js';
import { WorldManager } from '../game/entities/WorldManager.js';
import { Game } from './Game.js';
import { RenderLoop } from '../engine/loop/RenderLoop.js';
// Test-only: hands the live GameState to the e2e harness. No game code reads it back,
// and `Game.js` does not import it — decision 21; it arrives there through `gameDeps`.
import { publishGameState } from '../testBridge.js';
import { UIManager } from '../ui/UIManager.js';
import { CharacterScreen } from '../ui/screens/CharacterScreen.js';
import { LobbyScreen } from '../ui/screens/LobbyScreen.js';
import { SettingsScreen } from '../ui/screens/SettingsScreen.js';
import { WorldScreen } from '../ui/screens/WorldScreen.js';
import { setupPauseMenu } from '../ui/overlays/PauseMenu.js';
import { createSessionManager } from '../multiplayer/SessionManager.js';
import { rejoinSession, updateRejoinPanel } from '../multiplayer/SessionRejoin.js';
import { attemptAutoRejoin } from '../multiplayer/AutoRejoin.js';
import { clearLastSession } from '../util/StorageHelper.js';

// Debug logging — set CuubzLogger.DEBUG = true in browser console to enable
const _log = typeof CuubzLogger !== 'undefined' ? CuubzLogger.log : function() {};

// ============================================================
// Module state
// ============================================================

/** @type {UIManager} */
let ui = null;
function showScreen(name) { ui.show(name); }

let characterManager = null;
let worldManager = null;
let perfSettings = null; // PerformanceSettings instance
let sessionManager = null;
/** The live `Game`. Null until the first `startGame()`; every reader guards for it. */
let game = null;

// One loop per page, not one per session: `Game._startRenderLoop()` cancels the previous
// session's frame through `gameDeps.cancelRenderLoop` before starting a new one, and that
// contract only holds if both hooks and the pause menu's exit handler drive the *same*
// rAF handle. That handle is `renderLoopInstance._rafId`.
const renderLoopInstance = new RenderLoop();
const stopRenderLoop = () => renderLoopInstance.stop();

/** Cleanup function returned by `setupPauseMenu()`, for the *previous* session. */
let _cleanupPauseMenu = null;

/**
 * What the extracted UI, the session layer and the pause menu read this file through.
 *
 * Every binding above is `null` when `UIManager` is constructed and assigned later,
 * inside `start()` or `Game.init()`. A screen that captured `characterManager` by value
 * at construction would hold a permanent `null`, so this object exposes them as getters
 * and each consumer reads through at the moment it needs one — decision 27.
 */
const uiDeps = {
  get ui() { return ui; },
  get characterManager() { return characterManager; },
  get worldManager() { return worldManager; },
  get perfSettings() { return perfSettings; },
  get sessionManager() { return sessionManager; },
  get gameState() { return game ? game.state : null; },
  startGame: (mode) => startGame(mode),
  rebuildAtlasAndMaterials: (renderer, chunkManager) => rebuildAtlasAndMaterials(renderer, chunkManager),
  updateRejoinPanel: () => updateRejoinPanel(),
  syncPerfSettingsUI: () => syncPerfSettingsUI(),
  showScreen: (name) => showScreen(name),
  stopRenderLoop,
  log: (...args) => _log(...args),
};

/**
 * What `Game.init()` reads this file through.
 *
 * The manager half is `uiDeps` verbatim. The four hooks below are what is genuinely
 * owned here: the point at which the `game` binding is taken, the pause menu, and the
 * two render-loop controls — which stay in `deps` rather than becoming an import in
 * `Game.js` because the pause menu's exit handler drives the same instance.
 */
const gameDeps = Object.create(uiDeps, {
  onSessionStart: { value: (g) => { game = g; } },
  publishGameState: { value: (state) => publishGameState(state) },
  cancelRenderLoop: { value: stopRenderLoop },
  setupPauseMenu: {
    value: (state) => {
      // Clean up any previous session's pause menu listeners before setting up fresh
      if (typeof _cleanupPauseMenu === 'function') {
        _cleanupPauseMenu();
        _cleanupPauseMenu = null;
      }
      _cleanupPauseMenu = setupPauseMenu(state, gameDeps);
    },
  },
  startRenderLoop: { value: (state) => renderLoopInstance.start(state) },
});

// ============================================================
// Performance Settings Helpers
// ============================================================

/** The one surviving delegate into `SettingsScreen` — the pause menu calls it. */
function syncPerfSettingsUI() { ui.settings.syncUI(); }

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
 * What is left is what does not belong to a screen: constructing the UI and the session
 * manager, and wiring the two rejoin-panel buttons to `SessionRejoin.js`.
 */
function initMenuNavigation() {
  try {
    ui = new UIManager(uiDeps);
    ui.registerScreens({
      character: new CharacterScreen(ui),
      world: new WorldScreen(ui),
      lobby: new LobbyScreen(ui),
      settings: new SettingsScreen(ui),
    });
    ui.initNavigation();

    // ─── Rejoin panel ───
    const btnRejoin = document.getElementById('btn-rejoin-session');
    if (btnRejoin) {
      btnRejoin.addEventListener('click', async () => {
        await rejoinSession(uiDeps, (sm) => { sessionManager = sm; });
      });
    }

    const btnClearRejoin = document.getElementById('btn-clear-rejoin');
    if (btnClearRejoin) {
      btnClearRejoin.addEventListener('click', () => {
        clearLastSession();
        updateRejoinPanel();
      });
    }

    sessionManager = createSessionManager(uiDeps);

    // PR 16 — a SECOND `beforeunload` handler on `cuubz_last_session` stood here, and the
    // one at the bottom of this file was already registered. Both fired; this one ran
    // second and its `setItem` won, and it hard-coded `mode: 'survival'` for a joiner.
    // `BUGS.md` **D-43**. There is one handler now, at the bottom of this file, and
    // `SessionManager.saveSessionRecord()` is the only thing that writes the key.

    _log('[Cuubz] initMenuNavigation complete');
  } catch (e) {
    console.error('[Cuubz] initMenuNavigation CRASHED:', e.message, '\n', e.stack);
  }
}

// ============================================================
// Game Start
// ============================================================

/**
 * Start a session. The 1,894 lines this used to be are `src/core/Game.js` and the nine
 * modules under `src/core/init/` (PR 17). **Nothing awaits it** — the menu handlers and
 * the auto-rejoin both call it and move on, which is why `Game.init()` carries its own
 * `try/catch`.
 */
async function startGame(mode) {
  const g = new Game(gameDeps);
  await g.init(mode);
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

/**
 * The page's entry point — `main.js`'s `init()`. `src/index.js` calls it on
 * `DOMContentLoaded`, or immediately if the document is already parsed.
 */
export async function start() {
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

    // ─── Auto-Rejoin: were we in a session before the page refresh? ───
    // Returns true when it has taken the page over — either into the loading screen and
    // a live session, or back to the main menu after a failed handshake. Either way the
    // menu below must not be shown a second time, which is what `init()`'s bare `return`
    // used to express. `src/multiplayer/AutoRejoin.js`.
    const tookOver = await attemptAutoRejoin(uiDeps, (sm) => { sessionManager = sm; });
    if (tookOver) return;

    showScreen('mainMenu');
    // console.info, not console.error — this is a success milestone. `CuubzLogger.log`
    // is `console.log` gated on DEBUG=false, i.e. silent in production, which is why
    // someone reached for console.error to force visibility. The severity was wrong.
    console.info('[Cuubz] === INIT COMPLETE ===');
  } catch (err) {
    console.error('[Cuubz] FATAL init error:', err.message, err.stack);
  }
}

// ─── Save session state before page unload ───
//
// **THE ONLY `beforeunload` HANDLER FOR THE REJOIN RECORD, AS OF PR 16.** There were two
// — this one and a second inside `initMenuNavigation` — registered on the same event,
// writing the same key with different payloads. Both fired; the second-registered one ran
// second and its `setItem` won, and it hard-coded `mode: 'survival'` for a joiner, so
// refreshing while joined to a creative session rejoined into survival. `BUGS.md`
// **D-43**. `SessionManager.getSessionRecord()` decides the shape now and
// `StorageHelper.writeLastSession()` is the only thing that writes it.
//
// It is registered at module evaluation, exactly as it was when this was `main.js`'s
// top level — `test_sessionRecord.js` counts the registrations in `src/`, and one is one.
window.addEventListener('beforeunload', () => {
  if (sessionManager) sessionManager.saveSessionRecord();
});
