/**
 * Cuubz — Main Entry Point
 * Menu system, play/host/join flow, screen management, character & world management.
 */

import * as THREE from 'three';
import { PerformanceSettings } from './engine/renderer/PerformanceSettings.js';
import { PBRTextureAtlas } from './engine/renderer/TextureAtlas.js';
import { NAMED_ITEMS } from './game/systems/InventorySystem.js';
import { CuubzLogger } from './util/Logger.js';
import { BiomeSystem } from './engine/world/BiomeSystem.js';
import { BLOCK_TYPES } from './engine/world/BlockRegistry.js';
import { MIN_Y } from './engine/world/ChunkData.js';
import { PersistenceManager } from './engine/world/Persistence.js';
// PR 14 — the reconcile (refactor.md §3.4, §8.1). `main.js` carried its own
// `BrowserCharacterManager` / `BrowserWorldManager` and never used these two, which have
// the only test coverage either class has. Option A: the tested classes win, the browser
// copies are deleted, and the browser-only behaviour they carried (world chunk cleanup)
// moved to `PersistenceManager.deleteWorld()`. The full ruling is refactor.md §8.1.
import { CharacterManager } from './game/entities/CharacterManager.js';
import { WorldManager } from './game/entities/WorldManager.js';
// PR 17 — `Game` is the whole of `startGame()` now (refactor.md §8.4). The `CuubzGame`
// alias survives because `new CuubzGame(...)` is what this file has always said and the
// only remaining call site is three lines long; PR 18 deletes both with the file.
import { Game as CuubzGame } from './core/Game.js';
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
// PR 16 — the session layer (refactor.md §8.3, §13). `class SessionManager`, the rejoin
// panel, `updateConnectionStatus`, the player-list overlay, `getRelayUrl` and all six
// `cuubz_last_session` write sites moved out of this file. `let sessionManager` below
// stays, because ~45 reads inside `startGame()` name it directly and PR 17 is what turns
// those into fields on `Game`.
import { createSessionManager } from './multiplayer/SessionManager.js';
import { rejoinSession, updateRejoinPanel } from './multiplayer/SessionRejoin.js';
import { getRelayUrl } from './multiplayer/RelayUrl.js';
import { clearLastSession, readLastSession } from './util/StorageHelper.js';

