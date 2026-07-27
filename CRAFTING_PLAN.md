# Crafting Menu Implementation Plan

## Overview

Add a crafting menu (toggle with **C** key) that shows recipes filterable by available inventory materials. Two crafting tiers: **hand crafting** (always available) and **crafting table** (requires standing adjacent to a `crafting_table` block, ID 162).

---

## Architecture

```
C key pressed
  → toggleCraftingMenu()
    → exit/re-enter pointer lock
    → show/hide #crafting-screen overlay
    → renderCraftingUI()
      → checkNearCraftingTable()
      → getCraftableRecipes(inventory, atTable)
      → render recipe list + inventory grid
        → click recipe → executeRecipe(recipeId)
```

---

## Files to Modify / Create

| File | Action | Purpose |
|------|--------|---------|
| `js/systems/crafting.js` | **Rewrite** | Expand recipes, add `requiresTable` flag, add `canCraftRecipe()` filter |
| `index.html` | **Edit** | Add `#crafting-screen` overlay HTML |
| `css/style.css` | **Edit** | Add crafting UI styles |
| `js/main.js` | **Edit** | Wire C key, `toggleCraftingMenu()`, `renderCraftingUI()`, `checkNearCraftingTable()` |
| `js/input/keyboard.js` | **No change** | C key is already tracked in `this.keys`; handled in main.js gameKeyHandler |

---

## Phase 1 — Expand Recipe Definitions (`js/systems/crafting.js`)

### 1A. Add `requiresTable` flag to every recipe

```js
// Hand-craftable (requiresTable: false or omitted)
const RECIPES = {
  planks_oak: {
    id: 'planks_oak',
    name: 'Oak Planks',
    description: 'Convert oak logs into wooden planks.',
    ingredients: [ { typeId: BLOCK_TYPES.OAK_LOG, count: 1 } ],
    output: { typeId: BLOCK_TYPES.OAK_PLANKS, count: 4 },
    requiresTable: false,
    discoveryStage: 1,
  },
  // ...
};
```

### 1B. Recipes to define (hand-craftable)

| Recipe ID | Ingredients | Output | Notes |
|-----------|-------------|--------|-------|
| `planks_oak` | 1 Oak Log | 4 Oak Planks | Hand |
| `planks_spruce` | 1 Spruce Log | 4 Spruce Planks | Hand |
| `planks_birch` | 1 Birch Log | 4 Birch Planks | Hand |
| `planks_jungle` | 1 Jungle Log | 4 Jungle Planks | Hand |
| `stick` | 2 Oak Planks | 4 Sticks | Hand — needs new NAMED_ITEM `stick` |
| `torch` | 1 Plank + 1 Coal | 4 Torches | Hand |
| `crafting_table` | 4 Oak Planks | 1 Crafting Table | Hand |

### 1C. Recipes to define (crafting-table only)

| Recipe ID | Ingredients | Output | Notes |
|-----------|-------------|--------|-------|
| `wooden_pickaxe` | 3 Planks + 2 Sticks | 1 Wooden Pickaxe | Table |
| `wooden_axe` | 3 Planks + 2 Sticks | 1 Wooden Axe | Table |
| `wooden_sword` | 2 Planks + 1 Stick | 1 Wooden Sword | Table |
| `wooden_shovel` | 1 Plank + 2 Sticks | 1 Wooden Shovel | Table |
| `wooden_hoe` | 2 Planks + 2 Sticks | 1 Wooden Hoe | Table |
| `wooden_spear` | 2 Planks + 1 Stick | 1 Wooden Spear | Table |
| `stone_pickaxe` | 3 Cobblestone + 2 Sticks | 1 Stone Pickaxe | Table |
| `stone_axe` | 3 Cobblestone + 2 Sticks | 1 Stone Axe | Table |
| `stone_sword` | 2 Cobblestone + 1 Stick | 1 Stone Sword | Table |
| `stone_shovel` | 1 Cobblestone + 2 Sticks | 1 Stone Shovel | Table |
| `stone_hoe` | 2 Cobblestone + 2 Sticks | 1 Stone Hoe | Table |
| `stone_spear` | 2 Cobblestone + 1 Stick | 1 Stone Spear | Table |
| `bed` | 3 Planks | 1 Bed | Table |
| `ladder` | 7 Sticks | 4 Ladders | Table |
| `chest` | 8 Planks | 1 Chest | Table |
| `furnace` | 8 Cobblestone | 1 Furnace | Table |

