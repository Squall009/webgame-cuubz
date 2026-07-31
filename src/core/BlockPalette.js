/**
 * Cuubz — Block Palette (creative-mode block selector)
 *
 * Split out of `src/core/Game.js` in **PR 17**, and only because of the 400-line
 * ceiling: `Game.js` absorbed `startGame()`'s orchestration in that PR and this class
 * has nothing to do with it. `Game.js` re-exports `BlockPalette`, so
 * `require('../src/core/Game.js').BlockPalette` — which `test_creativeMode.js` does —
 * still resolves.
 */

import { BLOCK_TYPES } from '../engine/world/BlockRegistry.js';

export class BlockPalette {
  /**
   * Block palette for creative mode — allows selecting any block type
   * without needing it in inventory.
   */
  constructor() {
    // D-27: `typeof BLOCK_TYPES !== 'undefined' ? BLOCK_TYPES : null` and the `if (bt)`
    // it fed were a constant-true pair — `BLOCK_TYPES` is a module import — so the
    // hard-coded `else` list was unreachable. The `try`/`catch` below is a separate
    // guard (`_getPlaceableBlocks` iterating a malformed table) and stays.
    try {
      this._availableBlocks = this._getPlaceableBlocks(BLOCK_TYPES);
    } catch (e) {
      // Fallback: basic block types for testing without full module
      this._availableBlocks = [1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 13, 14];
    }

    // Default selected block: Stone. Resolve by name — this was hard-coded to 3,
    // which stopped being stone when the blocks were renumbered (3 is cobblestone).
    // D-27: the `typeof BLOCK_TYPES !== 'undefined' &&` half is dead (module import);
    // the `.STONE !== undefined` half is a real table lookup and stays.
    this.selectedBlock = BLOCK_TYPES.STONE !== undefined ? BLOCK_TYPES.STONE : 3;

    // Callback for UI updates
    this.onSelectionChange = null;
  }

  /**
   * Get list of placeable block types (exclude air, water, lava, special items).
   */
  _getPlaceableBlocks(blockTypes) {
    if (!blockTypes) return [1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 13, 14];

    // Exclude by NAME, never by literal id — the previous hard-coded id set predated
    // the block renumbering, so it excluded granite/deepslate/ores while letting
    // water, lava and the quest items into the creative palette.
    const excludeSet = new Set(
      ['AIR', 'WATER', 'LAVA', 'TOXIC_SLIME', 'CORRUPT_CRYSTAL', 'APPLE', 'QUEST_KEY']
        .map(n => blockTypes[n])
        .filter(id => typeof id === 'number')
    );

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
