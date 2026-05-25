/**
 * Cuubz — Main Game Loop & State Management
 * Manages game state, mode (creative/survival), and the main render/update loop.
 * 
 * Creative Mode Features:
 * - Unlimited blocks (no inventory check for placement)
 * - No gravity (disabled when creative mode active)
 * - Fly mode (double-tap space to toggle)
 * - Block palette selector for all block types
 * - Toggle between Creative and Survival at runtime
 */

// ============================================================
// Mode Constants
// ============================================================

const MODES = {
  SURVIVAL: 'survival',
  CREATIVE: 'creative',
};

// ============================================================
// Double-Tap Detector (for fly mode toggle)
// ============================================================

class DoubleTapDetector {
  /**
   * Detects double-tap/double-press of a key within a time threshold.
   * Default threshold: 300ms between taps.
   */
  constructor(threshold = 300) {
    this.threshold = threshold;
    this.lastTapTime = 0;
  }

  /**
   * Check if the current tap forms a double-tap with the previous one.
   * @param {number} currentTime - Current timestamp (ms, e.g., performance.now())
   * @returns {boolean} true if double-tap detected
   */
  check(currentTime) {
    if (this.lastTapTime === 0) {
      this.lastTapTime = currentTime;
      return false;
    }

    const elapsed = currentTime - this.lastTapTime;
    
    if (elapsed < this.threshold) {
      // Double tap detected! Reset for next cycle.
      const isDoubleTap = true;
      this.lastTapTime = 0;
      return isDoubleTap;
    }

    // Too much time elapsed — treat as new single tap
    this.lastTapTime = currentTime;
    return false;
  }

  /**
   * Reset the detector state.
   */
  reset() {
    this.lastTapTime = 0;
  }
}

// ============================================================
// Block Palette (Creative Mode Block Selector)
// ============================================================

class BlockPalette {
  /**
   * Block palette for creative mode — allows selecting any block type
   * without needing it in inventory.
   */
  constructor() {
    // Import BLOCK_TYPES when available, use defaults otherwise
    try {
      const chunkData = require('./world/chunkData');
      this._availableBlocks = this._getPlaceableBlocks(chunkData.BLOCK_TYPES);
    } catch (e) {
      // Fallback: basic block types for testing without full module
      this._availableBlocks = [1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 13, 14];
    }

    // Default selected block: Stone (ID=3)
    this.selectedBlock = 3;
    
    // Callback for UI updates
    this.onSelectionChange = null;
  }

  /**
   * Get list of placeable block types (exclude air, water, lava, special items).
   */
  _getPlaceableBlocks(blockTypes) {
    if (!blockTypes) return [1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 13, 14];

    // Exclude: Air (0), Water (6), Lava (15), Toxic Slime (17), 
    //         Quest items (22, 24, 25, 26)
    const excludeSet = new Set([0, 6, 8, 15, 17, 22, 24, 25, 26]);
    
    const placeable = [];
    for (const [name, id] of Object.entries(blockTypes)) {
      if (typeof id === 'number' && !excludeSet.has(id)) {
        placeable.push(id);
      }
    }
    return placeable.sort((a, b) => a - b);
  }

  /**
   * Select a block by ID.
   * @param {number} blockId — Block type ID to select
   */
  selectBlock(blockId) {
    if (typeof blockId !== 'number' || blockId < 0 || !this._availableBlocks.includes(blockId)) {
      return; // Invalid selection — keep current
    }
    const prev = this.selectedBlock;
    this.selectedBlock = blockId;
    if (this.onSelectionChange && this.selectedBlock !== prev) {
      this.onSelectionChange(this.selectedBlock, prev);
    }
  }

  /**
   * Cycle to the next block in the palette.
   */
  cycleForward() {
    if (this._availableBlocks.length === 0) return;
    const currentIndex = this._availableBlocks.indexOf(this.selectedBlock);
    const nextIndex = (currentIndex + 1) % this._availableBlocks.length;
    this.selectBlock(this._availableBlocks[nextIndex]);
  }

  /**
   * Cycle to the previous block in the palette.
   */
  cycleBackward() {
    if (this._availableBlocks.length === 0) return;
    const currentIndex = this._availableBlocks.indexOf(this.selectedBlock);
    const prevIndex = (currentIndex - 1 + this._availableBlocks.length) % this._availableBlocks.length;
    this.selectBlock(this._availableBlocks[prevIndex]);
  }

