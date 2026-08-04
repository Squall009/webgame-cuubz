/**
 * Cuubz — Item Texture Atlas (2D UI Atlas for Hotbar/Inventory)
 *
 * Builds one diffuse atlas canvas holding an icon for every inventory item — both
 * named items (`'coal'`, `'wooden_sword'`) and every placeable block, keyed by id.
 * `Hotbar.renderItemIcon`, `InventoryScreen` and `FirstPersonHand` all read it.
 *
 * The atlas uses nearest-neighbour filtering for a crisp pixel-art look in the UI.
 * Tile size: 64×64 px (items display at 48×48 in the hotbar; 64 gives headroom).
 * Grid: auto-sized square grid to fit all items.
 *
 * ── Why this file was rewritten ───────────────────────────────────────
 *
 * Both halves of the registry used to be hand-maintained arrays living in this file,
 * and both had drifted from the data they were copies of:
 *
 *   Named items — 92 entries against 104 in `NAMED_ITEMS`. The missing 14 (every ingot,
 *   `diamond`, `apple`, `leather`, `corrupt_crystal`, …) got no slot, so `renderItemIcon`
 *   fell through all three of its branches and left the canvas blank.
 *
 *   Block items — 29 hardcoded ids, each painted as a FLAT COLOURED SQUARE with the
 *   block's initial on it, because the comment claimed "the actual block texture will be
 *   drawn from the block atlas at render time". Nothing did that. Worse, the ids were
 *   stale: they predate the current 193-entry `BLOCK_REGISTRY`, so id 4 was labelled
 *   "Grass Block" but is `andesite`, id 32 "Wood Log" but is `deepslate_gold_ore`, id 45
 *   "Glowstone" but is `raw_iron_block`. And because `renderItemIcon` checks this atlas
 *   FIRST, those 29 ids were exactly the ones that could never reach the block-atlas
 *   fallback that would have drawn them correctly. That is the coloured-box bug: the
 *   blocks with a placeholder here rendered wrong, and the 163 without one rendered fine.
 *
 * So neither list is hand-maintained any more. Named items come from
 * textures/items/manifest.json (generated from `NAMED_ITEMS` by
 * scripts/generate-manifest.js) and block items come from the block atlas's own
 * `tileMap`, with the real block pixels blitted into the slot. There is no longer any
 * code path that invents a colour for a block.
 */

import * as THREE from 'three';
import { BLOCK_BY_ID } from '../world/BlockRegistry.js';

export class ItemTextureAtlas {
  /**
   * @param {object} options
   * @param {number} [options.tileSize=64] Atlas cell size in px.
   * @param {import('./TextureAtlas.js').PBRTextureAtlas} [options.blockAtlas] The block
   *   atlas, already built. Block icons are blitted out of its diffuse canvas, so
   *   without it the atlas holds named items only.
   */
  constructor(options = {}) {
    this.tileSize = options.tileSize || 64;
    this.blockAtlas = options.blockAtlas || null;
    this.canvas = null;
    this.texture = null; // THREE.CanvasTexture
    this.loaded = false;

    // itemKey → { col, row }
    // itemKey is either a named item string ('coal', 'wooden_sword') or a block ID number
    this.slotMap = {};

    // itemKey → item metadata { name, displayName }
    this.itemRegistry = {};

    // Item keys that fell back to the "?" placeholder — asserted empty by
    // test/unit/meta/textureCoverage.test.js, and worth logging when it is not.
    this.missingTextures = [];

    // Grid dimensions
    this.gridW = 0;
    this.gridH = 0;
    this._gap = 1; // 1px gap between tiles
  }