### 1D. Add `stick` to NAMED_ITEMS in `inventory.js`

```js
stick: { name: 'Stick', category: ITEM_CATEGORIES.RESOURCE, maxStack: 64 },
```

Texture: ✅ Generated `textures/items/stick.png` (128×128 pixel art, diagonal wooden stick)

### 1E. Coal texture

`coal` is already a named item (`ITEM_CATEGORIES.RESOURCE`) but has no item texture.
The ItemTextureAtlas loads named items from `textures/items/${key}.png`, so we need to
add a texture. Per request: use the existing `textures/blocks/coal_block.png` as the coal item icon.

**Action:** Copy or symlink `textures/blocks/coal_block.png` → `textures/items/coal.png`

### 1F. Bed recipe removed

No bed texture exists. Removing the bed recipe from the plan.

### 1E. New method on CraftingSystem: `getCraftableRecipes(inventory, atCraftingTable)`

Returns only recipes where:
- `requiresTable` is false **or** `atCraftingTable` is true
- All ingredients are present in inventory in sufficient quantity
- Recipe is discovered

```js
getCraftableRecipes(inventory, atCraftingTable = false) {
  const results = [];
  for (const [id, recipe] of Object.entries(this.recipes)) {
    if (!this.discoveredRecipes.has(id)) continue;
    if (recipe.requiresTable && !atCraftingTable) continue;
    if (!this._hasAllIngredients(inventory, recipe)) continue;
    results.push({ id, ...recipe });
  }
  return results;
}

_hasAllIngredients(inventory, recipe) {
  for (const ing of recipe.ingredients) {
    if (!this._hasInInventory(ing.typeId, ing.count)) return false;
  }
  return true;
}
```

### 1F. New method: `craftRecipe(recipeId, inventory)`

Consumes ingredients, adds output, fires callback.

```js
craftRecipe(recipeId, inventory) {
  const recipe = this.recipes[recipeId];
  if (!recipe || !this._hasAllIngredients(inventory, recipe)) return null;

  // Consume
  for (const ing of recipe.ingredients) {
    inventory.removeItem(ing.typeId, ing.count);
  }
  // Produce
  inventory.addItem(recipe.output.typeId, recipe.output.count);

  if (this.onCraftComplete) {
    this.onCraftComplete({ recipeId, ...recipe.output });
  }
  return { recipeId, ...recipe.output };
}
```

---

## Phase 2 — Crafting Screen HTML (`index.html`)

Add a new overlay div after the inventory screen:

```html
<!-- Crafting Screen (toggleable with C key) -->
<div id="crafting-screen" class="overlay hidden">
  <div class="crafting-container">
    <!-- Title + station indicator -->
    <div class="crafting-header">
      <span class="crafting-title">Crafting</span>
      <span id="crafting-station-indicator" class="crafting-station hidden">🔨 At Crafting Table</span>
    </div>

    <!-- Left: Recipe List (scrollable) -->
    <div class="crafting-recipes" id="crafting-recipe-list">
      <!-- Populated dynamically: each recipe is a clickable card -->
    </div>

    <!-- Right: Player Inventory Grid -->
    <div class="crafting-inventory">
      <div class="crafting-inventory-label">Inventory</div>
      <div id="crafting-inv-grid"></div>
    </div>
  </div>

  <button id="btn-close-crafting" class="overlay-close">✕</button>
</div>
```

### Recipe card template (generated by JS):

```html
<div class="recipe-card" data-recipe-id="wooden_pickaxe">
  <div class="recipe-ingredients">
    <div class="recipe-ing-slot">
      <canvas class="item-icon" width="32" height="32"></canvas>
      <span class="ing-count">3</span>
    </div>
    <span class="recipe-plus">+</span>
    <div class="recipe-ing-slot">
      <canvas class="item-icon" width="32" height="32"></canvas>
      <span class="ing-count">2</span>
    </div>
  </div>
  <div class="recipe-arrow">→</div>
  <div class="recipe-output">
    <canvas class="item-icon" width="40" height="40"></canvas>
    <span class="output-count">1</span>
  </div>
  <div class="recipe-name">Wooden Pickaxe</div>
</div>
```

