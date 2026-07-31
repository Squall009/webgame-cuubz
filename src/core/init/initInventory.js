/**
 * Cuubz — `Game.init()` steps 12 and 13 (PR 17)
 *
 * Block interaction, the inventory, crafting, the multiplayer inventory sync, the
 * saved-inventory restore and the dropped-items system — then the three UI modules that
 * hang off them.
 *
 * **Step 13 was 874 lines and was not a "step".** It was the inventory / crafting /
 * hotbar DOM knot, and it is why decision 23 said the fifteen numbered steps had to be
 * banner comments rather than functions. It is four files now: this one keeps the
 * systems and the wiring, `src/ui/hud/Hotbar.js` has the icons and the hotbar,
 * `src/ui/overlays/InventoryScreen.js` the grid/equipment/recipe render and the toggle,
 * and `src/ui/overlays/InventoryDrag.js` the drag lifecycle. `refactor.md` §13 already
 * named all three destinations.
 *
 * **The mob system gets the inventory here**, two steps after it was constructed with
 * `inventory: null`. That coupling is load-bearing (`BUGS.md` D-36) and auto-loot is
 * what breaks if the order is "corrected".
 */

import { BlockInteraction } from '../../game/systems/BlockInteractionSystem.js';
import { CraftingSystem } from '../../game/systems/CraftingSystem.js';
import { EQUIPMENT_SLOT_ORDER, Inventory } from '../../game/systems/InventorySystem.js';
import { InventorySync } from '../../multiplayer/InventorySync.js';
import { createDroppedItems } from '../../game/systems/DroppedItemsSystem.js';
import { createHotbar } from '../../ui/hud/Hotbar.js';
import { createInventoryScreen } from '../../ui/overlays/InventoryScreen.js';
import { installInventoryDrag } from '../../ui/overlays/InventoryDrag.js';

/**
 * @param {import('../Game.js').Game} game
 */
