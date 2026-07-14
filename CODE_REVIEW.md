# Cuubz — Code Review Report

**Date:** 2026-07-13  
**Scope:** Full end-to-end review of all source files  
**Method:** Every claim verified against actual file contents  

---

## Summary

The cuubz project is a client-side voxel game built with vanilla JS, Three.js, localStorage persistence, and WebSockets for multiplayer. The codebase is generally well-structured with good separation of concerns, proper disposal patterns, and Node.js testability in mind.

**Total issues found:** 17 (3 Critical, 5 High, 5 Medium, 4 Low)

---

## Critical Issues

### C-1: `VALID_BLOCK_IDS` in `inventorySync.js` is misaligned with `BLOCK_TYPES` enum

**File:** `js/multiplayer/inventorySync.js` (lines 24–50)  
**Impact:** Inventory validation rejects legitimate items and accepts invalid ones

The `VALID_BLOCK_IDS` set in `inventorySync.js` uses a completely different numbering scheme than the `BLOCK_TYPES` enum defined in `chunkData.js`:

| inventorySync.js | Comment | chunkData.js | Actual Enum |
|---|---|---|---|
| 0 | Air | 0 | AIR |
| 1 | Grass | 4 | GRASS |
| 2 | Dirt | 3 | DIRT |
| 3 | Stone | 2 | STONE |
| 11 | Bedrock | 1 | BEDROCK |
| 15 | Lava | 15 | LAVA ✓ |
| 22 | Corrupt Crystal | 38 | CORRUPT_CRYSTAL |
| 26 | Boss Spawn | (not in BLOCK_TYPES) | — |

**Consequence:** The `InventoryValidator` in `inventorySync.js` will reject valid block IDs (like `BLOCK_TYPES.GRASS = 4`, `BLOCK_TYPES.WOOD_LOG = 32`, `BLOCK_TYPES.PLANKS = 34`) as invalid because they're not in `VALID_BLOCK_IDS`. Conversely, it will accept IDs like `1` (which is `BEDROCK` in the actual enum) as "Grass." This means:
- Players cannot place legitimate blocks because the host rejects them
- The `SINGLE_STACK_BLOCKS` set `{22, 25, 26}` references wrong IDs (actual: `{38, 41, ?}`)

**Root cause:** `inventorySync.js` was written against an earlier version of the block type registry and never updated.

---

### C-2: `PersistenceManager` uses `localStorage` with no size guard

**File:** `js/world/persistence.js` (entire file)  
**Impact:** Silent data loss when `localStorage` quota is exceeded

The `PersistenceManager` serializes all character and world data to `localStorage` without any quota checking. `localStorage` has a ~5-10 MB limit per origin. When `setItem` throws a `QuotaExceededError`:

- `saveCharacter()` (line 93): No try/catch — throws unhandled, crashing the character save flow
- `saveWorld()` (line 123): No try/catch — throws unhandled, crashing the world save flow
- `deleteCharacter()` (line 103): No try/catch — delete operations can also fail

Additionally, `clearSlot()` (line 84) only removes the world config key but does NOT remove associated chunk data from IndexedDB (via `ChunkStore`), creating orphaned chunk data.

**Recommendation:** Add try/catch around all `localStorage` operations and implement quota checking. Consider migrating to IndexedDB for world configs as well.

---

### C-3: `crafting.js` references `BLOCK_TYPES` but doesn't guard against undefined

**File:** `js/systems/crafting.js` (lines 20–70)  
**Impact:** `ReferenceError` or `TypeError` if `chunkData.js` hasn't loaded yet

The `RECIPES` object at module scope references `BLOCK_TYPES.WOOD_LOG`, `BLOCK_TYPES.PLANKS`, `BLOCK_TYPES.BED`, `BLOCK_TYPES.CAVE_TORCH`, `BLOCK_TYPES.OBSIDIAN`, `BLOCK_TYPES.BLACKSTONE`, `BLOCK_TYPES.STONE`, and `BLOCK_TYPES.COAL_ORE`. These are evaluated at parse time (when the `<script>` tag loads).

If `chunkData.js` hasn't defined the global `BLOCK_TYPES` yet (wrong script load order), this throws a `ReferenceError` and the entire crafting system fails silently.

