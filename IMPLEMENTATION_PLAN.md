# Implementation Plan: New Block Types, Texture Integration & PBR Rendering

## Prerequisites — Delete Old System First

Before any code changes, remove the old texture system entirely:

```bash
# Delete old root-level texture files (the ID_SIDENUM-name.png files)
rm textures/1_0-bedrock.png textures/2_0-stone.png textures/3_0-dirt.png \
   textures/4_0-grass_top.png textures/4_1-grass_side.png textures/5_0-sand.png \
   textures/6_0-gravel.png textures/7_0-water.png textures/8_0-coal_ore.png \
   textures/9_0-iron_ore.png textures/10_0-gold_ore.png textures/11_0-diamond_ore.png \
   textures/13_0-snow.png textures/14_0-snow_stone.png textures/15_0-lava.png \
   textures/16_0-terracotta.png textures/17_0-red_sand.png textures/18_0-ice.png \
   textures/19_0-clay.png textures/32_0-wood_log.png textures/33_0-leaves.png \
   textures/34_0-planks.png textures/35_0-obsidian.png textures/36_0-blackstone.png \
   textures/37_0-toxic_slime.png textures/38_0-corrupt_cry.png textures/39_0-bed.png \
   textures/40_0-apple.png textures/41_0-quest_key.png textures/42_0-red_flower.png \
   textures/43_0-yellow_flower.png textures/44_0-cave_torch.png textures/45_0-glowstone.png

# Delete old manifest
rm textures/manifest.json
```

Then clear IndexedDB worlds: open browser DevTools → Application → IndexedDB → `cuubz-worlds` → delete all stores.

---

## Current State (After Cleanup)

### New Texture Inventory
- **894 unique block textures** in `textures/blocks/`
- Each has 3 variants: `name.png` (diffuse), `name_n.png` (normal), `name_s.png` (smoothness)
- **212 unique item textures** in `textures/items/` (same naming pattern)

### Naming Convention
```
textures/blocks/stone.png          ← diffuse/albedo
textures/blocks/stone_n.png        ← normal map (packed RGB tangent-space)
textures/blocks/stone_s.png        ← smoothness map (grayscale, white=smooth)

textures/blocks/oak_log.png        ← side face
textures/blocks/oak_log_top.png    ← top/bottom face
textures/blocks/grass_block_side.png
textures/blocks/grass_block_top.png
textures/blocks/dirt.png           ← grass block bottom
```

### Current Rendering
- `MeshLambertMaterial` — basic diffuse, flat geometry normals
- Lighting: `AmbientLight(0.4)` + `DirectionalLight(0.8)` — no shadows, no PBR
- Single texture atlas from canvas, nearest-neighbor filtering

---

## Phase 1: Block Registry — Single Source of Truth

**Goal**: One file defines every block — ID, name, texture mapping, properties. No split between `BLOCK_TYPES` constants and `BLOCK_PROPERTIES`.

### 1.1 Create `js/world/blockRegistry.js`

This replaces `BLOCK_TYPES` and `BLOCK_PROPERTIES` from `chunkData.js`.

```js
/**
 * Block Registry — Single source of truth for all block definitions.
 * 
 * Each block has:
 *   id        — sequential, dense (0 = AIR, 1+ = solid blocks)
 *   name      — human-readable name
 *   texture   — base name(s) in textures/blocks/
 *   category  — 'solid' | 'cutout' | 'transparent'
 *   hardness  — mining time factor (-1 = unbreakable)
 *   tool      — optimal tool: 'pickaxe' | 'axe' | 'shovel' | 'hand' | null
 *   emissive  — glow intensity 0.0–1.0 (for block lighting)
 *   gravity   — falls like sand/gravel (boolean)
 */

export const BLOCK_REGISTRY = [
  { id: 0,  name: 'air',            texture: null,                          category: 'air',         hardness: 0 },
  { id: 1,  name: 'bedrock',        texture: { all: 'bedrock' },            category: 'solid',       hardness: -1, tool: 'pickaxe' },
  { id: 2,  name: 'stone',          texture: { all: 'stone' },              category: 'solid',       hardness: 3.0, tool: 'pickaxe' },
  { id: 3,  name: 'cobblestone',    texture: { all: 'cobblestone' },        category: 'solid',       hardness: 2.0, tool: 'pickaxe' },
  { id: 4,  name: 'andesite',       texture: { all: 'andesite' },           category: 'solid',       hardness: 3.0, tool: 'pickaxe' },
  { id: 5,  name: 'diorite',        texture: { all: 'diorite' },            category: 'solid',       hardness: 3.0, tool: 'pickaxe' },
  { id: 6,  name: 'granite',        texture: { all: 'granite' },            category: 'solid',       hardness: 3.0, tool: 'pickaxe' },
  // ... all blocks defined here
];

// Convenience lookups (computed once at load):
export const BLOCK_BY_ID = {};    // id → block def
export const BLOCK_BY_NAME = {};  // name → block def
export const MAX_BLOCK_ID = 0;    // highest ID

for (const block of BLOCK_REGISTRY) {
  BLOCK_BY_ID[block.id] = block;
  BLOCK_BY_NAME[block.name] = block;
  if (block.id > MAX_BLOCK_ID) MAX_BLOCK_ID = block.id;
}
```