  /**
   * Build the item texture atlas.
   * Returns a promise that resolves when all textures are loaded.
   */
  async buildAtlas() {
    // 1. Build item registry from the item manifest + the block atlas
    const items = await this._buildItemRegistry();
    this.itemRegistry = items;

    const totalItems = Object.keys(items).length;
    if (totalItems === 0) {
      console.warn('[ItemTextureAtlas] No items registered');
      return this;
    }

    // 2. Calculate grid size
    const gridSize = Math.ceil(Math.sqrt(totalItems));
    this.gridW = gridSize;
    this.gridH = gridSize;

    const canvasSize = gridSize * this.tileSize + (gridSize + 1) * this._gap;
    console.log(`[ItemTextureAtlas] ${totalItems} items → ${gridSize}×${gridSize} grid, ${canvasSize}×${canvasSize} px atlas`);

    // 3. Create canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = canvasSize;
    this.canvas.height = canvasSize;

    // 4. Assign slots and load textures
    const loadPromises = [];
    let slotIndex = 0;

    for (const [itemKey, itemData] of Object.entries(items)) {
      const col = slotIndex % gridSize;
      const row = Math.floor(slotIndex / gridSize);
      this.slotMap[itemKey] = { col, row };

      loadPromises.push(this._loadItemTexture(itemKey, itemData, col, row));
      slotIndex++;
    }

    await Promise.all(loadPromises);

    // 5. Create THREE.CanvasTexture
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.magFilter = THREE.NearestFilter;
    this.texture.minFilter = THREE.NearestFilter;
    this.texture.generateMipmaps = false;
    this.texture.wrapS = THREE.ClampToEdgeWrapping;
    this.texture.wrapT = THREE.ClampToEdgeWrapping;

    this.loaded = true;
    console.log(`[ItemTextureAtlas] Atlas built: ${totalItems} items, ${Object.keys(this.slotMap).length} slots`);
    if (this.missingTextures.length > 0) {
      console.error(
        `[ItemTextureAtlas] ${this.missingTextures.length} item(s) drew a placeholder: ${this.missingTextures.join(', ')}`,
      );
    }
    return this;
  }

  /**
   * Build the item registry — maps item keys to how their icon is sourced.
   *
   * Two sources, no hand-maintained copy of either:
   *   - textures/items/manifest.json, generated from `NAMED_ITEMS`, for named items.
   *   - the block atlas's `tileMap`, for every block that made it into the block atlas.
   */
  async _buildItemRegistry() {
    const items = {};

    // -- Named items (non-block inventory items) --
    const manifest = await this._loadItemManifest();
    for (const entry of manifest) {
      items[entry.key] = {
        name: entry.name,
        displayName: entry.name,
        textureName: entry.texture,
        texturePath: `/textures/items/${entry.texture}.png`,
        isBlock: false,
      };
    }

    // -- Block items (numeric IDs) --
    // Every block the block atlas resolved tiles for, so the two atlases cannot
    // disagree about which blocks exist. `air` has no tiles and drops out on its own.
    if (this.blockAtlas && this.blockAtlas.tileMap) {
      for (const [idStr, entry] of Object.entries(this.blockAtlas.tileMap)) {
        const tile = this._pickIconTile(entry.tiles);
        if (!tile) continue;
        const id = Number(idStr);
        const block = BLOCK_BY_ID[id];
        const name = block ? block.name : `Block ${id}`;
        items[id] = { name, displayName: name, blockId: id, tile, isBlock: true };
      }
    } else {
      console.warn('[ItemTextureAtlas] No block atlas supplied - block icons will be absent');
    }

    return items;
  }

  /**
   * Fetch textures/items/manifest.json.
   *
   * An empty result is survivable (blocks still get icons) but never expected, so it
   * warns rather than failing quietly - the manifest is a build artefact of
   * `npm run generate-manifest` and its absence means the deploy dropped it.
   */
  async _loadItemManifest() {
    try {
      const resp = await fetch('/textures/items/manifest.json');
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const manifest = await resp.json();
      if (!Array.isArray(manifest)) throw new Error('manifest is not an array');
      return manifest;
    } catch (e) {
      console.warn('[ItemTextureAtlas] Could not load items/manifest.json:', e.message);
      return [];
    }
  }

  /**
   * Choose which face of a block to show as its inventory icon.
   *
   * `side` before `top` because it is the face that reads as the block for the shapes
   * where the two differ most - logs show bark rather than end rings, grass_block shows
   * the grass-fringed dirt rather than a flat green square.
   */
  _pickIconTile(tiles) {
    if (!tiles) return null;
    return tiles.all || tiles.side || tiles.top || tiles.front || tiles.bottom
      || Object.values(tiles)[0] || null;
  }

