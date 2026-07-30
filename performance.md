# Performance Options Menu — Implementation Plan

## Overview

Create a shareable **Performance Options** menu accessible from both the **main menu** (Settings screen) and the **in-game pause menu** (Escape key). All options apply in real-time and persist between sessions via `localStorage`.

---

## Settings to Implement

| # | Setting | Control Type | Options / Range | Default |
|---|---------|-------------|-----------------|---------|
| 1 | **Render Distance** | Dropdown | 2, 3, 4, 5, 6, 8, 10, 12 | 6 |
| 2 | **Shadows** | Dropdown | Off, Low (1024), Medium (2048), High (4096) | Medium |
| 3 | **Texture Resolution** | Dropdown | Low (32×32), Medium (64×64), High (128×128) | High |
| 4 | **Advanced Shading** | Checkbox | On / Off | On |

### Setting Details

1. **Render Distance** — Controls `ChunkManager.renderDistance`. Determines the radius of chunks rendered around the player (radius × radius area). Lower = fewer draw calls, less memory.

2. **Shadows** — Controls shadow map resolution and whether shadows render at all:
   - **Off**: `renderer.shadowMap.enabled = false`, skip `_renderShadowMap()` each frame
   - **Low**: 1024×1024 shadow render target
   - **Medium**: 2048×2048 (current default)
   - **High**: 4096×4096

3. **Texture Resolution** — Controls the tile size used when building the PBR texture atlas:
   - **High**: 128×128 per tile (current default, full resolution)
   - **Medium**: 64×64 per tile (downsampled at draw time)
   - **Low**: 32×32 per tile (heavily downsampled)
   
   This changes the `tileSize` in `PBRTextureAtlas` and the draw size when loading textures into the atlas canvases. The atlas canvas itself shrinks proportionally, reducing VRAM usage.

4. **Advanced Shading** — When **unchecked**, the PBR shader skips normal mapping and smoothness/specular calculations. Only the albedo (diffuse) texture is sampled. This is the biggest single shader perf win on low-end GPUs.
   - **On** (default): Full PBR — diffuse + normal map + smoothness map + specular highlights
   - **Off**: Albedo-only — diffuse texture with ambient + diffuse lighting, no normal perturbation, no specular

---

## Persistence

Settings are saved to `localStorage` using the key `cuubz:settings` (JSON object), following the same pattern as `PersistenceManager` for characters and worlds.

```js
// Stored format
{
  renderDistance: 6,
  shadowQuality: 'medium',    // 'off' | 'low' | 'medium' | 'high'
  textureResolution: 'high',  // 'low' | 'medium' | 'high'
  advancedShading: true
}
```

- Load on game init (in `main.js` `init()`)
- Save immediately on every change (no debounce needed — localStorage writes are fast)
- Apply loaded settings to the renderer before `startGame()` runs

---

## Architecture

### New File: `src/engine/renderer/PerformanceSettings.js`

A single class `PerformanceSettings` that:

- Holds the current settings object
- Provides `load()` / `save()` methods (localStorage)
- Provides `apply(renderer, chunkManager)` to push settings into the live engine
- Exposes a `get()` method for UI bindings
- Exposes a `set(key, value)` method that auto-saves and returns the new settings

```js
class PerformanceSettings {
  constructor() {
    this.settings = {
      renderDistance: 6,
      shadowQuality: 'medium',
      textureResolution: 'high',
      advancedShading: true
    };
  }

  load()        // Read from localStorage, merge with defaults
  save()        // Write to localStorage
  get()         // Return current settings object
  set(key, val) // Set one key, save, return settings
  apply(renderer, chunkManager)  // Push settings into live engine
}
```

### `apply()` — Real-Time Update Logic

```
apply(renderer, chunkManager):
  1. Render Distance:
     chunkManager.setRenderDistance(settings.renderDistance)

  2. Shadows:
     switch settings.shadowQuality:
       'off'    → renderer.renderer.shadowMap.enabled = false
                  skip _renderShadowMap in render loop
       'low'    → recreate shadowRenderTarget at 1024×1024
       'medium' → recreate shadowRenderTarget at 2048×2048
       'high'   → recreate shadowRenderTarget at 4096×4096
     renderer.renderer.shadowMap.enabled = (quality !== 'off')

  3. Texture Resolution:
     If changed since last apply → rebuild texture atlas with new tileSize.
     This requires:
       - Disposing old THREE.CanvasTextures
       - Rebuilding PBRTextureAtlas with new tileSize
       - Re-initializing PBRMaterialFactory with new textures
       - Rebuilding all loaded chunk meshes (they reference old material uniforms)
     NOTE: This is expensive — only rebuild when the value actually changes.
     After rebuild, call renderer.initPBR(newAtlas) and trigger mesh rebuilds.

  4. Advanced Shading:
     If changed → rebuild PBRMaterialFactory with new shader variant.
     When off, use simplified fragment shaders that skip normal/smoothness sampling.
     This requires:
       - Creating new shader materials (simplified PBR)
       - Rebuilding all loaded chunk meshes with new materials
     NOTE: Also expensive — only rebuild when value changes.
```

