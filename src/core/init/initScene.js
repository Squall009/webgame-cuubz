/**
 * Cuubz — `Game.init()` steps 1–5 (PR 17)
 *
 * Screens down / loading up, the renderer, the input devices, the two texture atlases
 * and the PBR + shadow setup. Lifted out of `src/main.js`'s `startGame()` unchanged;
 * the only edits are the ones decision 23 calls for — a local that a later step reads
 * became a field on `GameState` (or on `Game`, for the init-only ones) at the point it
 * is created, and the local went away.
 *
 * **Step 4 is load-bearing.** Both atlases are awaited here because everything
 * downstream that draws an item icon depends on them; see `refactor.md` §8.4.
 */

import { ItemTextureAtlas } from '../../engine/renderer/ItemTextureAtlas.js';
import { PerformanceSettings } from '../../engine/renderer/PerformanceSettings.js';
import { PBRTextureAtlas } from '../../engine/renderer/TextureAtlas.js';
import { registerBlockColorAtlas } from '../../game/data/BlockColors.js';
import { VoxelRenderer } from '../../engine/renderer/VoxelRenderer.js';
import { KeyboardInput } from '../../engine/input/Keyboard.js';
import { MouseInput } from '../../engine/input/Mouse.js';
import { TouchInput } from '../../engine/input/Touch.js';

/**
 * @param {import('../Game.js').Game} game
 */
export async function initScene(game) {
  const state = game.state;
  const deps = game.deps;
  const log = deps.log;

  // ══ Step 1 — hide screens / show loading ══════════════════════════════════════════════
  // The GameState belongs to no step; it is the object every step below writes to.

  // Hide all UI screens
  Object.values(deps.ui.screens).forEach(el => { if (el) el.classList.add('hidden'); });

  const container = game.container = document.getElementById('game-container');
  container.innerHTML = '';

  // ══ Step 2 — renderer ═════════════════════════════════════════════════════════════════

  // Initialize VoxelRenderer
  game.loadingStatus.textContent = 'Building 3D scene...';
  if (game.loadingProgress) game.loadingProgress.style.width = '30%';

  const renderer = state.renderer = new VoxelRenderer(container, window.innerWidth, window.innerHeight);
  log('[Cuubz] Renderer created');

  // ══ Step 3 — input ════════════════════════════════════════════════════════════════════

  // Initialize Input Systems
  game.loadingStatus.textContent = 'Setting up controls...';
  if (game.loadingProgress) game.loadingProgress.style.width = '40%';

  state.keyboard = new KeyboardInput();
  state.touch = new TouchInput();
  const canvas = state.canvas = renderer.domElement;
  const mouse = state.mouse = new MouseInput(canvas);

  // D-50 — the three input classes each carry an idempotent `dispose()` that removes
  // everything they bound, and **not one of them had a call site.** PR 18's adversarial
  // pass found them: the row's "eight `document` listeners" was an undercount, because
  // it counted the ones written inline in `startGame()` and not the ones a constructor
  // registers. `KeyboardInput` adds `keydown`/`keyup` on `document`, `MouseInput` adds
  // `pointerlockchange` on `document`, and `TouchInput` binds thirteen handlers to the
  // touch-control buttons in `index.html` — all three sets outlive the session, and the
  // touch ones outlive the canvas as well. The keyboard set is the one that was not
  // inert: `_onKeyDown` calls `e.preventDefault()` on `Space` with no focus guard, so
  // one exit to the menu left a stale handler eating the space bar in the character-name
  // and world-name inputs.
  state.addTeardown(() => state.keyboard && state.keyboard.dispose());
  state.addTeardown(() => state.touch && state.touch.dispose());
  state.addTeardown(() => mouse.dispose());

  // Request pointer lock on canvas click. Named, and registered for teardown (D-50):
  // an inline arrow cannot be removed, because `remove` would be handed a second
  // function. This canvas is replaced on the next session (step 1 empties the
  // container), so the removal is belt-and-braces rather than the whole leak — the
  // `document`-level listeners and `TouchInput`'s thirteen are the leak.
  const onCanvasClick = () => {
    if (!mouse.locked) {
      mouse.requestPointerLock();
    }
  };
  canvas.addEventListener('click', onCanvasClick);
  state.addTeardown(() => canvas.removeEventListener('click', onCanvasClick));

  // Initialize Terrain Generation (handled internally by ChunkManager)
  state.sensitivity = 0.002;
  game.loadingStatus.textContent = 'Initializing workers...';
  if (game.loadingProgress) game.loadingProgress.style.width = '50%';

  // ══ Step 4 — texture atlas ════════════════════════════════════════════════════════════
  // Two atlases and both `buildAtlas()` calls are awaited here. Everything downstream
  // that draws an item icon depends on them, which is what makes this order load-bearing.

  // Initialize Texture Atlas (async)
  game.loadingStatus.textContent = 'Loading textures...';
  if (game.loadingProgress) game.loadingProgress.style.width = '60%';

  // Determine tile size from settings
  const perfTexRes = deps.perfSettings ? deps.perfSettings.get('textureResolution') : 'high';
  const tileSize = PerformanceSettings.getTileSize(perfTexRes);
  const textureAtlas = state.textureAtlas = new PBRTextureAtlas({ tileSize });
  await textureAtlas.buildAtlas();
  // Dropped-item cubes take their colour from this atlas's tiles (D-51).
  registerBlockColorAtlas(textureAtlas);

  // Build item texture atlas for hotbar/inventory UI
  const itemAtlas = state.itemAtlas = new ItemTextureAtlas({ tileSize: 64 });
  await itemAtlas.buildAtlas();

  // ══ Step 5 — PBR + shadows ════════════════════════════════════════════════════════════

  // Initialize PBR material factory with the triple atlas
  const advancedShading = deps.perfSettings ? deps.perfSettings.get('advancedShading') : true;
  renderer.initPBR(textureAtlas, advancedShading);

  // Apply shadow quality from settings
  if (deps.perfSettings) {
    renderer.setShadowQuality(deps.perfSettings.get('shadowQuality'));
  }
}
