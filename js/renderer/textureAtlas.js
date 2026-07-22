/**
 * Cuubz — PBR Texture Atlas (Triple Atlas: Diffuse + Normal + Smoothness)
 * 
 * Reads textures/blocks/manifest.json to build 3 parallel canvases with
 * identical grid layout. All 3 atlases share the same UV coordinates.
 * 
 * Tile size: 128×128 px (source textures are 128×128, baked at 1:1)
 * Grid: square, auto-sized to fit all unique texture bases (~25×25 for ~600 textures)
 * Atlas canvas: 3200×3200 px per canvas (within 4096 GPU max)
 * 
 * Filtering:
 *   Diffuse     → NearestFilter (pixel art look)
 *   Normal      → LinearFilter (smooth interpolation)
 *   Smoothness  → LinearFilter (smooth interpolation)
 */

class PBRTextureAtlas {
  constructor() {
    this.tileSize = 128; // Source textures are 128×128, baked at 1:1

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

    // Debug info
    this.debugInfo = [];
  }

  /**
   * Build all 3 atlases from manifest.
   * Returns Promise that resolves when all textures are loaded and baked.
   */
  async buildAtlas() {
    // 1. Load manifest
    const manifest = await this._loadManifest();
    if (!manifest || manifest.length === 0) {
      console.warn('[PBRTextureAtlas] Empty or missing manifest — atlas will be empty');
      return this;
    }

    // 2. Collect all unique texture base names
    const textureBases = new Map(); // baseName → true (preserves insertion order)
    for (const block of manifest) {
      for (const entry of Object.values(block.textures)) {
        if (entry.exists) {
          textureBases.set(entry.base, true);
        }
      }
    }

    if (textureBases.size === 0) {
      console.warn('[PBRTextureAtlas] No textures found in manifest');
      return this;
    }

    // 3. Calculate grid size — always square
    const gridSize = Math.ceil(Math.sqrt(textureBases.size));
    this.gridW = gridSize;
    this.gridH = gridSize;

    // 2px gap between tiles so edge replication doesn't overwrite adjacent tiles.
    this._gap = 2;
    const canvasSize = gridSize * this.tileSize + (gridSize + 1) * this._gap;
    console.log(`[PBRTextureAtlas] ${textureBases.size} unique textures → ${gridSize}×${gridSize} grid, ${canvasSize}×${canvasSize} px atlas (2px gaps, ${canvasSize} ≤ 4096: ${canvasSize <= 4096})`);

    // 4. Create 3 canvases
    this.diffuseCanvas = this._createCanvas(canvasSize);
    this.normalCanvas = this._createCanvas(canvasSize);
    this.smoothnessCanvas = this._createCanvas(canvasSize);

    // 5. Assign grid slots and load all textures
    const baseToSlot = {}; // texture base name → { col, row }
    let slotIndex = 0;

    const loadPromises = [];
    for (const [base] of textureBases) {
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
    this.diffuseTexture = this._makeTexture(this.diffuseCanvas, true);  // nearest
    this.normalTexture = this._makeTexture(this.normalCanvas, false);   // linear
    this.smoothnessTexture = this._makeTexture(this.smoothnessCanvas, false); // linear

    // 8. Build debug info
    this._buildDebugInfo();

    this.loaded = true;
    console.log(`[PBRTextureAtlas] Atlas built: ${textureBases.size} tiles, ${Object.keys(this.tileMap).length} block mappings`);
    return this;
  }

  /**
   * Load manifest from textures/blocks/manifest.json.
   * Falls back to auto-scanning if manifest doesn't exist.
   */
  async _loadManifest() {
    try {
      const resp = await fetch('textures/blocks/manifest.json');
      if (resp.ok) {
        return await resp.json();
      }
    } catch (e) {
      console.warn('[PBRTextureAtlas] Could not load manifest.json:', e.message);
    }
    return null;
  }

  /**
   * Load one texture base into all 3 atlases at the same grid position.
   * Tiles are spaced by tileSize + gap pixels.
   */
  async _loadTriple(base, col, row) {
    const x = this._gap + col * (this.tileSize + this._gap);
    const y = this._gap + row * (this.tileSize + this._gap);

    try {
      // Load diffuse
      await this._loadImage(`textures/blocks/${base}.png`, this.diffuseCanvas, x, y);
      // Load normal map
      await this._loadImage(`textures/blocks/${base}_n.png`, this.normalCanvas, x, y);
      // Load smoothness map
      await this._loadImage(`textures/blocks/${base}_s.png`, this.smoothnessCanvas, x, y);
    } catch (e) {
      console.error(`[PBRTextureAtlas] Failed to load ${base}:`, e.message);
    }
  }

  /**
   * Load a single image and draw it onto a canvas at the specified position.
   * Replicates edge pixels outward by 1px so linear filtering doesn't bleed
   * into adjacent atlas tiles (which causes visible seams at tile boundaries).
   */
  _loadImage(url, canvas, x, y) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const ctx = canvas.getContext('2d');
        // Draw the image
        ctx.drawImage(img, x, y, this.tileSize, this.tileSize);
        // Replicate edge pixels outward by 1px to prevent atlas tile bleeding
        this._replicateEdges(ctx, x, y, this.tileSize);
        resolve();
      };
      img.onerror = () => {
        // Fill with fallback color (dark grey for diffuse, neutral for normal/smoothness)
        const ctx = canvas.getContext('2d');
        if (canvas === this.normalCanvas) {
          // Normal map fallback: (128, 128, 255) = flat normal pointing toward viewer
          ctx.fillStyle = 'rgb(128, 128, 255)';
        } else if (canvas === this.smoothnessCanvas) {
          // Smoothness fallback: medium grey = 50% roughness
          ctx.fillStyle = 'rgb(128, 128, 128)';
        } else {
          // Diffuse fallback: dark grey
          ctx.fillStyle = 'rgb(100, 100, 100)';
        }
        ctx.fillRect(x, y, this.tileSize, this.tileSize);
        resolve(); // Don't reject — continue with fallback
      };
      img.src = url;
    });
  }

  /**
   * Replicate the edge pixels of a tile outward by 1 pixel in all 4 directions.
   * The 2px gap between tiles provides room to write without overwriting neighbors.
   */
  _replicateEdges(ctx, x, y, size) {
    const imgTop = ctx.getImageData(x, y, size, 1);
    const imgBot = ctx.getImageData(x, y + size - 1, size, 1);
    const imgLeft = ctx.getImageData(x, y, 1, size);
    const imgRight = ctx.getImageData(x + size - 1, y, 1, size);

    // Top edge → write above (into gap)
    ctx.putImageData(new ImageData(new Uint8ClampedArray(imgTop.data), size, 1), x, y - 1);
    // Bottom edge → write below (into gap)
    ctx.putImageData(new ImageData(new Uint8ClampedArray(imgBot.data), size, 1), x, y + size);
    // Left edge → write left (into gap)
    ctx.putImageData(new ImageData(new Uint8ClampedArray(imgLeft.data), 1, size), x - 1, y);
    // Right edge → write right (into gap)
    ctx.putImageData(new ImageData(new Uint8ClampedArray(imgRight.data), 1, size), x + size, y);
  }

  /**
   * Create a blank canvas with the given size.
   */
  _createCanvas(size) {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    return canvas;
  }

  /**
   * Create a THREE.CanvasTexture from a canvas.
   * @param {boolean} nearest - Use NearestFilter (true) or LinearFilter (false)
   */
  _makeTexture(canvas, nearest) {
    const tex = new THREE.CanvasTexture(canvas);
    if (nearest) {
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.generateMipmaps = false;
    } else {
      tex.magFilter = THREE.LinearFilter;
      tex.minFilter = THREE.LinearFilter;       // No mipmaps — prevents atlas tile bleeding
      tex.generateMipmaps = false;               // Mipmaps blend across tile edges → seams
    }
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.premultiplyAlpha = false;
    return tex;
  }

  /**
   * Get UV coordinates for a block ID and face direction.
   * Returns { u, v, size } — same UVs work for all 3 atlases.
   * 
   * Face name resolution:
   *   top, bottom, front, back, left, right → exact match
   *   Falls back to: face → side → top → first available tile
   */
  getFaceUV(blockId, faceName) {
    const entry = this.tileMap[blockId];
    if (!entry || !entry.tiles) {
      return { u: 0, v: 0, size: 0 };
    }

    // Resolve face name to tile
    let tile = entry.tiles[faceName];
    if (!tile) {
      // Fallback chain: face → side → top → first available
      if (faceName === 'front' || faceName === 'back' || faceName === 'left' || faceName === 'right') {
        tile = entry.tiles.side;
      }
      if (!tile) {
        tile = entry.tiles.top;
      }
      if (!tile) {
        // Use first available tile
        tile = Object.values(entry.tiles)[0];
      }
    }

    if (!tile) {
      return { u: 0, v: 0, size: 0 };
    }

    // UV mapping: each tile sits at gap + col*(tileSize+gap) with a 2px gap
    // between tiles. Replicated edge pixels in the gap prevent linear filtering
    // from bleeding into adjacent tiles.
    const atlasSize = this.gridW * this.tileSize + (this.gridW + 1) * this._gap;
    const cellFrac = (this.tileSize + this._gap) / atlasSize;
    const gapFrac = this._gap / atlasSize;
    return {
      u: gapFrac + tile.col * cellFrac,
      v: 1.0 - (tile.row + 1) * cellFrac,
      size: this.tileSize / atlasSize,
    };
  }

  /**
   * Get the diffuse THREE.Texture (backward compat alias).
   */
  getTexture() {
    return this.diffuseTexture;
  }

  /**
   * Get the canvas for debug overlay rendering (backward compat alias).
   */
  getCanvas() {
    return this.diffuseCanvas;
  }

  /**
   * Get debug info array (backward compat alias for getDebugInfo()).
   */
  getDebugInfo() {
    return this.debugInfo;
  }

  /**
   * Build debug info for overlay rendering.
   */
  _buildDebugInfo() {
    this.debugInfo = [];
    for (const [blockIdStr, entry] of Object.entries(this.tileMap)) {
      const blockId = parseInt(blockIdStr);
      for (const [faceName, tile] of Object.entries(entry.tiles)) {
        this.debugInfo.push({
          blockId,
          faceName,
          col: tile.col,
          row: tile.row,
          label: `${blockId}_${faceName}`,
        });
      }
    }
  }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = PBRTextureAtlas;
}
