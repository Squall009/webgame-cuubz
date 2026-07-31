/**
 * Cuubz — markup template (PR 26)
 *
 * `#crafting-screen` — the inventory + crafting overlay (E key). `#crafting-inv-grid`
 * is empty here on purpose: `src/ui/overlays/InventoryScreen.js` builds its 36
 * `.inventory-slot` children, and the e2e suite counts exactly 36 of them **as
 * descendants of that id**.
 *
 * Verbatim from `index.html`, which this replaces. Mounted eagerly by
 * `src/ui/templates/index.js` before anything wires a listener — decision 53.
 * The indentation is load-bearing only in that it reproduces the original
 * document's whitespace text nodes exactly; nothing here may gain or lose a
 * text node without checking `test/e2e/saveLoad.js` first.
 */

export const CRAFTING_SCREEN_TEMPLATE = `  <!-- Inventory + Crafting Screen (toggleable with E key) -->
  <div id="crafting-screen" class="overlay hidden">
    <div class="crafting-container">
      <!-- Title + station indicator -->
      <div class="crafting-header">
        <span class="crafting-title">Inventory</span>
        <span id="crafting-station-indicator" class="crafting-station hidden">🔨 At Crafting Table</span>
      </div>

      <!-- Left: Recipe List (scrollable) -->
      <div class="crafting-recipes" id="crafting-recipe-list">
        <!-- Populated dynamically -->
      </div>

      <!-- Right: Player Inventory Grid -->
      <div class="crafting-inventory">
        <div class="crafting-inventory-label">Inventory</div>
        <div id="crafting-inv-grid"></div>
      </div>

      <!-- Far Right: Equipment Panel -->
      <div class="equipment-panel">
        <div class="equipment-label">Equipment</div>
        <div class="equipment-stats">
          <span class="defense-stat">🛡️ Defense: <span id="defense-value">0</span></span>
          <span class="toughness-stat">✦ Toughness: <span id="toughness-value">0</span></span>
        </div>
        <div class="equipment-slots" id="equipment-slots">
          <div class="equipment-slot" data-slot="helmet">
            <div class="equip-slot-icon"></div>
            <div class="equip-slot-label">Helmet</div>
          </div>
          <div class="equipment-slot" data-slot="chestplate">
            <div class="equip-slot-icon"></div>
            <div class="equip-slot-label">Chestplate</div>
          </div>
          <div class="equipment-slot" data-slot="leggings">
            <div class="equip-slot-icon"></div>
            <div class="equip-slot-label">Leggings</div>
          </div>
          <div class="equipment-slot" data-slot="boots">
            <div class="equip-slot-icon"></div>
            <div class="equip-slot-label">Boots</div>
          </div>
        </div>
        <div class="equipment-help">Drag armor here to equip</div>
      </div>
    </div>

    <button id="btn-close-crafting" class="overlay-close">✕</button>
  </div>`;
