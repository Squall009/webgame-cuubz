/**
 * Cuubz — `Game.init()` step 6 (PR 17)
 *
 * The day/night cycle and the atlas debug overlay. Both were one block in `startGame()`
 * and stay one block here: the overlay draws the texture atlas built in step 4, so it
 * cannot move above it, and it has no other coupling.
 *
 * The overlay is left hidden — `#atlas-overlay` keeps its `.hidden` class. Removing that
 * line is the debug switch, exactly as it was in `main.js`.
 */

import { Skybox } from '../../engine/renderer/SkyRenderer.js';

/**
 * @param {import('../Game.js').Game} game
 */
export function initSkybox(game) {
  const state = game.state;
  const log = game.deps.log;
  const renderer = state.renderer;
  const textureAtlas = state.textureAtlas;

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
    log('[Cuubz] Day/night cycle initialized (5-min cycle, starting at 8:00)');
  }
  // Assigned after the `if`, never inside it, so `null` (no Skybox) is recorded too.
  state.skybox = skybox;

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
}