**Same pattern in:** `biomeSystem.js` (line 18: `BIOME_DEFS` references `BLOCK_TYPES` at module scope)

---

## High Issues

### H-1: Global dependency pattern is fragile across the entire codebase

**Files:** Multiple (see Global Dependency Map below)  
**Impact:** Works in current `index.html` load order, but breaks if bundled, reordered, or loaded as modules

The entire application relies on implicit global bindings from `const` declarations in regular `<script>` tags. This works because:
1. All scripts are loaded via plain `<script>` tags (not `<script type="module">`)
2. In regular scripts, top-level `const` creates global bindings accessible from other scripts
3. `index.html` loads scripts in the exact dependency order

However, this pattern is fragile:
- **Bundling:** Any bundler (webpack, rollup, vite) that wraps scripts in functions would break all global references
- **ES Modules:** Converting to `<script type="module">` would scope all `const` to their module
- **Reordering:** Changing script order in `index.html` causes `ReferenceError`
- **Testing:** Unit tests that import individual files must manually set up all global dependencies

**Affected files:** `crafting.js`, `biomeSystem.js`, `damageSystem.js`, `spawnManager.js`, `worldManager.js`, `inventory.js`, `interaction.js`, `chunkStreamer.js` all reference globals from other files.

**Recommendation:** Use explicit `import`/`export` (ES modules) or a proper module loader. At minimum, add runtime guards like `if (typeof BLOCK_TYPES === 'undefined') throw new Error('chunkData.js must load first')`.

---

### H-2: `inventory.js` `getMaxStack()` references `BLOCK_TYPES` at runtime

**File:** `js/systems/inventory.js` (line 115)  
**Impact:** `ReferenceError` if called before `chunkData.js` loads

```javascript
if (typeId === BLOCK_TYPES.CORRUPT_CRYSTAL || typeId === BLOCK_TYPES.QUEST_KEY) return 1;
```

Unlike files that reference globals at module scope (which fail immediately if the global is missing), this reference is inside a method body. It only fails when `getMaxStack()` is called with a numeric `typeId`. This means the error manifests at an unpredictable time during gameplay rather than at startup.

---

### H-3: `interaction.js` constructor references globals at instantiation time

**File:** `js/input/interaction.js` (lines 56, 108)  
**Impact:** `ReferenceError` if `new BlockInteraction()` is called before `chunkData.js` loads

```javascript
this.unbreakableBlocks = new Set([BLOCK_TYPES.BEDROCK, BLOCK_TYPES.OBSIDIAN]);
// ...
const props = BLOCK_PROPERTIES[blockType];
```

`BLOCK_TYPES` and `BLOCK_PROPERTIES` are evaluated in the constructor, not at module scope. This means the class definition succeeds, but instantiation fails. The error manifests when `main.js` creates the `BlockInteraction` instance.

---

### H-4: `chunkStreamer.js` references `CHUNK_WIDTH` / `CHUNK_DEPTH` at runtime

**File:** `js/multiplayer/chunkStreamer.js` (line 19, used in `getPlayerChunk()`, `calculateChunkNeeds()`, `updatePlayerChunkNeeds()`)  
**Impact:** `ReferenceError` if used without `chunkData.js`

```javascript
// Use globals from chunkData.js: CHUNK_WIDTH, CHUNK_DEPTH
```

`CHUNK_WIDTH` and `CHUNK_DEPTH` are referenced in method bodies, not at module scope. The class loads fine, but any method call that uses these globals fails. This makes the module non-testable in Node.js without manually defining these globals.

---

### H-5: `damageSystem.js` references `DAMAGE_SOURCES` at module scope

**File:** `js/systems/damageSystem.js` (lines 9–12)  
**Impact:** `ReferenceError` at parse time if `survival.js` hasn't loaded

```javascript
// DAMAGE_SOURCES defined in survival.js — use global
const ENVIRONMENTAL_DAMAGE_RATES = {
  [DAMAGE_SOURCES.LAVA]:    20.0,
  [DAMAGE_SOURCES.POISON]:   5.0,
};
```