### Shader Variants for Advanced Shading

When `advancedShading = false`, we need simplified PBR fragment shaders that:
- Still sample `uDiffuseMap` for albedo
- Skip `uNormalMap` and `uSmoothnessMap` entirely
- Use geometry normal directly (no tangent-space perturbation)
- Skip specular calculation
- Keep shadow sampling (if shadows are also on)
- Keep emissive support

Three simplified shaders (solid, cutout, transparent) parallel the existing ones.

---

## UI Changes

### 1. Main Menu — Settings Screen (`index.html` → `#settings-screen`)

Add performance options section to the existing settings screen:

```html
<!-- Existing settings remain above -->

<div class="settings-group performance-section">
  <h4>Performance</h4>

  <label for="perf-render-distance">Render Distance:</label>
  <select id="perf-render-distance">
    <option value="2">2 (Minimum)</option>
    <option value="3">3</option>
    <option value="4">4</option>
    <option value="5">5</option>
    <option value="6" selected>6 (Recommended)</option>
    <option value="8">8</option>
    <option value="10">10</option>
    <option value="12">12 (Maximum)</option>
  </select>

  <label for="perf-shadows">Shadows:</label>
  <select id="perf-shadows">
    <option value="off">Off</option>
    <option value="low">Low</option>
    <option value="medium" selected>Medium</option>
    <option value="high">High</option>
  </select>

  <label for="perf-texture-res">Texture Resolution:</label>
  <select id="perf-texture-res">
    <option value="low">Low</option>
    <option value="medium">Medium</option>
    <option value="high" selected>High</option>
  </select>

  <label class="checkbox-label">
    <input type="checkbox" id="perf-advanced-shading" checked>
    Advanced Shading (Normal + Specular Maps)
  </label>
</div>
```

### 2. In-Game Pause Menu (`index.html` → `#pause-menu`)

Add the same performance section to the pause menu overlay:

```html
<!-- Existing pause menu settings remain above -->

<div class="settings-group performance-section">
  <h4>Performance</h4>

  <label for="pause-perf-render-distance">Render Distance:</label>
  <select id="pause-perf-render-distance">...</select>

  <label for="pause-perf-shadows">Shadows:</label>
  <select id="pause-perf-shadows">...</select>

  <label for="pause-perf-texture-res">Texture Resolution:</label>
  <select id="pause-perf-texture-res">...</select>

  <label class="checkbox-label">
    <input type="checkbox" id="pause-perf-advanced-shading" checked>
    Advanced Shading
  </label>
</div>
```

### 3. CSS (`css/style.css`)

Add styles for the new performance section:

```css
/* Performance settings section */
.performance-section h4 {
  color: #4CAF50;
  font-size: 14px;
  margin-bottom: 12px;
  text-transform: uppercase;
  letter-spacing: 1px;
}

.performance-section select {
  width: 100%;
  padding: 8px 12px;
  margin-bottom: 12px;
  border: 1px solid rgba(255,255,255,0.2);
  border-radius: 6px;
  background: rgba(255,255,255,0.08);
  color: #e0e0e0;
  font-size: 14px;
}

.checkbox-label {
  display: flex !important;
  align-items: center;
  gap: 8px;
  cursor: pointer;
  font-size: 13px;
  color: #ccc;
  margin-bottom: 4px;
}

.checkbox-label input[type="checkbox"] {
  width: 18px;
  height: 18px;
  accent-color: #4CAF50;
  cursor: pointer;
}
```

---

## Implementation Order

### Phase 1: Core Settings Module (1 file)
- [ ] Create `src/engine/renderer/PerformanceSettings.js`
  - `PerformanceSettings` class with load/save/get/set
  - `apply()` method for render distance and shadows (cheap settings)
  - localStorage key: `cuubz:settings`

### Phase 2: Real-Time Apply — Cheap Settings (modify 2 files)
- [ ] `voxelRenderer.js`: Add `setShadowQuality(quality)` method
  - Recreate `shadowRenderTarget` at new resolution
  - Toggle `renderer.shadowMap.enabled`
  - Add flag to skip `_renderShadowMap()` when off