---

## Phase 3 — CSS Styles (`css/style.css`)

```css
/* ─── Crafting Screen ─────────────────────────────────────── */
#crafting-screen .crafting-container {
  display: flex;
  gap: 16px;
  padding: 20px;
  background: rgba(30, 30, 46, 0.95);
  border-radius: 12px;
  border: 1px solid rgba(255,255,255,0.1);
  max-width: 90vw;
  max-height: 80vh;
}

.crafting-header {
  position: absolute;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  text-align: center;
  pointer-events: none;
}

.crafting-title {
  font-size: 18px;
  font-weight: 700;
  color: #e0e0e0;
  text-shadow: 0 0 8px rgba(0,0,0,0.8);
}

.crafting-station {
  display: block;
  font-size: 12px;
  color: #4CAF50;
  margin-top: 2px;
}

/* Recipe list — left panel */
.crafting-recipes {
  display: flex;
  flex-direction: column;
  gap: 6px;
  max-height: 70vh;
  overflow-y: auto;
  padding-right: 8px;
  min-width: 260px;
  max-width: 320px;
}

.recipe-card {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: rgba(255,255,255,0.04);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.recipe-card:hover {
  background: rgba(76, 175, 80, 0.15);
  border-color: rgba(76, 175, 80, 0.4);
}

.recipe-card:active {
  transform: scale(0.98);
}

.recipe-ingredients {
  display: flex;
  align-items: center;
  gap: 4px;
}

.recipe-ing-slot {
  position: relative;
  width: 32px;
  height: 32px;
  background: rgba(255,255,255,0.06);
  border: 1px solid rgba(255,255,255,0.1);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
}

.recipe-ing-slot .item-icon {
  width: 28px;
  height: 28px;
  image-rendering: pixelated;
}

.ing-count {
  position: absolute;
  bottom: 0;
  right: 2px;
  font-size: 9px;
  font-weight: 700;
  color: #fff;
  text-shadow: 1px 1px 2px rgba(0,0,0,0.9);
}

.recipe-plus {
  font-size: 14px;
  color: #888;
}

.recipe-arrow {
  font-size: 16px;
  color: #4CAF50;
  flex-shrink: 0;
}

.recipe-output {
  position: relative;
  width: 40px;
  height: 40px;
  background: rgba(76, 175, 80, 0.1);
  border: 2px solid rgba(76, 175, 80, 0.3);
  border-radius: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.recipe-output .item-icon {
  width: 36px;
  height: 36px;
  image-rendering: pixelated;
}

.output-count {
  position: absolute;
  bottom: 0;
  right: 2px;
  font-size: 10px;
  font-weight: 700;
  color: #4CAF50;
  text-shadow: 1px 1px 2px rgba(0,0,0,0.9);
}

.recipe-name {
  font-size: 12px;
  color: #ccc;
  white-space: nowrap;
  margin-left: 4px;
}

/* Inventory grid — right panel */
.crafting-inventory {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
}

.crafting-inventory-label {
  font-size: 13px;
  color: #aaa;
}

#crafting-inv-grid {
  display: grid;
  grid-template-columns: repeat(9, 48px);
  grid-template-rows: repeat(4, 48px);
  gap: 3px;
}

#crafting-inv-grid .inventory-slot {
  width: 48px;
  height: 48px;
}

/* Empty state */
.crafting-empty-msg {
  text-align: center;
  color: #666;
  font-size: 13px;
  padding: 40px 20px;
}

/* Mobile */
@media (max-width: 600px) {
  #crafting-screen .crafting-container {
    flex-direction: column;
    max-height: 90vh;
  }
  .crafting-recipes {
    max-height: 40vh;
    min-width: unset;
    max-width: unset;
  }
  #crafting-inv-grid {
    grid-template-columns: repeat(9, 36px);
    grid-template-rows: repeat(4, 36px);
  }
  #crafting-inv-grid .inventory-slot {
    width: 36px;
    height: 36px;
  }
}
```

---

## Phase 4 — Game Integration (`js/main.js`)

### 4A. Create CraftingSystem instance