`DAMAGE_SOURCES` is evaluated at module scope (when the `<script>` tag loads), not at runtime. If `survival.js` hasn't loaded yet, the entire `damageSystem.js` script fails to parse, and no subsequent scripts execute. This is a hard failure that prevents the entire app from loading.

**Same pattern:** `spawnManager.js` references `SEA_LEVEL` at module scope (line 12).

---

## Medium Issues

### M-1: `worldManager.js` depends on `MIN_NAME_LENGTH` / `MAX_NAME_LENGTH` globals from `characterManager.js`

**File:** `js/entities/worldManager.js` (line 18)  
**Impact:** Works with current load order; breaks if bundled or reordered

```javascript
// MIN_NAME_LENGTH and MAX_NAME_LENGTH defined in characterManager.js — use globals
```

`WorldManager.validateName()` references `MIN_NAME_LENGTH` and `MAX_NAME_LENGTH` from `characterManager.js`. Both files use `'use strict'`, but in regular `<script>` tags, top-level `const` still creates global bindings. This works because `characterManager.js` loads first (index.html line 372 before 373).

**Fragility:** Breaks if bundled with webpack/rollup (which wrap modules in functions), or if loaded as ES modules.

---

### M-2: `playerListHUD.js` `destroy()` creates useless event listener

**File:** `js/multiplayer/playerListHUD.js` (line 237)  
**Impact:** Memory leak — the removed listener is never actually attached

```javascript
this._toggleBtn.removeEventListener('click', () => {});
```

This creates a **new** anonymous function and tries to remove it. Since the original click handler (added in `_setupToggle()` at line 115) is a different function reference, this does nothing. The original handler remains attached, preventing garbage collection of the toggle button.

---

### M-3: `skybox.js` cloud planes share geometry but each has cloned material

**File:** `js/renderer/skybox.js` (lines 230–245)  
**Impact:** Unnecessary GPU memory usage

```javascript
const cloudGeometry = new THREE.PlaneGeometry(20, 20);
const cloudMaterial = new THREE.MeshBasicMaterial({...});

for (let i = 0; i < 20; i++) {
  const cloud = new THREE.Mesh(cloudGeometry, cloudMaterial.clone());
```

Each of the 20 clouds gets its own cloned material. While this is needed for per-cloud opacity changes, all 20 clouds share the same opacity value (set uniformly in `_updateSkyState()`). A single shared material with a uniform would be more efficient.

**Minor:** The shared `cloudGeometry` is never disposed in `dispose()`.

---

### M-4: `crosshair.js` highlight mesh geometry/material never disposed on visibility toggle

**File:** `js/renderer/crosshair.js` (lines 48–65)  
**Impact:** Minor GPU memory leak if highlight is created/destroyed repeatedly

The `_updateHighlight()` method creates the highlight mesh lazily (first time only), and `_hideHighlight()` just sets `visible = false`. This is fine for the normal lifecycle. However, if `dispose()` is called and then `update()` is called again (e.g., during game restart), a new mesh is created but the old one's geometry/material are already disposed, causing a Three.js warning.

---

### M-5: `persistence.js` `_assignSlot()` eviction logic assigns wrong slot

**File:** `js/world/persistence.js` (lines 60–82)  
**Impact:** Slot collision — two worlds can share the same slot

```javascript
if (oldestSlot >= 0) {
  this.clearSlot(oldestSlot);
  delete map[Object.keys(map).find(k => map[k] === oldestSlot)];
}

map[worldId] = 0; // Use slot 0 (was evicted or empty)
```

After evicting `oldestSlot`, the code always assigns slot `0` regardless of which slot was actually freed. If `oldestSlot` was `1` or `2`, slot `0` might already be occupied by a different world. This creates a slot collision where two worlds share the same slot.

**Correct logic:** `map[worldId] = oldestSlot;` (use the freed slot, not always 0).

---

## Low Issues

### L-1: `playerListHUD.js` `escapeHtml()` creates unused DOM element

**File:** `js/multiplayer/playerListHUD.js` (line 33)  
**Impact:** Minor — creates a DOM element that's never used

```javascript
const div = typeof document !== 'undefined' ? document.createElement('div') : null;
```

The `div` is created but never used. The actual escaping is done via string `.replace()` calls. This is dead code.

---

### L-2: `skybox.js` `lerpColor()` uses variable name `bl` for blue channel