- [ ] `chunkmanager.js`: Add/verify `setRenderDistance(val)` method
  - Update `this.renderDistance`
  - Update `_voxelRegionRadius` accordingly
  - Trigger immediate chunk unload for out-of-range meshes

### Phase 3: Real-Time Apply — Expensive Settings (modify 3 files)
- [ ] `textureAtlas.js`: Add `tileSize` as configurable constructor option
  - `_loadTriple()` draws at `tileSize` instead of hardcoded 128
  - Grid sizing adapts to new tile size
  - Canvas size recalculated
- [ ] `pbrShader.js`: Add simplified shader variants (solid, cutout, transparent)
  - `PBRMaterialFactory` accepts `advancedShading` flag
  - When false, uses simplified fragment shaders
- [ ] `voxelRenderer.js`: Add `rebuildAtlasAndMaterials(tileSize, advancedShading)` method
  - Disposes old textures and materials
  - Rebuilds `PBRTextureAtlas` with new tile size
  - Re-initializes `PBRMaterialFactory`
  - Triggers mesh rebuild for all loaded chunks

### Phase 4: UI Wiring (modify 3 files)
- [ ] `index.html`: Add performance section to `#settings-screen` and `#pause-menu`
- [ ] `css/style.css`: Add styles for selects and checkbox in settings
- [ ] `src/main.js`:
  - Create `performanceSettings` instance at top level
  - In `init()`, call `performanceSettings.load()`
  - In `initMenuNavigation()`, wire main menu settings controls
  - In `setupPauseMenu()`, wire pause menu settings controls
  - Both menus read from same `performanceSettings` instance
  - On change: call `performanceSettings.set(key, val)` then `performanceSettings.apply(game.renderer, game.chunkManager)`
  - Sync UI values between menus (both read from same source)

### Phase 5: StartGame Integration (modify 1 file)
- [ ] `src/main.js` → `startGame()`:
  - After renderer and chunkManager are created, call `performanceSettings.apply(renderer, chunkManager)`
  - This ensures saved settings are applied before the game loop starts
  - If texture resolution or advanced shading differ from defaults, trigger the expensive rebuild path

### Phase 6: Testing
- [ ] Verify settings persist across page reload
- [ ] Verify main menu and pause menu settings stay in sync
- [ ] Verify render distance change unloads/loads chunks immediately
- [ ] Verify shadow quality change updates shadow map resolution
- [ ] Verify texture resolution rebuild works (no crashes, textures still correct)
- [ ] Verify advanced shading off produces correct albedo-only rendering
- [ ] Verify all combinations work together
- [ ] Test on mobile viewport

---

## Files Modified / Created

| File | Action | Changes |
|------|--------|---------|
| `src/engine/renderer/PerformanceSettings.js` | **NEW** | Settings class with load/save/apply |
| `src/engine/renderer/VoxelRenderer.js` | Modify | `setShadowQuality()`, `rebuildAtlasAndMaterials()`, skip shadow render when off |
| `src/engine/renderer/TextureAtlas.js` | Modify | Configurable `tileSize`, rebuild support |
| `src/engine/renderer/PBRShader.js` | Modify | Simplified shader variants, `advancedShading` flag in factory |
| `src/engine/world/ChunkManager.js` | Modify | `setRenderDistance()` method (may already exist, verify) |
| `index.html` | Modify | Performance section in settings screen + pause menu |
| `css/style.css` | Modify | Styles for selects, checkbox, performance section header |
| `src/main.js` | Modify | Settings instance, UI wiring in menu nav + pause menu, apply in startGame |

---

## Notes and Caveats

1. **Texture resolution rebuild is expensive** — it re-downloads and re-bakes all textures. Show a brief "Rebuilding textures..." loading indicator if done in-game.

2. **Advanced shading rebuild** requires rebuilding all chunk materials. The existing `_onMeshBuilt` in ChunkManager creates materials from `pbrFactory` — after factory rebuild, all meshes need to be re-added. Strategy: iterate `loadedMeshes`, dispose old, trigger rebuild via `chunk.changed = true` for each chunk.

3. **Shadow off** should also skip the `_renderShadowMap()` call in the render loop to save a full scene pass. Set a flag on the renderer and check it before calling `_renderShadowMap()`.

4. **Both menus share state** — the main menu settings screen and the pause menu both bind to the same `PerformanceSettings` instance. Changing a setting in one menu should update the other menu's UI controls too (important when pausing/unpausing).

5. **Multiplayer consideration** — these are client-side rendering settings only. They don't affect gameplay, so no network sync needed.

6. **The existing render distance slider in the pause menu** (`#setting-render-distance`) should be replaced with the new dropdown for consistency, or kept as a separate "debug" control.
