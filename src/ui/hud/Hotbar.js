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

    // The item atlas covers BOTH named items and blocks now, so string and number keys
    // take the same path. They used to be two byte-identical branches with only the
    // `typeof` differing, below a third branch that read the block atlas directly — and
    // that third branch was unreachable for exactly the block ids the item atlas had a
    // (wrong, flat-coloured) placeholder for. See the header of
    // src/engine/renderer/ItemTextureAtlas.js.
    const slot = itemAtlas.slotMap[typeId];
    if (slot) {
      const srcCell = itemAtlas.tileSize + itemAtlas._gap;
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(itemAtlas.canvas, itemAtlas._gap + slot.col * srcCell, itemAtlas._gap + slot.row * srcCell, itemAtlas.tileSize, itemAtlas.tileSize, 0, 0, w, h);
      return;
    }

    // Kept as a real fallback, not a dead one: `ItemTextureAtlas` degrades to named items
    // only if it is constructed without a block atlas, and this is what still draws
    // blocks in that case.
    if (typeof typeId === 'number' && textureAtlas.tileMap[typeId]) {
      const blockEntry = textureAtlas.tileMap[typeId];
      const tile = blockEntry.tiles.all || blockEntry.tiles.side || blockEntry.tiles.top;
      if (tile) {
        const srcCell = textureAtlas.tileSize + textureAtlas._gap;
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(textureAtlas.diffuseCanvas, textureAtlas._gap + tile.col * srcCell, textureAtlas._gap + tile.row * srcCell, textureAtlas.tileSize, textureAtlas.tileSize, 0, 0, w, h);
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