export function initInventory(game) {
  const state = game.state;
  const deps = game.deps;
  const log = deps.log;
  const sm = deps.sessionManager;

  // ══ Step 12 — block interaction ═══════════════════════════════════════════════════════

  const blockInteraction = state.blockInteraction = new BlockInteraction({
    renderer: state.renderer,
    chunkManager: state.chunkManager,
    mouse: state.mouse,
    player: state.player,
    touch: state.touch, // Mobile break/place support
  });

  // ══ Step 13 — inventory + systems ═════════════════════════════════════════════════════

  // ─── Initialize Inventory System ────────────────
  const inventory = state.inventory = new Inventory();
  state.player.inventory = inventory;

  // Wire inventory into mob system for auto-loot
  if (state.mobIntegration && state.mobIntegration.getManager()) {
    state.mobIntegration.getManager().setPlayerInventory(inventory);
  }

  // ─── Initialize Crafting System ─────────────────
  state.crafting = new CraftingSystem(inventory);

  // ─── Multiplayer: Inventory Sync ────────────────
  let inventorySync = null;
  // D-27: the `typeof InventorySync !== 'undefined' &&` half is gone (module import);
  // `sm && sm.client` is the real guard — single-player has no session manager.
  if (sm && sm.client) {
    inventorySync = new InventorySync(inventory, { playerId: sm.client.playerId });

    // On join: send full inventory to host
    if (sm.currentSessionId && !sm.hostingSessionId) {
      const joinPayload = inventorySync.createJoinPayload();
      sm.client.sendInventory(joinPayload);
      log('[Cuubz] Sent initial inventory to host on join');
    }

    // Start periodic diff sync (5s interval)
    inventorySync.startPeriodicSync((payload) => {
      if (sm.client && sm.client.isGameSessionConnected) {
        sm.client.sendInventory(payload);
      }
    });

    // Handle incoming inventory sync from host
    sm.client.onGame('INVENTORY_SYNC', (data) => {
      if (inventorySync && data.playerId && data.inventory) {
        // Only apply host's authoritative sync for our own inventory
        if (data.playerId === sm.client.playerId) {
          inventorySync.applyRemoteSync(data.playerId, data.inventory);
        }
      }
    });

    log('[Cuubz] InventorySync initialized');
  }
  state.inventorySync = inventorySync;

  // Load saved inventory from character data
  const selectedChar = deps.characterManager ? deps.characterManager.getSelectedCharacter() : null;
  if (selectedChar) {
    try {
      const savedInv = Inventory.deserialize({
        rows: 4, cols: 9,
        selectedHotbarSlot: 0,
        slots: selectedChar.inventory || [],
        equipment: selectedChar.equipment || {},
      });
      // Copy saved slots into our inventory
      for (let i = 0; i < savedInv.totalSlots; i++) {
        inventory.slots[i] = savedInv.slots[i];
      }
      // Copy saved equipment
      // D-27: was wrapped in `if (typeof EQUIPMENT_SLOT_ORDER !== 'undefined')` — dead,
      // `EQUIPMENT_SLOT_ORDER` is a module import.
      for (const slot of EQUIPMENT_SLOT_ORDER) {
        if (savedInv.equipment[slot]) {
          inventory.equipment[slot] = { ...savedInv.equipment[slot] };
        }
      }
      log('[Cuubz] Loaded saved inventory with ' + savedInv.getItems().length + ' items' +
        (Object.keys(savedInv.equipment || {}).length > 0 ? ' and equipment' : ''));
    } catch (e) {
      log('[Cuubz] Failed to load saved inventory: ' + e.message);
    }

    // Initialize HUD armor indicator from loaded equipment
    const armorStats = inventory.getEquipmentStats();
    const armorIndicatorHud = document.getElementById('armor-indicator');
    const hudDefense = document.getElementById('hud-defense');
    if (armorIndicatorHud && hudDefense) {
      if (armorStats.totalArmor > 0) {
        hudDefense.textContent = armorStats.totalArmor;
        armorIndicatorHud.classList.remove('hidden');
      }
    }
  }

  // Wire inventory to block interaction (for block drops)
  blockInteraction.inventory = inventory;

  // ─── Dropped Items System ──────────────────────
  // Constructed before the two callbacks below reach for it. In `main.js` the object
  // literal was declared *after* `onBlockBroken` closed over the name, which worked
  // because the closure only ran at break time; the order is explicit here.
  const droppedItems = state.droppedItems = createDroppedItems(state.renderer.scene, log);

  // Wire block broken callback to spawn dropped items
  blockInteraction.onBlockBroken = (dropType, worldPos) => {
    droppedItems.addDrop(dropType, worldPos);
  };

  // Wire break-started callback to trigger first-person hand swing
  blockInteraction.onBreakStarted = () => {
    if (state.firstPersonHand) state.firstPersonHand.swing();
  };

  // ─── Hotbar, inventory overlay and drag handling ───────────────────────────
  //
  // The three call each other through `state` (see `GameState`'s field block): a slot
  // change repaints the hotbar and, if the overlay is open, the grid; a craft repaints
  // both. They were sibling closures and this is the same graph made explicit.
  const hotbar = createHotbar(state);
  state.renderItemIcon = hotbar.renderItemIcon;
  state.updateHotbarUI = hotbar.updateHotbarUI;

  const overlay = createInventoryScreen(state);
  state.renderInventoryCraftingUI = overlay.renderInventoryCraftingUI;
  state.toggleInventoryScreen = overlay.toggleInventoryScreen;

  installInventoryDrag(state);

  // Wire inventory callbacks for hotbar updates
  inventory.onSlotChange = () => {
    state.updateHotbarUI();
    if (state.inventoryOpen) state.renderInventoryCraftingUI();
  };
  inventory.onSelectionChange = () => {
    state.updateHotbarUI();
    // Update first-person hand to show the selected item
    if (state.firstPersonHand) {
      const item = inventory.getSelectedItem();
      state.firstPersonHand.setItem(item ? item.typeId : null);
    }
  };

  // Initial hotbar render
  state.updateHotbarUI();

  // Set first-person hand to the initially selected item
  if (state.firstPersonHand) {
    const item = inventory.getSelectedItem();
    state.firstPersonHand.setItem(item ? item.typeId : null);
  }
}