(function() {
  'use strict';

  // Debug logging — set CuubzLogger.DEBUG = true in browser console to enable
  const _log = typeof CuubzLogger !== 'undefined' ? CuubzLogger.log : function() {};

  // ============================================================
  // Screen Management — PR 15
  // ============================================================
  //
  // `screens`, `modals`, `sessionUI` and `showScreen()` are `UIManager`'s now. One alias
  // survives and keeps its call sites in this file byte-identical while the rest of
  // Phase 3 moves them out; PR 18 deletes it with the last of its readers. The
  // `sessionUI` alias went in PR 16 with the last thing that read it, and the `screens`
  // alias went in PR 17 — its only reader was `startGame()`'s step 1.

  /** @type {UIManager} */
  let ui = null;
  function showScreen(name) { ui.show(name); }

  // PR 14 — `BrowserCharacterManager` (~130 lines) and its four constants stood here.
  // Deleted; `CharacterManager` from src/game/entities/ is imported above. See the
  // reconcile note on that import and refactor.md §8.1.

  // Global reference for game engine access
  let characterManager = null;
  let worldManager = null;
  let perfSettings = null; // PerformanceSettings instance
  // The live `Game`. PR 17 — this is the object `startGame()` used to build a
  // `CuubzGame` *and* a `GameState` for; `Game` absorbed the former (decision 34) and
  // owns the latter as `game.state`. Null until the first `startGame()`; every reader
  // guards for it. PR 18 takes this binding into `src/index.js` with the render loop.
  let game = null;
  let _renderRafId = null;      // Track render loop rAF for cleanup on exit
  let _cleanupPauseMenu = null; // Cleanup function returned by setupPauseMenu()
  // PR 17 — `let mobIntegration` stood here. It is `gameState.mobIntegration` now; the
  // render loop, the mob attack path and the exit handler all had a `state` already.

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
    get ui() { return ui; },
    get characterManager() { return characterManager; },
    get worldManager() { return worldManager; },
    get perfSettings() { return perfSettings; },
    get sessionManager() { return sessionManager; },
    get gameState() { return game ? game.state : null; },
    startGame: (mode) => startGame(mode),
    rebuildAtlasAndMaterials: (renderer, chunkManager) => rebuildAtlasAndMaterials(renderer, chunkManager),
    updateRejoinPanel: () => updateRejoinPanel(),
    log: (...args) => _log(...args),
  };

  /**
   * PR 17 — what `Game.init()` reads this file through.
   *
   * The manager half is `uiDeps` verbatim (decision 27's live getters, for the same
   * reason: they are all `null` when the menu is built). The four hooks below are what
   * is genuinely still owned here, and each one is PR 18's:
   *
   *   • `onSessionStart` — the point in `init()` where `gameState = new GameState()`
   *     used to be, so the `game` binding is taken at exactly the old moment;
   *   • `setupPauseMenu` / `cancelRenderLoop` / `startRenderLoop` — the render loop and
   *     the pause menu are still functions in this file (§8.5), and `_renderRafId` is
   *     still a local here.
   *
   * `publishGameState` arrives through here rather than being imported by `Game.js`
   * because `src/testBridge.js` assigns `window.__cuubz` at module top level and two
   * unit tests `require` `Game.js` in Node.
   */
  const gameDeps = Object.create(uiDeps, {
    onSessionStart: { value: (g) => { game = g; } },
    publishGameState: { value: (state) => publishGameState(state) },
    cancelRenderLoop: {
      value: () => {
        if (_renderRafId) { cancelAnimationFrame(_renderRafId); _renderRafId = null; }
      },
    },
    setupPauseMenu: {
      value: (state) => {
        // Clean up any previous session's pause menu listeners before setting up fresh
        if (typeof _cleanupPauseMenu === 'function') {
          _cleanupPauseMenu();
          _cleanupPauseMenu = null;
        }
        _cleanupPauseMenu = setupPauseMenu(state);
      },
    },
    startRenderLoop: {
      value: (state) => {
        _renderRafId = requestAnimationFrame(() => renderLoop(state));
      },
    },
  });

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
   * What is left is what does not belong to a screen: constructing the UI and the
   * session manager, and wiring the two rejoin-panel buttons to `SessionRejoin.js`.
   * PR 19 takes the rest of it into `src/index.js`.
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

      // PR 16 — a SECOND `beforeunload` handler on `cuubz_last_session` stood here, and
      // the one at the bottom of this file was already registered. Both fired; this one
      // ran second and its `setItem` won, and it hard-coded `mode: 'survival'` for a
      // joiner. `BUGS.md` **D-43**. There is one handler now, at the bottom of this file,
      // and `SessionManager.saveSessionRecord()` is the only thing that writes the key.

      _log('[Cuubz] initMenuNavigation complete');
    } catch (e) {
      console.error('[Cuubz] initMenuNavigation CRASHED:', e.message, '\n', e.stack);
    }
  }

  // ============================================================
  // Session UI Management
  // ============================================================

  let sessionManager = null;


  // PR 16 — the session layer stood here, ~650 lines (refactor.md §8.3):
  // `updateConnectionStatus`, the `renderSessionList` / `showHostError` / `hideHostError`
  // delegates, `renderPlayerList` / `hidePlayerList`, `REJOIN_STORAGE_KEY`,
  // `getLastSession`, `clearLastSession`, `updateRejoinPanel`, `rejoinSession`,
  // `class SessionManager`, `getRelayUrl` and `initSessionUI`.
  //
  //   src/multiplayer/SessionManager.js   the class, and `createSessionManager(deps)`
  //   src/multiplayer/SessionRejoin.js    the rejoin panel and the manual rejoin
  //   src/multiplayer/RelayUrl.js         `getRelayUrl()`
  //   src/util/StorageHelper.js           the ONE writer of `cuubz_last_session` — D-43
  //   src/ui/hud/ConnectionHUD.js         `updateConnectionStatus`
  //   src/ui/hud/PlayerListOverlay.js     `renderPlayerList` / `hidePlayerList`
  //
  // No delegate survives. Every caller of the six that could have needed one was inside
  // the class itself, and the class went with them — the same check PR 15 made rather
  // than leaving six dead functions behind for D-33 to count.
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
  /**
   * Start a session.
   *
   * ─── PR 17 ────────────────────────────────────────────────────────────────
   *
   * The 1,894 lines that stood here — 58% of this file, and the largest single move
   * in the plan — are `src/core/Game.js` and the nine modules under `src/core/init/`.
   * `refactor.md` §8.4 and §13. `Game` absorbed the Phase-0 `CuubzGame` rather than
   * standing beside it (decision 34), so `new CuubzGame(gameDeps)` constructs the one
   * object that owns both the lifecycle flags and the init.
   *
   * What is left here is what the bootstrap still owns and PR 18 takes: the `game`
   * binding the render loop and the pause menu read, the rAF handle, and `renderLoop`
   * / `setupPauseMenu` themselves.
   */
  async function startGame(mode) {
    const g = new CuubzGame(gameDeps);
    await g.init(mode);
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
    if (state.mobIntegration && state.mouse && state.mouse.leftClick && state.renderer.camera && state.attackCooldown <= 0) {
      try {
        const mobManager = state.mobIntegration.getManager();
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
    if (state.mobIntegration) {
      try {
        // Pass a biome lookup function so each chunk spawns its own biome's mobs
        const getBiomeFn = (wx, wz) => {
          try {
            const bd = BiomeSystem.getBiomeAtWorldPos(wx, wz, state.chunkManager.worldSeed);
            return bd ? bd.id : undefined;
          } catch(e) { return undefined; }
        };
        state.mobIntegration.update(state.game.delta, state.chunkWorld, state.player.position, state.chunkManager.renderDistance || 6, getBiomeFn);
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
      if (state.mobIntegration) {
        state.mobIntegration.destroy();
        state.mobIntegration = null;
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
      const lastSession = readLastSession();
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

              // Initialize session manager and rejoin. `createSessionManager` also
              // resolves the relay URL, which is the same value `relayUrl` above holds —
              // that one is kept because the `/sessions` probe wanted an HTTP form of it.
              sessionManager = createSessionManager(uiDeps);

              // PR 16 — carry the stored session's identity onto the manager before
              // anything can write a new record. Without this a page closed during the
              // re-host handshake would rewrite `mode` as the `'survival'` default and
              // reproduce D-43 by a different route.
              sessionManager._gameMode = lastSession.mode || 'survival';
              sessionManager._sessionName = lastSession.name || null;
              sessionManager._sessionSeed = lastSession.seed !== undefined ? lastSession.seed : null;

              sessionManager.updateConnectionStatus('connecting');
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
  //
  // **THE ONLY `beforeunload` HANDLER FOR THE REJOIN RECORD, AS OF PR 16.** There were
  // two — this one and a second inside `initMenuNavigation` — registered on the same
  // event, writing the same key with different payloads. Both fired; the second-registered
  // one ran second and its `setItem` won, and it hard-coded `mode: 'survival'` for a
  // joiner, so refreshing while joined to a creative session rejoined into survival.
  // `BUGS.md` **D-43**. `SessionManager.getSessionRecord()` decides the shape now and
  // `StorageHelper.writeLastSession()` is the only thing that writes it — which is
  // §8.3's `StorageHelper` requirement doing the job it was specified for.
  //
  // PR 19 moves this to `src/index.js` with the rest of the bootstrap (§8.6).
  window.addEventListener('beforeunload', () => {
    if (sessionManager) sessionManager.saveSessionRecord();
  });

  // Start when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
