/**
 * Cuubz — the debug stats overlay (PR 18)
 *
 * `src/main.js:848–886`, plus the three module-level FPS `let`s that stood at
 * `main.js:370–372` and are module-level state here for the same reason they were
 * there: the rolling average spans frames, so it cannot live on the call stack.
 *
 * `RenderLoop` calls this once per unpaused frame, after the mob system and **before**
 * `state.frameCount++` — main.js:836's position exactly.
 */

/**
 * FPS tracking state — shared across frames for rolling average.
 */
let _fpsFrames = 0;
let _fpsLastTime = performance.now();
let _currentFps = 0;

/**
 * @param {import('../../core/GameState.js').GameState} state
 */
export function updateDebugStats(state) {
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