### 1.2 Texture Mapping Format

Each block's `texture` field maps face names to texture base names:

```js
// Single texture — all 6 faces use the same texture
texture: { all: 'stone' }

// Different top/bottom (logs, pillars)
texture: { side: 'oak_log', top: 'oak_log_top', bottom: 'oak_log_top' }

// Grass block — 3 different textures
texture: { top: 'grass_block_top', side: 'grass_block_side', bottom: 'dirt' }

// Multi-face block (crafting table, furnace)
texture: { top: 'crafting_table_top', side: 'crafting_table_side', front: 'crafting_table_front' }
```

Face name resolution for mesh building:
- `top` → face direction `[0, 1, 0]`
- `bottom` → face direction `[0, -1, 0]`
- `front` / `back` / `left` / `right` → if not defined, falls back to `side`
- `side` → default for all 4 cardinal faces

### 1.3 Block Categories and ID Ranges

Assign IDs sequentially, grouped by category for readability:

```
ID  Range   Category
0    0       AIR
1    1–20    Stone variants (stone, cobblestone, andesite, diorite, granite, tuff, 
                 deepslate, polished variants, brick variants, chiseled variants)
21   21–35   Ores (coal_ore, iron_ore, gold_ore, diamond_ore, deepslate variants,
                 copper_ore, emerald_ore, lapis_ore, redstone_ore, nether_gold_ore)
36   36–45   Metal blocks (coal_block, iron_block, gold_block, diamond_block,
                 copper_block, emerald_block, lapis_block, redstone_block, netherite_block)
46   46–50   Fluids (water, lava)
51   51–60   Surface blocks (dirt, grass_block, sand, gravel, red_sand, clay, 
                 snow, podzol, coarse_dirt, moss_block, mycelium)
61   61–70   Ice variants (ice, packed_ice, blue_ice, frosted_ice)
71   71–95   Wood types — logs + tops (oak, spruce, birch, jungle, acacia, dark_oak,
                 cherry, mangrove, pale_oak, poplar, bamboo, stripped variants,
                 crimson_stem, warped_stem)
96   96–110  Wood types — planks (oak, spruce, birch, jungle, acacia, dark_oak,
                 cherry, mangrove, pale_oak, poplar, bamboo, crimson, warped)
111  111–125 Leaves (oak, spruce, birch, jungle, acacia, dark_oak, cherry,
                 mangrove, pale_oak, poplar, azalea variants)
126  126–145 Colored blocks (16 concrete, 16 wool — pick the 16 standard colors)
146  146–155 Nether (netherrack, basalt, blackstone, soul_sand, soul_soil,
                 crimson_nylium, warped_nylium, crying_obsidian, magma, ancient_debris)
156  156–159 End (end_stone, end_stone_bricks, purpur_block)
160  160–175 Decorations (bookshelf, crafting_table, furnace, chest/barrel,
                 ladder, hay_block, glowstone, sea_lantern, target)
176  176–185 Plants (short_grass, tall_grass, flowers, mushrooms, vines, cactus)
186  186–195 Game-specific (toxic_slime, corrupt_crystal, bed, apple, quest_key,
                 cave_torch)
```

**Total: ~200 block types** (leaves room for expansion, stays well within Uint8Array 0-255)

### 1.4 Replace `chunkData.js`

Strip `BLOCK_TYPES` and `BLOCK_PROPERTIES` from `chunkData.js`. Import from `blockRegistry.js` instead:

```js
// chunkData.js — after rewrite
import { BLOCK_BY_ID, BLOCK_BY_NAME, MAX_BLOCK_ID } from './world/blockRegistry.js';

// Keep: Chunk class, CHUNK_WIDTH, CHUNK_HEIGHT, SEA_LEVEL, etc.
// Remove: BLOCK_TYPES, BLOCK_PROPERTIES
```

**Files modified**: `chunkData.js` (simplified), `index.html` (add script tag for blockRegistry.js)
**New file**: `js/world/blockRegistry.js`
**Deleted**: old `textures/*.png` files, old `textures/manifest.json`

---

## Phase 2: Auto-Generate Manifest & Triple Atlas

**Goal**: Scan `textures/blocks/`, auto-assign sequential IDs, build 3 parallel texture atlases.

### 2.1 Manifest Generator Script

Create `scripts/generate-manifest.js` — a Node.js script that:

1. Scans `textures/blocks/` for all `*.png` files (excluding `*_n.png` and `*_s.png`)
2. Groups textures by base name (e.g., `oak_log.png` + `oak_log_top.png` → one block)
3. Cross-references with `blockRegistry.js` to assign IDs
4. Outputs `textures/blocks/manifest.json`