In `startGame()`, after inventory is created:

```js
const crafting = new CraftingSystem(inventory);
game.crafting = crafting;
```

### 4B. `checkNearCraftingTable(player, chunkManager)` — proximity check

```js
function checkNearCraftingTable(player, chunkManager) {
  const px = Math.floor(player.position.x);
  const py = Math.floor(player.position.y);
  const pz = Math.floor(player.position.z);
  const range = 4; // blocks

  for (let dx = -range; dx <= range; dx++) {
    for (let dy = -range; dy <= range; dy++) {
      for (let dz = -range; dz <= range; dz++) {
        const wx = px + dx, wy = py + dy, wz = pz + dz;
        const cx = Math.floor(wx / 16), cz = Math.floor(wz / 16);
        const chunk = chunkManager.getChunkData(cx, cz);
        if (!chunk) continue;
        const lx = ((wx % 16) + 16) % 16;
        const lz = ((wz % 16) + 16) % 16;
        const block = chunk.getBlock(lx, wy, lz);
        if (block === BLOCK_TYPES.CRAFTING_TABLE) return true;
      }
    }
  }
  return false;
}
```

### 4C. `renderCraftingUI()` — populate the screen

Called every time the crafting screen opens (and when inventory changes while open):

```js
function renderCraftingUI() {
  const recipeList = document.getElementById('crafting-recipe-list');
  const invGrid = document.getElementById('crafting-inv-grid');
  const stationIndicator = document.getElementById('crafting-station-indicator');

  if (!recipeList || !invGrid) return;

  // Check crafting table proximity
  const atTable = checkNearCraftingTable(player, game.chunkManager);
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
      let ingHTML = '<div class="recipe-ingredients">';
      for (let i = 0; i < recipe.ingredients.length; i++) {
        if (i > 0) ingHTML += '<span class="recipe-plus">+</span>';
        const ing = recipe.ingredients[i];
        ingHTML += `
          <div class="recipe-ing-slot">
            <canvas class="item-icon" width="32" height="32" data-typeid="${ing.typeId}"></canvas>
            <span class="ing-count">${ing.count}</span>
          </div>`;
      }
      ingHTML += '</div>';

      // Output
      const outCount = recipe.output.count || 1;
      ingHTML += `<div class="recipe-arrow">→</div>
        <div class="recipe-output">
          <canvas class="item-icon" width="40" height="40" data-typeid="${recipe.output.typeId}"></canvas>
          ${outCount > 1 ? `<span class="output-count">${outCount}</span>` : ''}
        </div>`;

      // Name
      ingHTML += `<div class="recipe-name">${recipe.name}</div>`;

      card.innerHTML = ingHTML;

      // Click → craft
      card.addEventListener('click', () => {
        crafting.craftRecipe(recipe.id, inventory);
        renderCraftingUI(); // re-render to update availability
        updateHotbarUI();
      });

      recipeList.appendChild(card);

      // Draw icons after DOM insertion
      card.querySelectorAll('canvas[data-typeid]').forEach(canvas => {
        renderItemIcon(canvas, parseInt(canvas.dataset.typeId));
      });
    }
  }

  // Render inventory grid (reuse inventory grid render logic)
  renderCraftingInventoryGrid(invGrid);
}
```

### 4D. `renderCraftingInventoryGrid(container)` — mini inventory display

Same as the existing inventory grid but without drag-and-drop (read-only preview):

```js
function renderCraftingInventoryGrid(container) {
  container.innerHTML = '';
  for (let i = 0; i < inventory.totalSlots; i++) {
    const slot = inventory.getSlot(i);
    const isHotbar = inventory.isHotbarSlot(i);
    const div = document.createElement('div');
    div.className = 'inventory-slot' + (isHotbar ? ' hotbar' : '');

    if (slot) {
      const canvas = document.createElement('canvas');
      canvas.className = 'item-icon';
      canvas.width = 40;
      canvas.height = 40;
      renderItemIcon(canvas, slot.typeId);
      div.appendChild(canvas);

      if (slot.count > 1) {
        const countEl = document.createElement('span');
        countEl.className = 'item-count';
        countEl.textContent = slot.count;
        div.appendChild(countEl);
      }
    }

    container.appendChild(div);
  }
}
```

