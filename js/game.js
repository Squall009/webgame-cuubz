/**
 * Cuubz — Main Game Loop & State Management
 * Manages game state, mode (creative/survival), and the main render/update loop.
 */

class Game {
  constructor() {
    this.running = false;
    this.mode = 'survival'; // 'creative' | 'survival'
    this.lastTime = 0;
    this.delta = 0;
  }

  start(mode) {
    this.mode = mode || this.mode;
    this.running = true;
    this.lastTime = performance.now();
    console.log(`[Game] Started in ${this.mode} mode`);
  }

  stop() {
    this.running = false;
    console.log('[Game] Stopped');
  }

  update(timestamp) {
    if (!this.running) return;
    
    this.delta = (timestamp - this.lastTime) / 1000; // seconds
    this.lastTime = timestamp;
    
    // TODO: Update all game systems
    // this.renderer.update(this.delta);
    // this.world.update(this.delta);
    // this.player.update(this.delta);
    // this.survival.update(this.delta);
    
    requestAnimationFrame((t) => this.update(t));
  }
}

// Export for browser context
if (typeof window !== 'undefined') {
  window.CuubzGame = Game;
}

module.exports = Game;