```json
[
  {
    "id": 1,
    "name": "bedrock",
    "textures": {
      "all": { "base": "bedrock", "exists": true }
    }
  },
  {
    "id": 71,
    "name": "oak_log",
    "textures": {
      "side": { "base": "oak_log", "exists": true },
      "top": { "base": "oak_log_top", "exists": true },
      "bottom": { "base": "oak_log_top", "exists": true }
    }
  },
  {
    "id": 51,
    "name": "grass_block",
    "textures": {
      "top": { "base": "grass_block_top", "exists": true },
      "side": { "base": "grass_block_side", "exists": true },
      "bottom": { "base": "dirt", "exists": true }
    }
  }
]
```

The script also validates that every block in the registry has its textures present, and reports missing textures.

### 2.2 Rewrite `textureAtlas.js` → `PBRTextureAtlas`

Replace the entire class with a triple-atlas builder:

```js
class PBRTextureAtlas {
  constructor() {
    this.tileSize = 128;  // Source textures are 128×128, baked at 1:1

    // Three canvases — identical grid layout
    this.diffuseCanvas = null;
    this.normalCanvas = null;
    this.smoothnessCanvas = null;

    // Three THREE.CanvasTextures
    this.diffuseTexture = null;
    this.normalTexture = null;
    this.smoothnessTexture = null;

    // Grid dimensions (shared across all 3 atlases)
    this.gridW = 0;
    this.gridH = 0;

    // Block → tile mapping
    // this.tileMap[blockId] = {
    //   tiles: {
    //     top:    { col, row },
    //     side:   { col, row },
    //     bottom: { col, row },
    //     front:  { col, row },  // optional
    //   }
    // }
    this.tileMap = {};
    this.loaded = false;
  }

  async buildAtlas() {
    // 1. Load manifest from textures/blocks/manifest.json
    const manifest = await fetch('textures/blocks/manifest.json').then(r => r.json());

    // 2. Count total unique texture bases (each gets one grid slot)
    const textureBases = new Set();
    for (const block of manifest) {
      for (const entry of Object.values(block.textures)) {
        textureBases.add(entry.base);
      }
    }

    // 3. Calculate grid size — always square, power-of-2 friendly
    const totalTiles = textureBases.size;
    const gridSize = Math.ceil(Math.sqrt(totalTiles));
    this.gridW = gridSize;
    this.gridH = gridSize;
    // With ~600 textures: 25×25 grid, 128px tiles = 3200×3200 atlas canvas

    // 4. Create 3 canvases
    const size = gridSize * this.tileSize;
    this.diffuseCanvas = this._createCanvas(size);
    this.normalCanvas = this._createCanvas(size);
    this.smoothnessCanvas = this._createCanvas(size);

    // 5. Load all textures and bake into 3 atlases
    const baseToSlot = {};  // texture base name → { col, row }
    let slotIndex = 0;

    const loadPromises = [];
    for (const base of textureBases) {
      const col = slotIndex % gridSize;
      const row = Math.floor(slotIndex / gridSize);
      baseToSlot[base] = { col, row };
      loadPromises.push(this._loadTriple(base, col, row));
      slotIndex++;
    }

    await Promise.all(loadPromises);

    // 6. Build tileMap from manifest + baseToSlot
    for (const block of manifest) {
      const tiles = {};
      for (const [face, entry] of Object.entries(block.textures)) {
        const slot = baseToSlot[entry.base];
        if (slot) {
          tiles[face] = { col: slot.col, row: slot.row };
        }
      }
      this.tileMap[block.id] = { tiles };
    }

    // 7. Create THREE.CanvasTexture for each atlas
    this.diffuseTexture = this._makeTexture(this.diffuseCanvas);
    this.normalTexture = this._makeTexture(this.normalCanvas);
    this.smoothnessTexture = this._makeTexture(this.smoothnessCanvas);

    // Normal and smoothness atlases should use linear filtering (not nearest)
    this.normalTexture.magFilter = THREE.LinearFilter;
    this.normalTexture.minFilter = THREE.LinearMipmapLinearFilter;
    this.smoothnessTexture.magFilter = THREE.LinearFilter;
    this.smoothnessTexture.minFilter = THREE.LinearMipmapLinearFilter;

    this.loaded = true;
  }

  async _loadTriple(base, col, row) {
    const x = col * this.tileSize;
    const y = row * this.tileSize;

    // Load diffuse
    await this._loadImage(`textures/blocks/${base}.png`, this.diffuseCanvas, x, y);
    // Load normal map
    await this._loadImage(`textures/blocks/${base}_n.png`, this.normalCanvas, x, y);
    // Load smoothness map
    await this._loadImage(`textures/blocks/${base}_s.png`, this.smoothnessCanvas, x, y);
  }

  _makeTexture(canvas) {
    const tex = new THREE.CanvasTexture(canvas);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.generateMipmaps = true;
    tex.premultiplyAlpha = false;
    return tex;
  }

  /**
   * Get UV coordinates for a block ID and face direction.
   * Returns { u, v, size } for the diffuse atlas.
   * Normal and smoothness atlases use the same UV (identical grid).
   */
  getFaceUV(blockId, faceName) {
    const entry = this.tileMap[blockId];
    if (!entry) return { u: 0, v: 0, size: 0 };

    // Resolve face name to tile
    let tile = entry.tiles[faceName];
    if (!tile) {
      // Fallback chain: face → side → top → first available
      tile = entry.tiles.side || entry.tiles.top || Object.values(entry.tiles)[0];
    }
    if (!tile) return { u: 0, v: 0, size: 0 };

    const tileSizeFrac = 1.0 / this.gridW;
    return {
      u: tile.col * tileSizeFrac,
      v: 1.0 - (tile.row + 1) * tileSizeFrac,  // Flip Y for WebGL
      size: tileSizeFrac,
    };
  }
}
```