  /**
   * Get all available block IDs.
   * @returns {number[]} Array of placeable block type IDs
   */
  getAllBlocks() {
    return [...this._availableBlocks];
  }

  /**
   * Get the current selected block ID.
   * @returns {number} Current selected block type ID
   */
  getSelectedBlock() {
    return this.selectedBlock;
  }
}

// ============================================================
// Main Game Class
// ============================================================

class Game {
  constructor() {
    this.running = false;
    this.mode = MODES.SURVIVAL; // Default to survival mode
    this.lastTime = 0;
    this.delta = 0;
    
    // Player reference (set by main.js)
    this.player = null;
    
    // Block palette for creative mode
    this.blockPalette = new BlockPalette();
    
    // Callback system
    this.onModeChange = null;
  }

  /**
   * Start the game loop in the specified mode.
   * @param {string} mode — 'survival' or 'creative'
   */
  start(mode) {
    if (mode) {
      this.setMode(mode);
    }
    this.running = true;
    this.lastTime = typeof performance !== 'undefined' ? performance.now() : Date.now();
    console.log(`[Game] Started in ${this.mode} mode`);
  }

  /**
   * Stop the game loop.
   */
  stop() {
    this.running = false;
    console.log('[Game] Stopped');
  }

  /**
   * Set the game mode, applying physics changes to the player.
   * @param {string} mode — 'survival' or 'creative'
   */
  setMode(mode) {
    if (mode === this.mode) return; // No change
    
    const oldMode = this.mode;
    
    if (mode !== MODES.SURVIVAL && mode !== MODES.CREATIVE) {
      console.warn(`[Game] Invalid mode: ${mode}. Keeping current mode: ${this.mode}`);
      return;
    }
    
    this.mode = mode;
    
    // Apply mode-specific changes to player
    if (this.player && typeof this.player.setCreativeMode === 'function') {
      this.player.setCreativeMode(this.isCreative());
    }
    
    // Fire callback
    if (this.onModeChange) {
      this.onModeChange(this.mode, oldMode);
    }
    
    console.log(`[Game] Mode changed: ${oldMode} → ${this.mode}`);
  }

  /**
   * Check if game is in creative mode.
   * @returns {boolean}
   */
  isCreative() {
    return this.mode === MODES.CREATIVE;
  }

  /**
   * Check if game is in survival mode.
   * @returns {boolean}
   */
  isSurvival() {
    return this.mode === MODES.SURVIVAL;
  }

  /**
   * Check if a block can be placed in the current mode.
   * In creative mode: always true (unlimited blocks).
   * In survival mode: depends on inventory having the block.
   * 
   * @param {number} blockId — Block type ID to place
   * @param {object} inventory — Current inventory (survival only)
   * @returns {boolean} Whether the block can be placed
   */
  canPlaceBlock(blockId, inventory) {
    if (this.isCreative()) {
      return true; // Unlimited blocks in creative mode
    }
    
    // Survival mode: check inventory
    if (!inventory) return false;
    if (typeof inventory.hasItem === 'function') {
      return inventory.hasItem(blockId);
    }
    
    // Fallback: manual slot check
    for (const slot of inventory.slots || []) {
      if (slot && slot.typeId === blockId && slot.count > 0) {
        return true;
      }
    }
    return false;
  }

  /**
   * Main game update loop.
   * @param {number} timestamp — Current timestamp from requestAnimationFrame
   */
  update(timestamp) {
    if (!this.running) return;
    
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    this.delta = (now - this.lastTime) / 1000; // seconds
    this.lastTime = now;
    
    // Clamp delta to prevent spiral of death
    if (this.delta > 0.1) this.delta = 0.1;
    
    // Update all game systems
    // this.renderer.update(this.delta);
    // this.world.update(this.delta);
    // this.player.update(this.delta);
    // this.survival.update(this.delta);
    
    requestAnimationFrame((t) => this.update(t));
  }
}

// Attach constants to class for static access
Game.MODES = MODES;
Game.DoubleTapDetector = DoubleTapDetector;
Game.BlockPalette = BlockPalette;

// Export for browser context
if (typeof window !== 'undefined') {
  window.CuubzGame = Game;
  window.CuubzDoubleTapDetector = DoubleTapDetector;
  window.CuubzBlockPalette = BlockPalette;
}

module.exports = Game;