**File:** `js/renderer/skybox.js` (line 84)  
**Impact:** Cosmetic — confusing variable name

```javascript
const bl = Math.round(lerp(a.b, b.b, t) * 255);
return (r << 16) | (g << 8) | bl;
```

`bl` is an unusual abbreviation for `blue`. Minor readability issue.

---

### L-3: `skybox.js` cloud geometry never disposed; cloned materials unnecessary

**File:** `js/renderer/skybox.js` (lines 230–245, `dispose()` method)  
**Impact:** Minor GPU memory overhead

Each of the 20 clouds gets its own cloned material (needed for per-cloud opacity), but all clouds share the same opacity value set uniformly in `_updateSkyState()`. A single shared material would suffice. Additionally, the shared `cloudGeometry` is never disposed in `dispose()`.

---

### L-4: `persistence.js` `_assignSlot()` always assigns slot 0 after eviction

**File:** `js/world/persistence.js` (line 80)  
**Impact:** Could cause slot collision

```javascript
map[worldId] = 0; // Use slot 0 (was evicted or empty)
```

After evicting `oldestSlot`, the code always assigns slot `0` regardless of which slot was freed. If `oldestSlot` was `1` or `2`, slot `0` might already be occupied. **Correct logic:** `map[worldId] = oldestSlot;`

---

## Global Dependency Map

The following table documents all cross-file global dependencies. In the current `index.html` load order, all dependencies are satisfied. The **Failure Mode** column indicates when the error manifests:
- **Parse-time:** The entire script fails to load, blocking all subsequent scripts
- **Constructor-time:** The class definition succeeds, but instantiation fails
- **Runtime:** The method call fails unpredictably during gameplay

| Consumer File | Global Used | Defined In | Failure Mode |
|---|---|---|---|
| `crafting.js` | `BLOCK_TYPES` | `chunkData.js` | Parse-time (module-scope `RECIPES`) |
| `biomeSystem.js` | `BLOCK_TYPES` | `chunkData.js` | Parse-time (module-scope `BIOME_DEFS`) |
| `damageSystem.js` | `DAMAGE_SOURCES` | `survival.js` | Parse-time (module-scope `ENVIRONMENTAL_DAMAGE_RATES`) |
| `spawnManager.js` | `SEA_LEVEL` | `chunkData.js` | Parse-time (module-scope `defaultSpawn`) |
| `worldManager.js` | `MIN_NAME_LENGTH`, `MAX_NAME_LENGTH` | `characterManager.js` | Runtime (inside `validateName()`) |
| `inventory.js` | `BLOCK_TYPES` | `chunkData.js` | Runtime (inside `getMaxStack()`) |
| `interaction.js` | `BLOCK_TYPES`, `BLOCK_PROPERTIES` | `chunkData.js` | Constructor-time |
| `chunkStreamer.js` | `CHUNK_WIDTH`, `CHUNK_DEPTH` | `chunkData.js` | Runtime (inside methods) |

---

## Positive Findings

- **Proper disposal patterns:** `MouseInput`, `VoxelRenderer`, `Skybox`, `Crosshair`, `BlockInteraction`, `ChunkStreamer`, `InventorySync`, and `PlayerListHUD` all implement `dispose()` / `destroy()` methods
- **Worker isolation:** `meshWorker.js` and `workerGeneration.js` are self-contained with their own `BLOCK_TYPES` — no cross-thread dependency issues
- **Edge detection in input:** `keyboard.js` uses `InputAction` class for clean one-shot events; `mouse.js` uses `justClickedLeft`/`justClickedRight` flags
- **Multi-touch support:** `touch.js` has separate zones for joystick movement and camera look
- **Proper clamping:** `survival.js` uses `Math.max(0, ...)` throughout for meter values
- **Constructor injection:** `CraftingSystem`, `BlockInteraction`, `CharacterManager`, `WorldManager`, `InventorySync` all use dependency injection
- **Node.js testability:** Most modules use `if (typeof module !== 'undefined')` guards for exports
- **XSS protection:** `playerListHUD.js` uses `escapeHtml()` for player names
- **Callback error handling:** `ChunkStreamer` wraps all callback invocations in try/catch