**Key differences from old atlas:**
- 3 canvases instead of 1 — identical grid layout means same UVs work for all 3
- No more `BLOCKID_SIDENUM-name.png` naming — reads directly from `textures/blocks/`
- Diffuse atlas uses `NearestFilter` (pixel art), normal/smoothness use `LinearFilter`
- `tileMap` indexed by block ID → face → grid position
- Manifest-driven — no hardcoded name mappings

**Files modified**: `textureAtlas.js` (complete rewrite)
**New files**: `scripts/generate-manifest.js`, `textures/blocks/manifest.json`

---

## Phase 3: PBR Shader Material

**Goal**: Custom `ShaderMaterial` implementing simplified PBR with the 3 texture atlases.

### 3.1 Create `js/renderer/pbrShader.js`

```js
// ── Vertex Shader ──
export const PBRVertexShader = `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec3 vViewDir;

  void main() {
    vUv = uv;
    vNormal = normalize((modelViewMatrix * vec4(normal, 0.0)).xyz);
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    vViewDir = normalize(cameraPosition - worldPos.xyz);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// ── Fragment Shader — Simplified PBR ──
export const PBRFragmentShader = `
  precision mediump float;

  uniform sampler2D uDiffuseMap;
  uniform sampler2D uNormalMap;
  uniform sampler2D uSmoothnessMap;

  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform float uSunIntensity;

  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;
  uniform float uAmbientIntensity;

  uniform float uEmissive;    // Block self-illumination (0 = none, 1 = full glow)

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec3 vViewDir;

  void main() {
    // ── Sample textures ──
    vec3 albedo = texture2D(uDiffuseMap, vUv).rgb;
    vec3 packedNormal = texture2D(uNormalMap, vUv).rgb;
    float smoothness = texture2D(uSmoothnessMap, vUv).r;

    // ── Normal map: unpack [0,1] → [-1,1], use as perturbation ──
    // For voxel faces, the geometry normal IS the face direction.
    // The normal map provides micro-surface detail.
    vec3 perturbedNormal = normalize(packedNormal * 2.0 - 1.0);
    // Blend geometry normal with normal map perturbation
    vec3 N = normalize(mix(vNormal, perturbedNormal, 0.8));

    float roughness = 1.0 - smoothness;

    // ── Hemisphere ambient ──
    float NdotY = max(N.y, 0.0);
    vec3 ambient = mix(uGroundColor, uSkyColor, NdotY);
    ambient *= uAmbientIntensity;

    // ── Diffuse lighting (Lambert) ──
    vec3 L = normalize(uSunDirection);
    float NdotL = max(dot(N, L), 0.0);
    vec3 diffuse = albedo * uSunColor * uSunIntensity * NdotL;

    // ── Specular (Blinn-Phong with smoothness-driven exponent) ──
    vec3 H = normalize(L + vViewDir);
    float NdotH = max(dot(N, H), 0.0);
    float specExponent = mix(4.0, 128.0, smoothness);
    float spec = pow(NdotH, specExponent);
    vec3 specular = uSunColor * uSunIntensity * spec * smoothness * 0.5;

    // ── Combine ──
    vec3 color = albedo * ambient + diffuse + specular;

    // ── Emissive (for glowstone, lava, torches, etc.) ──
    color += albedo * uEmissive;

    gl_FragColor = vec4(color, 1.0);
  }
`;

// ── Cutout Fragment Shader (alpha discard for leaves, flowers) ──
export const PBRFragmentShaderCutout = `
  precision mediump float;

  uniform sampler2D uDiffuseMap;
  uniform sampler2D uNormalMap;
  uniform sampler2D uSmoothnessMap;

  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform float uSunIntensity;

  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;
  uniform float uAmbientIntensity;

  uniform float uEmissive;
  uniform float uAlphaCutoff;  // Discard pixels below this alpha

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec3 vViewDir;

  void main() {
    vec4 albedoAlpha = texture2D(uDiffuseMap, vUv);
    vec3 albedo = albedoAlpha.rgb;

    // Alpha test — discard transparent pixels
    if (albedoAlpha.a < uAlphaCutoff) discard;

    vec3 packedNormal = texture2D(uNormalMap, vUv).rgb;
    float smoothness = texture2D(uSmoothnessMap, vUv).r;

    vec3 perturbedNormal = normalize(packedNormal * 2.0 - 1.0);
    vec3 N = normalize(mix(vNormal, perturbedNormal, 0.8));
    float roughness = 1.0 - smoothness;

    vec3 ambient = mix(uGroundColor, uSkyColor, max(N.y, 0.0)) * uAmbientIntensity;
    vec3 L = normalize(uSunDirection);
    float NdotL = max(dot(N, L), 0.0);
    vec3 diffuse = albedo * uSunColor * uSunIntensity * NdotL;

    vec3 H = normalize(L + vViewDir);
    float spec = pow(max(dot(N, H), 0.0), mix(4.0, 128.0, smoothness));
    vec3 specular = uSunColor * uSunIntensity * spec * smoothness * 0.3;

    vec3 color = albedo * ambient + diffuse + specular + albedo * uEmissive;

    gl_FragColor = vec4(color, 1.0);
  }
`;

// ── Transparent Fragment Shader (water, glass, ice) ──
export const PBRFragmentShaderTransparent = `
  precision mediump float;

  uniform sampler2D uDiffuseMap;
  uniform sampler2D uNormalMap;
  uniform sampler2D uSmoothnessMap;

  uniform vec3 uSunDirection;
  uniform vec3 uSunColor;
  uniform float uSunIntensity;

  uniform vec3 uSkyColor;
  uniform vec3 uGroundColor;
  uniform float uAmbientIntensity;

  uniform float uEmissive;
  uniform float uOpacity;

  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPosition;
  varying vec3 vViewDir;

  void main() {
    vec4 albedoAlpha = texture2D(uDiffuseMap, vUv);
    vec3 albedo = albedoAlpha.rgb;

    vec3 packedNormal = texture2D(uNormalMap, vUv).rgb;
    float smoothness = texture2D(uSmoothnessMap, vUv).r;

    vec3 perturbedNormal = normalize(packedNormal * 2.0 - 1.0);
    vec3 N = normalize(mix(vNormal, perturbedNormal, 0.6));

    vec3 ambient = mix(uGroundColor, uSkyColor, max(N.y, 0.0)) * uAmbientIntensity;
    vec3 L = normalize(uSunDirection);
    float NdotL = max(dot(N, L), 0.0);
    vec3 diffuse = albedo * uSunColor * uSunIntensity * NdotL;

    vec3 H = normalize(L + vViewDir);
    float spec = pow(max(dot(N, H), 0.0), mix(4.0, 256.0, smoothness));
    vec3 specular = uSunColor * uSunIntensity * spec * smoothness * 0.8;

    vec3 color = albedo * ambient + diffuse + specular + albedo * uEmissive;

    gl_FragColor = vec4(color, uOpacity * albedoAlpha.a);
  }
`;
```

### 3.2 Material Factory

```js
export class PBRMaterialFactory {
  constructor(diffuseTex, normalTex, smoothnessTex, sunDirection) {
    this.diffuseTex = diffuseTex;
    this.normalTex = normalTex;
    this.smoothnessTex = smoothnessTex;
    this.sunDirection = sunDirection || new THREE.Vector3(50, 100, 50).normalize();
  }

  _baseUniforms() {
    return {
      uDiffuseMap:      { value: this.diffuseTex },
      uNormalMap:       { value: this.normalTex },
      uSmoothnessMap:   { value: this.smoothnessTex },
      uSunDirection:    { value: this.sunDirection },
      uSunColor:        { value: new THREE.Color(1.0, 0.98, 0.92) },
      uSunIntensity:    { value: 1.2 },
      uSkyColor:        { value: new THREE.Color(0.53, 0.81, 1.0) },
      uGroundColor:     { value: new THREE.Color(0.22, 0.18, 0.11) },
      uAmbientIntensity:{ value: 0.35 },
      uEmissive:        { value: 0.0 },
    };
  }

  createSolid(emissive = 0.0) {
    const uniforms = this._baseUniforms();
    uniforms.uEmissive.value = emissive;
    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: PBRVertexShader,
      fragmentShader: PBRFragmentShader,
      fog: true,
    });
  }

  createCutout(emissive = 0.0, alphaCutoff = 0.5) {
    const uniforms = this._baseUniforms();
    uniforms.uEmissive.value = emissive;
    uniforms.uAlphaCutoff = { value: alphaCutoff };
    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: PBRVertexShader,
      fragmentShader: PBRFragmentShaderCutout,
      transparent: true,
      alphaToCoverage: true,
      depthWrite: true,
      side: THREE.DoubleSide,
      fog: true,
    });
  }

  createTransparent(emissive = 0.0, opacity = 0.6) {
    const uniforms = this._baseUniforms();
    uniforms.uEmissive.value = emissive;
    uniforms.uOpacity = { value: opacity };
    return new THREE.ShaderMaterial({
      uniforms,
      vertexShader: PBRVertexShader,
      fragmentShader: PBRFragmentShaderTransparent,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      fog: true,
    });
  }
}
```

**New file**: `js/renderer/pbrShader.js`

---

## Phase 4: Lighting Overhaul

**Goal**: Replace ambient + directional with hemisphere lighting that feeds the PBR shader.

### 4.1 Update `voxelRenderer.js`

Remove the old `AmbientLight` and `DirectionalLight` (they don't affect `ShaderMaterial`). Instead, store lighting parameters that get passed to shader uniforms:

```js
_initThree() {
  // ... existing scene/camera/renderer setup ...

  // Remove old lights:
  // const ambientLight = new THREE.AmbientLight(0x404040, 0.6);
  // const sunLight = new THREE.DirectionalLight(0xffffff, 0.8);

  // Store lighting parameters for PBR shader uniforms
  this.lighting = {
    sunDirection: new THREE.Vector3(50, 100, 50).normalize(),
    sunColor: new THREE.Color(1.0, 0.98, 0.92),
    sunIntensity: 1.2,
    skyColor: new THREE.Color(0.53, 0.81, 1.0),
    groundColor: new THREE.Color(0.22, 0.18, 0.11),
    ambientIntensity: 0.35,
  };

  // Optional: keep a DirectionalLight for any non-shader objects (UI, particles)
  const fillLight = new THREE.DirectionalLight(0xffffff, 0.1);
  fillLight.position.copy(this.lighting.sunDirection);
  this.scene.add(fillLight);
}
```

### 4.2 Day/Night Cycle Integration (Future)

The PBR shader uniforms make day/night trivial:
```js
// Update sun direction and intensity based on time of day
this.lighting.sunDirection.set(x, y, z).normalize();
this.lighting.sunIntensity = Math.max(0, sunY);  // 0 at night, 1.2 at noon
this.lighting.skyColor.lerp(new THREE.Color(0.02, 0.02, 0.06), nightFactor);
```

**Files modified**: `voxelRenderer.js`

---

## Phase 5: Mesh Builder & ChunkManager Integration

**Goal**: Wire PBR materials into the chunk rendering pipeline.

### 5.1 Update `chunkmanager.js` — Material Creation

In `_onMeshBuilt()`, replace `MeshLambertMaterial` with PBR materials:

```js
_onMeshBuilt(key, cx, cz, geoResult) {
  // ... existing geometry handling ...

  const atlas = this.textureAtlas;
  const factory = new PBRMaterialFactory(
    atlas.diffuseTexture,
    atlas.normalTexture,
    atlas.smoothnessTexture,
    this.renderer.lighting.sunDirection
  );

  // Solid mesh
  if (geoResult.solid || geoResult.solidGeometry) {
    const material = factory.createSolid();
    solidMesh = new THREE.Mesh(geometry, material);
    solidMesh.position.set(cx * CHUNK_W, 0, cz * CHUNK_D);
  }

  // Cutout mesh (leaves, flowers, torches)
  if (geoResult.cutout || geoResult.cutoutGeometry) {
    const material = factory.createCutout();
    cutoutMesh = new THREE.Mesh(geometry, material);
    cutoutMesh.position.set(cx * CHUNK_W, 0, cz * CHUNK_D);
  }

  // Transparent mesh (water, ice, slime)
  if (geoResult.trans || geoResult.transparentGeometry) {
    const material = factory.createTransparent();
    transMesh = new THREE.Mesh(geometry, material);
    transMesh.position.set(cx * CHUNK_W, 0, cz * CHUNK_D);
  }

  // ... add to scene ...
}
```

### 5.2 Update `chunkMeshBuilder.js` — Block Categories

Replace hardcoded ID sets with registry lookups:

```js
constructor() {
  // Use block registry instead of hardcoded IDs
  this.cutoutIds = new Set(
    Object.values(BLOCK_BY_ID)
      .filter(b => b.category === 'cutout')
      .map(b => b.id)
  );

  this.transparentIds = new Set(
    Object.values(BLOCK_BY_ID)
      .filter(b => b.category === 'transparent')
      .map(b => b.id)
  );

  this.emissiveBlocks = new Map(
    Object.values(BLOCK_BY_ID)
      .filter(b => b.emissive > 0)
      .map(b => [b.id, b.emissive])
  );
}
```

### 5.3 Update `meshWorker.js` — Block Categories

Same pattern — derive cutout/transparent sets from the registry:

```js
// At top of worker (receive block registry data via postMessage)
var CUTOUT_IDS = {};
var TRANSPARENT_IDS = {};
var EMISSIVE_MAP = {};

