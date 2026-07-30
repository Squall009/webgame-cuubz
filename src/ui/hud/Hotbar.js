/**
 * Cuubz — hotbar and item icons (PR 17)
 *
 * `refactor.md` §13 sends "hotbar update" here. Two functions came out of `startGame()`'s
 * step 13: `renderItemIcon`, which every inventory surface uses, and `updateHotbarUI`,
 * which the render loop drives every fifth frame.
 *
 * **`updateHotbarUI` removes and recreates nine `<canvas>` elements per call.** That is
 * why the `% 5` throttle in the render loop matters and why `BUGS.md` **D-34** — the
 * `frameCount` that never incremented, so the throttle never fired — was worth fixing.
 * Nothing here is memoised; making it so is a change with a measurement attached, not a
 * cleanup.
 *
 * Both are installed on the `GameState` (`state.renderItemIcon`, `state.updateHotbarUI`)
 * because the inventory overlay and the drag handlers call them and they used to be
 * sibling closures.
 */

/**
 * Build the hotbar's two functions against a live `GameState`.
 *
 * @param {import('../../core/GameState.js').GameState} state
 * @returns {{renderItemIcon: Function, updateHotbarUI: Function}}
 */
export function createHotbar(state) {
  /**
   * Draw an item icon onto a canvas element using the item texture atlas, or the block
   * texture atlas for block items.
   */
  function renderItemIcon(canvasEl, typeId) {
    const itemAtlas = state.itemAtlas;
    const textureAtlas = state.textureAtlas;
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
      const tile = blockEntry.tiles.top || blockEntry.tiles.side || blockEntry.tiles.all;
      if (tile) {
        const src = textureAtlas.diffuseCanvas;
        const srcCell = textureAtlas.tileSize + textureAtlas._gap;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(src, textureAtlas._gap + tile.col * srcCell, textureAtlas._gap + tile.row * srcCell, textureAtlas.tileSize, textureAtlas.tileSize, 0, 0, w, h);
      }
    }
  }

  /** Repaint all nine hotbar slots from the live inventory. */
  function updateHotbarUI() {
    const inventory = state.inventory;
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

  return { renderItemIcon, updateHotbarUI };
}