  /**
   * Load a single item's texture into the atlas at the given grid position.
   */
  async _loadItemTexture(itemKey, itemData, col, row) {
    const x = this._gap + col * (this.tileSize + this._gap);
    const y = this._gap + row * (this.tileSize + this._gap);
    const ctx = this.canvas.getContext('2d');

    if (itemData.isBlock) {
      this._blitBlockTile(ctx, x, y, itemKey, itemData);
      return;
    }

    // For named items, load from textures/items/
    if (itemData.texturePath) {
      await this._loadImage(itemData.texturePath, ctx, x, y, itemKey);
    } else {
      this._drawPlaceholder(ctx, x, y, itemKey);
    }
  }

  /**
   * Copy a block's real pixels out of the block atlas into this atlas's slot.
   *
   * Nothing is fetched — the block atlas is already built and awaited by the time this
   * runs (see the ordering note in src/core/init/initScene.js step 4), so this is a
   * canvas-to-canvas blit. That also means colour multipliers and grass-style overlays
   * are already baked into the source pixels and the icon matches the placed block.
   */
  _blitBlockTile(ctx, x, y, itemKey, itemData) {
    const atlas = this.blockAtlas;
    const srcCell = atlas.tileSize + atlas._gap;
    const sx = atlas._gap + itemData.tile.col * srcCell;
    const sy = atlas._gap + itemData.tile.row * srcCell;

    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      atlas.diffuseCanvas,
      sx, sy, atlas.tileSize, atlas.tileSize,
      x, y, this.tileSize, this.tileSize,
    );
  }

  /**
   * Draw a generic placeholder for a texture that failed to load, and record the key.
   *
   * The "?" is deliberate. The old 404 path painted a flat grey square and said nothing,
   * which is indistinguishable from a dark item texture — a missing icon could sit in the
   * hotbar for months without anyone calling it a bug. A "?" plus a console warning plus
   * an entry in `missingTextures` makes it look like the failure it is.
   */
  _drawPlaceholder(ctx, x, y, itemKey) {
    this.missingTextures.push(itemKey);
    console.warn(`[ItemTextureAtlas] No texture for '${itemKey}' — drawing placeholder`);

    ctx.fillStyle = '#555555';
    ctx.fillRect(x, y, this.tileSize, this.tileSize);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = `${this.tileSize / 3}px monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('?', x + this.tileSize / 2, y + this.tileSize / 2);
  }

  /**
   * Load a single image and draw it onto the canvas.
   */
  _loadImage(url, ctx, x, y, itemKey) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, x, y, this.tileSize, this.tileSize);
        resolve();
      };
      img.onerror = () => {
        this._drawPlaceholder(ctx, x, y, itemKey);
        resolve();
      };
      img.src = url;
    });
  }

  /**
   * Get UV coordinates for an item key (string name or block ID number).
   * Returns { u, v, size } for use with the item atlas texture.
   */
  getItemUV(itemKey) {
    const slot = this.slotMap[itemKey];
    if (!slot) {
      // Try string conversion for numeric keys
      const strKey = String(itemKey);
      const strSlot = this.slotMap[strKey];
      if (!strSlot) {
        return null;
      }
      return this._slotToUV(strSlot.col, strSlot.row);
    }
    return this._slotToUV(slot.col, slot.row);
  }

  /**
   * Convert a grid slot to UV coordinates.
   */
  _slotToUV(col, row) {
    const atlasSize = this.gridW * this.tileSize + (this.gridW + 1) * this._gap;
    const cellFrac = (this.tileSize + this._gap) / atlasSize;
    const gapFrac = this._gap / atlasSize;
    return {
      u: gapFrac + col * cellFrac,
      v: 1.0 - (row + 1) * cellFrac,
      size: this.tileSize / atlasSize,
    };
  }

  /**
   * Get display name for an item key.
   */
  getDisplayName(itemKey) {
    const item = this.itemRegistry[itemKey];
    if (!item) {
      const strKey = String(itemKey);
      const strItem = this.itemRegistry[strKey];
      return strItem ? strItem.displayName : String(itemKey);
    }
    return item.displayName;
  }

  /**
   * Get the item texture (THREE.CanvasTexture).
   */
  getTexture() {
    return this.texture;
  }

  /**
   * Get the raw canvas (for debugging).
   */
  getCanvas() {
    return this.canvas;
  }
}