// Populated from main thread when worker receives first message
```

The main thread sends the category sets as part of the build message (or the worker receives a bootstrap message with the registry).

### 5.4 Emissive Blocks

Blocks with `emissive > 0` (glowstone, lava, torches, froglights) get a per-mesh emissive uniform. Since all blocks in a chunk share one material, we have two options:

**Option A (simpler)**: Emissive blocks go into a separate mesh stream. The emissive material uses `uEmissive = 1.0`.

**Option B (more complex)**: Per-vertex emissive attribute — adds a 4th float per vertex.

Recommend **Option A** — add a 4th geometry stream `emissivePositions/normals/uvs/indices` alongside solid/cutout/transparent.

**Files modified**: `chunkmanager.js`, `chunkMeshBuilder.js`, `meshWorker.js`

---

## Phase 6: World Generation Integration

**Goal**: Place new block types during terrain generation using the registry.

### 6.1 Update `workerGeneration.js`

Replace hardcoded `BLOCK` constants with registry IDs:

```js
// Instead of:
var BLOCK = { AIR: 0, BEDROCK: 1, STONE: 2, ... };

// Import from registry (worker receives it via postMessage):
// BLOCK_AIR = registry['air'].id
// BLOCK_STONE = registry['stone'].id
// etc.
```

### 6.2 Update Biome Surface Blocks

Map biomes to new block types from the registry:

```js
var BIOME = {
  DEEP_OCEAN: { surfaceBlock: BLOCK_GRAVEL, subBlock: BLOCK_GRAVEL },
  OCEAN:      { surfaceBlock: BLOCK_SAND,    subBlock: BLOCK_GRAVEL },
  BEACH:      { surfaceBlock: BLOCK_SAND,    subBlock: BLOCK_SAND },
  PLAINS:     { surfaceBlock: BLOCK_GRASS_BLOCK, subBlock: BLOCK_DIRT },
  FOREST:     { surfaceBlock: BLOCK_GRASS_BLOCK, subBlock: BLOCK_DIRT },
  BADLANDS:   { surfaceBlock: BLOCK_RED_SAND, subBlock: BLOCK_TERRACOTTA },
  TUNDRA:     { surfaceBlock: BLOCK_SNOW,    subBlock: BLOCK_DIRT },
  DESERT:     { surfaceBlock: BLOCK_SAND,    subBlock: BLOCK_CLAY },
  MOUNTAINS:  { surfaceBlock: BLOCK_GRASS_BLOCK, subBlock: BLOCK_STONE },
};
```

### 6.3 Ore Generation

Add deepslate ore variants at depth:

```js
// Above Y=40: stone-hosted ores
// Below Y=40: deepslate-hosted ores
var ORE_DEFS_SHALLOW = [
  { type: BLOCK_COAL_ORE,    minY: 5,   maxY: 120, chance: 0.018 },
  { type: BLOCK_IRON_ORE,    minY: 5,   maxY: 85,  chance: 0.014 },
  { type: BLOCK_GOLD_ORE,    minY: 5,   maxY: 42,  chance: 0.006 },
  { type: BLOCK_DIAMOND_ORE, minY: 5,   maxY: 24,  chance: 0.003 },
];

