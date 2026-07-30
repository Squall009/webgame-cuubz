/**
 * Cuubz — inventory + crafting overlay (PR 17)
 *
 * `refactor.md` §13 sends "inventory toggle, crafting screen" to `src/ui/overlays/*`.
 * This is the render half — the slot grid, the equipment panel, the recipe list and the
 * open/close toggle. The document-level drag lifecycle is `InventoryDrag.js`; the two
 * were interleaved closures inside `startGame()`'s step 13 and are split here because
 * §8.2's 400-line ceiling binds (decision 33).
 *
 * ─── D-49 ───────────────────────────────────────────────────────────────────
 *
 * `renderInventoryCraftingUI` called `checkNearCraftingTable(player, game.chunkManager)`.
 * **`game.chunkManager` has been `undefined` since PR 12** folded the ad-hoc `game.*`
 * props onto `GameState`, so the very first line of the proximity scan threw
 * `TypeError: Cannot read properties of undefined (reading 'getVoxel')` — and it threw
 * *before* `craftingScreen.classList.remove('hidden')`, so **pressing E did not open the
 * inventory at all.** Five green e2e runs did not see it because no assertion had ever
 * pressed E. It reads `state.chunkManager` now, and `test/e2e/saveLoad.js` presses E and
 * asserts the screen opens.
 */

import { NAMED_ITEMS } from '../../game/systems/InventorySystem.js';
import { BLOCK_TYPES } from '../../engine/world/BlockRegistry.js';

/**
 * Is the player within 4 blocks of a crafting table?
 * @param {object} player
 * @param {object} chunkManager
 */
export function checkNearCraftingTable(player, chunkManager) {
  const px = Math.floor(player.position.x);
  const py = Math.floor(player.position.y);
  const pz = Math.floor(player.position.z);
  const range = 4;

  for (let dx = -range; dx <= range; dx++) {
    for (let dy = -range; dy <= range; dy++) {
      for (let dz = -range; dz <= range; dz++) {
        const wx = px + dx, wy = py + dy, wz = pz + dz;
        const block = chunkManager.getVoxel(wx, wy, wz);
        if (block === BLOCK_TYPES.CRAFTING_TABLE) return true;
      }
    }
  }
  return false;
}

/**
 * Build the overlay's render/toggle functions against a live `GameState`.
 *
 * Reads `state.renderItemIcon` and `state.updateHotbarUI`, which `createHotbar()` puts
 * there — this file is constructed after it and never before.
 *
 * @param {import('../../core/GameState.js').GameState} state
 * @returns {{renderInventoryCraftingUI: Function, toggleInventoryScreen: Function}}
 */