### 4E. `toggleCraftingMenu()` — open/close

```js
let craftingOpen = false;

function toggleCraftingMenu() {
  craftingOpen = !craftingOpen;
  const screen = document.getElementById('crafting-screen');
  const hotbarContainer = document.getElementById('hotbar-container');

  if (craftingOpen) {
    // Close inventory if open
    if (inventoryOpen) {
      inventoryOpen = false;
      document.getElementById('inventory-screen').classList.add('hidden');
    }
    if (document.pointerLockElement) document.exitPointerLock();
    if (hotbarContainer) hotbarContainer.classList.add('hidden');
    renderCraftingUI();
    screen.classList.remove('hidden');
  } else {
    craftingOpen = false;
    game.renderer.domElement.requestPointerLock();
    if (hotbarContainer) hotbarContainer.classList.remove('hidden');
    screen.classList.add('hidden');
  }
}
```

### 4F. Wire C key in the gameKeyHandler

In the existing `keydown` handler in `startGame()`:

```js
// C for crafting menu
if (e.key === 'c' || e.key === 'C') {
  e.preventDefault();
  if (!inventoryOpen) { // Don't allow if inventory is open
    toggleCraftingMenu();
  }
}
```

Also close crafting menu when E (inventory) is pressed:

```js
if (e.key === 'e' || e.key === 'E') {
  e.preventDefault();
  if (craftingOpen) {
    toggleCraftingMenu(); // close crafting first
  }
  toggleInventoryScreen();
}
```

### 4G. Close crafting on Escape (in pause handler)

When pause menu opens, also close crafting:

```js
if (craftingOpen) toggleCraftingMenu();
```

### 4H. Close crafting on exit-to-menu

In the exit-to-menu handler, add:

```js
const craftingScreenEl = document.getElementById('crafting-screen');
if (craftingScreenEl) craftingScreenEl.classList.add('hidden');
craftingOpen = false;
```

### 4I. Auto-close crafting on inventory change

Wire `inventory.onSlotChange` to re-render crafting UI if open:

```js
inventory.onSlotChange = (index, slot) => {
  updateHotbarUI();
  if (craftingOpen) renderCraftingUI();
};
```

### 4J. Mobile: Add crafting button to mobile actions

Add a crafting button to `#mobile-actions` in index.html and wire a click handler.

---

## Phase 5 — Multiplayer Sync Considerations

When multiplayer is active, crafting should be validated server-side:

1. Client sends `craft` message with `recipeId`
2. Host validates: does player have ingredients? Is recipe discovered? Is player at a crafting table if required?
3. Host consumes ingredients and adds output, then syncs inventory

This is a follow-up — for now, crafting works locally only.

---

## Implementation Order

1. **`inventory.js`** — Add `stick` to NAMED_ITEMS
2. **`crafting.js`** — Rewrite recipes, add `requiresTable`, `getCraftableRecipes()`, `craftRecipe()`
3. **`index.html`** — Add `#crafting-screen` overlay
4. **`css/style.css`** — Add crafting UI styles
5. **`main.js`** — Wire everything together (C key, toggle, render, proximity check)
6. **Test** — Verify hand crafting, table crafting, filtering, close/open behavior

---

## Item Flags / Categories Reference

Item behavior is controlled by `category` + `typeId` type:

| Category | typeId type | Placeable? | Usable? | Stackable? |
|----------|-------------|------------|---------|------------|
| `BLOCK` | number | ✅ Yes (`consumeSelectedBlock()` checks `typeof typeId === 'number'`) | N/A | Up to 64 |
| `RESOURCE` | string | ❌ No | ❌ No (crafting material only) | Per-item (usually 64) |
| `FOOD` | string | ❌ No | ✅ Consumable (`foodRestore`, `foodSaturation`) | Per-item |
| `TOOL` | string | ❌ No | ✅ Equippable (`durability`, `damage`, `attackSpeed`) | Always 1 |

**Key insight:** `consumeSelectedBlock()` (inventory.js:542) explicitly blocks placement of anything that isn't a numeric typeId. Named items (strings) are **never placeable as blocks**.

**Stick** = `ITEM_CATEGORIES.RESOURCE` — crafting material only, not placeable or usable.