var ORE_DEFS_DEEP = [
  { type: BLOCK_DEEPSLATE_COAL_ORE,    minY: 5,   maxY: 40, chance: 0.018 },
  { type: BLOCK_DEEPSLATE_IRON_ORE,    minY: 5,   maxY: 40, chance: 0.014 },
  { type: BLOCK_DEEPSLATE_GOLD_ORE,    minY: 5,   maxY: 40, chance: 0.006 },
  { type: BLOCK_DEEPSLATE_DIAMOND_ORE, minY: 5,   maxY: 40, chance: 0.003 },
  { type: BLOCK_DEEPSLATE_COPPER_ORE,  minY: 5,   maxY: 50, chance: 0.010 },
  { type: BLOCK_DEEPSLATE_EMERALD_ORE, minY: 5,   maxY: 16, chance: 0.002 },
];
```

### 6.4 Tree Generation

Use proper wood types per biome:

```js
var TREE_TYPES = {
  'Forest':  { log: BLOCK_OAK_LOG, logTop: BLOCK_OAK_LOG_TOP, leaves: BLOCK_OAK_LEAVES },
  'Plains':  { log: BLOCK_OAK_LOG, logTop: BLOCK_OAK_LOG_TOP, leaves: BLOCK_OAK_LEAVES },
  'Mountains': { log: BLOCK_SPRUCE_LOG, logTop: BLOCK_SPRUCE_LOG_TOP, leaves: BLOCK_SPRUCE_LEAVES },
  'Tundra':  { log: BLOCK_SPRUCE_LOG, logTop: BLOCK_SPRUCE_LOG_TOP, leaves: BLOCK_SPRUCE_LEAVES },
};
```

**Files modified**: `workerGeneration.js`, `biomeSystem.js`

---

## Phase 7: Index.html Script Loading Order

Update script load order to match dependencies:

```html
<!-- World data (block registry first — everything depends on it) -->
<script src="js/world/blockRegistry.js"></script>
<script src="js/world/noise.js"></script>
<script src="js/world/biomeSystem.js"></script>
<script src="js/world/workerGeneration.js"></script>
<script src="js/world/chunkBinaryCodec.js"></script>
<script src="js/chunkmanager.js"></script>