export function createInventoryScreen(state) {
  const craftingScreen = document.getElementById('crafting-screen');

  /** Render the interactive inventory grid with drag-and-drop support. */
  function renderInventoryGrid(container) {
    if (!container) return;
    const inventory = state.inventory;
    container.innerHTML = '';

    for (let i = 0; i < inventory.totalSlots; i++) {
      const slot = inventory.getSlot(i);
      const isHotbar = inventory.isHotbarSlot(i);
      const div = document.createElement('div');
      div.className = 'inventory-slot' + (isHotbar ? ' hotbar' : '');
      div.dataset.slot = i;

      if (slot) {
        const name = inventory.getDisplayName(slot.typeId);

        // Create canvas for item icon
        const canvas = document.createElement('canvas');
        canvas.className = 'item-icon';
        canvas.width = 48;
        canvas.height = 48;
        state.renderItemIcon(canvas, slot.typeId);
        div.appendChild(canvas);

        // Show count badge if > 1
        if (slot.count > 1) {
          const countEl = document.createElement('span');
          countEl.className = 'item-count';
          countEl.textContent = slot.count;
          div.appendChild(countEl);
        }

        div.title = name + (slot.count > 1 ? ' (x' + slot.count + ')' : '');
      } else {
        div.title = 'Empty slot';
      }

      // ── Right-click: split stack (move 1 to nearest compatible slot) ──
      div.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        const fromIdx = parseInt(div.dataset.slot);
        const fromSlot = inventory.getSlot(fromIdx);
        if (!fromSlot || fromSlot.count <= 1) return;

        // Find nearest empty slot or matching slot with space
        let targetIdx = -1;
        for (let j = 0; j < inventory.totalSlots; j++) {
          if (j === fromIdx) continue;
          const target = inventory.getSlot(j);
          if (!target) { targetIdx = j; break; }
          if (inventory.itemsMatch(target.typeId, fromSlot.typeId)) {
            const maxStack = inventory.getMaxStack(fromSlot.typeId);
            if (target.count < maxStack) { targetIdx = j; break; }
          }
        }
        if (targetIdx >= 0) {
          const maxStack = inventory.getMaxStack(fromSlot.typeId);
          const target = inventory.getSlot(targetIdx);
          const space = target ? (maxStack - target.count) : maxStack;
          const moveCount = Math.min(1, fromSlot.count, space);
          fromSlot.count -= moveCount;
          if (fromSlot.count <= 0) inventory.clearSlot(fromIdx);
          if (!target) {
            inventory.setSlot(targetIdx, { typeId: fromSlot.typeId, count: moveCount });
          } else {
            target.count += moveCount;
            inventory._notifySlotChange(targetIdx);
          }
          inventory._notifySlotChange(fromIdx);
          renderInventoryCraftingUI();
          state.updateHotbarUI();
        }
      });

      container.appendChild(div);
    }
  }

  /** Render the equipment panel UI (4 armor slots + stats). */
  function renderEquipmentUI() {
    const inventory = state.inventory;
    const container = document.getElementById('equipment-slots');
    const defenseEl = document.getElementById('defense-value');
    const toughnessEl = document.getElementById('toughness-value');
    if (!container) return;

    // Update stats
    const stats = inventory.getEquipmentStats();
    if (defenseEl) defenseEl.textContent = stats.totalArmor;
    if (toughnessEl) toughnessEl.textContent = stats.totalToughness;

    // Update HUD armor indicator
    const armorIndicator = document.getElementById('armor-indicator');
    const hudDefense = document.getElementById('hud-defense');
    if (armorIndicator && hudDefense) {
      if (stats.totalArmor > 0) {
        hudDefense.textContent = stats.totalArmor;
        armorIndicator.classList.remove('hidden');
      } else {
        armorIndicator.classList.add('hidden');
      }
    }

    // Render each slot
    const slots = container.querySelectorAll('.equipment-slot');
    for (const slotEl of slots) {
      const slotName = slotEl.dataset.slot;
      const iconContainer = slotEl.querySelector('.equip-slot-icon');
      const item = inventory.getEquippedItem(slotName);

      // Clear previous content
      iconContainer.innerHTML = '';

      if (item) {
        slotEl.classList.add('occupied');

        // Draw item icon
        const canvas = document.createElement('canvas');
        canvas.className = 'item-icon';
        canvas.width = 48;
        canvas.height = 48;
        state.renderItemIcon(canvas, item.typeId);
        iconContainer.appendChild(canvas);

        // Show armor value badge
        const def = NAMED_ITEMS[item.typeId];
        if (def) {
          const badge = document.createElement('span');
          badge.className = 'equip-stat-badge';
          badge.textContent = '🛡' + (def.armorValue || 0);
          slotEl.appendChild(badge);
        }

        slotEl.title = inventory.getDisplayName(item.typeId);
      } else {
        slotEl.classList.remove('occupied');
        slotEl.title = 'Empty - drag armor here';
      }
    }
  }

  /** Render the combined inventory + crafting UI — recipe list + interactive grid. */
  function renderInventoryCraftingUI() {
    const inventory = state.inventory;
    const crafting = state.crafting;
    const recipeList = document.getElementById('crafting-recipe-list');
    const invGrid = document.getElementById('crafting-inv-grid');
    const stationIndicator = document.getElementById('crafting-station-indicator');

    if (!recipeList || !invGrid) return;

    // Check crafting table proximity.
    // D-49: this read `game.chunkManager`, which PR 12 emptied — see the file header.
    const atTable = checkNearCraftingTable(state.player, state.chunkManager);
    if (stationIndicator) {
      stationIndicator.classList.toggle('hidden', !atTable);
    }

    // Get craftable recipes
    const recipes = crafting.getCraftableRecipes(inventory, atTable);

    // Render recipe list
    recipeList.innerHTML = '';
    if (recipes.length === 0) {
      recipeList.innerHTML = '<div class="crafting-empty-msg">No recipes available. Gather materials or find a crafting table.</div>';
    } else {
      for (const recipe of recipes) {
        const card = document.createElement('div');
        card.className = 'recipe-card';
        card.dataset.recipeId = recipe.id;

        // Ingredients
        let cardHTML = '<div class="recipe-ingredients">';
        for (let i = 0; i < recipe.ingredients.length; i++) {
          if (i > 0) cardHTML += '<span class="recipe-plus">+</span>';
          const ing = recipe.ingredients[i];
          // Resolve actual typeId to display (handles typeIds array)
          const displayTypeId = crafting._getIngredientType(inventory, ing);
          cardHTML += `<div class="recipe-ing-slot">
                <canvas class="item-icon" width="32" height="32" data-typeid="${displayTypeId}"></canvas>
                <span class="ing-count">${ing.count}</span>
              </div>`;
        }
        cardHTML += '</div>';

        // Output
        const outCount = recipe.output.count || 1;
        cardHTML += `<div class="recipe-arrow">→</div>
              <div class="recipe-output">
                <canvas class="item-icon" width="40" height="40" data-typeid="${recipe.output.typeId}"></canvas>
                ${outCount > 1 ? `<span class="output-count">${outCount}</span>` : ''}
              </div>`;

        // Name
        cardHTML += `<div class="recipe-name">${recipe.name}</div>`;

        card.innerHTML = cardHTML;

        // Click → craft
        card.addEventListener('click', () => {
          crafting.craftRecipe(recipe.id, inventory);
          renderInventoryCraftingUI();
          state.updateHotbarUI();
        });

        recipeList.appendChild(card);

        // Draw icons after DOM insertion
        card.querySelectorAll('canvas[data-typeid]').forEach(canvas => {
          const typeId = canvas.dataset.typeid;
          // Preserve type: numeric strings that are pure numbers → parseInt, otherwise keep as string
          state.renderItemIcon(canvas, /^\d+$/.test(typeId) ? parseInt(typeId, 10) : typeId);
        });
      }
    }

    // Render interactive inventory grid
    renderInventoryGrid(invGrid);

    // Render equipment panel
    renderEquipmentUI();
  }

  /** Toggle inventory + crafting screen open/closed. */
  function toggleInventoryScreen() {
    state.inventoryOpen = !state.inventoryOpen;
    const hotbarContainer = document.getElementById('hotbar-container');

    if (state.inventoryOpen) {
      // Unlock mouse so player can use inventory UI
      if (document.pointerLockElement) {
        document.exitPointerLock();
      }
      // Hide hotbar when inventory screen is open
      if (hotbarContainer) hotbarContainer.classList.add('hidden');
      renderInventoryCraftingUI();
      craftingScreen.classList.remove('hidden');
    } else {
      // Re-lock mouse when closing inventory
      state.renderer.domElement.requestPointerLock();
      // Show hotbar when inventory screen is closed
      if (hotbarContainer) hotbarContainer.classList.remove('hidden');
      craftingScreen.classList.add('hidden');
    }
  }

  // ─── The close button and the mobile crafting button ───
  const btnCloseCrafting = document.getElementById('btn-close-crafting');
  if (btnCloseCrafting) {
    btnCloseCrafting.addEventListener('click', () => {
      state.inventoryOpen = false;
      state.renderer.domElement.requestPointerLock();
      const hotbarContainer = document.getElementById('hotbar-container');
      if (hotbarContainer) hotbarContainer.classList.remove('hidden');
      craftingScreen.classList.add('hidden');
    });
  }

  const mobileCraftBtn = document.getElementById('btn-crafting-mobile');
  if (mobileCraftBtn) {
    mobileCraftBtn.addEventListener('touchstart', (e) => {
      e.preventDefault();
      if (!state.inventoryOpen) toggleInventoryScreen();
    });
  }

  return { renderInventoryCraftingUI, toggleInventoryScreen };
}