<!-- Renderer (PBR shader before texture atlas) -->
<script src="js/renderer/pbrShader.js"></script>
<script src="js/renderer/textureAtlas.js"></script>
<script src="js/renderer/chunkMeshBuilder.js"></script>
<script src="js/renderer/meshWorker.js"></script>
<script src="js/renderer/voxelRenderer.js"></script>
```

**Files modified**: `index.html`

---

## Implementation Order

```
Phase 1: Block Registry
    ↓
Phase 2: Manifest Generator + Triple Atlas   ← depends on Phase 1
    ↓
Phase 3: PBR Shader Material                  ← depends on Phase 2
    ↓
Phase 4: Lighting                             ← depends on Phase 3
    ↓
Phase 5: Mesh/ChunkManager Integration        ← depends on Phase 3, 4
    ↓
Phase 6: World Generation                     ← depends on Phase 1
    ↓
Phase 7: Script Loading Order                 ← final wiring
```

### Sprint Breakdown

**Sprint 1 — Foundation (Phase 1 + 2)**
- Define ~200 blocks in `blockRegistry.js`
- Write manifest generator script, run it
- Rewrite `textureAtlas.js` as triple-atlas `PBRTextureAtlas`
- Verify all 3 atlases load and display correctly in debug overlay

**Sprint 2 — PBR Rendering (Phase 3 + 4)**
- Write PBR vertex + fragment shaders (solid, cutout, transparent variants)
- Create `PBRMaterialFactory`
- Replace lighting in `voxelRenderer.js`
- Wire materials into a single test chunk — verify normal maps and smoothness work

**Sprint 3 — Full Integration (Phase 5)**
- Replace `MeshLambertMaterial` with PBR materials in `chunkmanager.js`
- Update `chunkMeshBuilder.js` and `meshWorker.js` category lookups
- Add emissive geometry stream
- Performance test with full render distance

**Sprint 4 — World Generation (Phase 6 + 7)**
- Update `workerGeneration.js` with new block IDs
- Add deepslate ores, proper tree types, biome surface blocks
- Update script loading order in `index.html`
- End-to-end test: generate world → render with PBR → place/break blocks

---

## Files Summary

### New Files
| File | Purpose |
|---|---|
| `js/world/blockRegistry.js` | Single source of truth: all block IDs, names, textures, properties |
| `js/renderer/pbrShader.js` | PBR vertex/fragment shaders + `PBRMaterialFactory` |
| `scripts/generate-manifest.js` | Node.js script: scan `textures/blocks/` → `manifest.json` |
| `textures/blocks/manifest.json` | Auto-generated block → texture mapping |

### Modified Files
| File | Changes |
|---|---|
| `js/world/chunkData.js` | Remove `BLOCK_TYPES`/`BLOCK_PROPERTIES`, import from registry. Keep `Chunk` class + constants |
| `js/renderer/textureAtlas.js` | Complete rewrite: triple atlas, manifest-driven, new naming |
| `js/renderer/voxelRenderer.js` | Remove old lights, add `this.lighting` params for shader uniforms |
| `js/chunkmanager.js` | Use `PBRMaterialFactory`, pass lighting uniforms, add emissive stream |
| `js/renderer/chunkMeshBuilder.js` | Derive cutout/transparent sets from registry, add emissive stream |
| `js/renderer/meshWorker.js` | Receive category sets from registry, add emissive stream |
| `js/world/workerGeneration.js` | Use registry block IDs, add deepslate ores, proper tree types |
| `js/world/biomeSystem.js` | Map biomes to new surface blocks |
| `index.html` | Reorder script loading, add new files |

### Deleted Files
| File | Reason |
|---|---|
| `textures/*.png` (root-level) | Old ID_SIDENUM naming convention |
| `textures/manifest.json` | Old manifest format |

---

## Atlas Size Estimate

With ~200 blocks and ~2-3 face textures each = ~450-600 unique texture bases.

Source textures are **128×128 px**, baked into the atlas at **1:1 (no downscaling)**.

```
Grid: 25 × 25 (square, fits 625 tiles — enough for ~600 unique texture bases)
Tile size: 128px → Atlas: 3200 × 3200 px per canvas
3 atlases × 3200 × 3200 × 4 bytes = ~118 MB total (GPU texture memory)
```

### Notes

- 3200×3200 is within the 4096×4096 max texture size supported by virtually all modern GPUs
- If the texture count grows beyond 625 unique bases, the grid expands to 32×32 = 1024 slots (4096×4096 atlas) — still within GPU limits
- All 3 atlases (diffuse/normal/smoothness) share the same grid layout, so UVs are identical across all 3

### Baking

The atlas canvas draws each 128×128 source image at 1:1:
```js
// Load 128×128 image, draw at full resolution into atlas
this.context.drawImage(img, col * 128, row * 128, 128, 128);
```

## Risk Assessment

| Risk | Mitigation |
|---|---|
| **Shader performance** — 3 texture lookups per fragment | Normal + smoothness could be packed into RG channels of one texture, reducing to 2 lookups. Start with 3, profile, optimize if needed. |
| **Normal map orientation** on voxel faces | Geometry normals are flat face normals. Normal maps perturb in tangent space. Since each face has a consistent normal direction, the TBN matrix is stable. Use `mix(geometryNormal, perturbedNormal, 0.8)` for subtle detail. |
| **Old saved worlds** | Delete IndexedDB stores — fresh start. No migration needed. |
| **Worker registry bootstrap** | Send category sets (cutout IDs, transparent IDs) as plain arrays in the first `postMessage` to mesh workers. |
| **Emissive blocks sharing materials** | Separate emissive geometry stream — emissive blocks get their own mesh with `uEmissive > 0`. |
