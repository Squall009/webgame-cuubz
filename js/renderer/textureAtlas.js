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

    // 2b. Collect overlay texture bases (need separate atlas slots for compositing)
    const overlayBases = new Set();
    for (const block of manifest) {
      if (block.overlay) {
        for (const overlayName of Object.values(block.overlay)) {
          overlayBases.add(overlayName);
        }
      }
    }

    // 2c. Collect color variant definitions — blocks with color multipliers need unique slots.
    // Key: "baseName:colorKey" → { base, color, blockId, face }
    const colorVariantDefs = new Map();
    for (const block of manifest) {
      if (!block.color) continue;
      const colorKey = block.color.join(',');
      for (const [face, entry] of Object.entries(block.textures)) {
        if (!entry.exists) continue;
        const variantKey = `${entry.base}:${face}:${colorKey}`;
        colorVariantDefs.set(variantKey, { base: entry.base, color: block.color, blockId: block.id, face });
      }
    }

    // Total atlas slots needed
    const totalSlots = textureBases.size + overlayBases.size + colorVariantDefs.size;

    if (totalSlots === 0) {
      console.warn('[PBRTextureAtlas] No textures found in manifest');
      return this;
    }

    // 3. Calculate grid size — always square
    const gridSize = Math.ceil(Math.sqrt(totalSlots));
    this.gridW = gridSize;
    this.gridH = gridSize;

    // 2px gap between tiles so edge replication doesn't overwrite adjacent tiles.
    this._gap = 2;
    const canvasSize = gridSize * this.tileSize + (gridSize + 1) * this._gap;
    console.log(`[PBRTextureAtlas] ${textureBases.size} base + ${overlayBases.size} overlay + ${colorVariantDefs.size} color variant textures → ${totalSlots} slots, ${gridSize}×${gridSize} grid, ${canvasSize}×${canvasSize} px atlas (2px gaps, ${canvasSize} ≤ 4096: ${canvasSize <= 4096})`);

    // 4. Create 3 canvases
    this.diffuseCanvas = this._createCanvas(canvasSize);
    this.normalCanvas = this._createCanvas(canvasSize);
    this.smoothnessCanvas = this._createCanvas(canvasSize);

    // 5. Assign grid slots and load all textures
    const baseToSlot = {}; // texture base name → { col, row }
    const colorSlotMap = {}; // variantKey → { col, row }
    let slotIndex = 0;

    const loadPromises = [];

    // 5a. Load base textures
    for (const [base] of textureBases) {
      const col = slotIndex % gridSize;
      const row = Math.floor(slotIndex / gridSize);
      baseToSlot[base] = { col, row };
      loadPromises.push(this._loadTriple(base, col, row));
      slotIndex++;
    }

    // 5b. Load overlay textures (get their own slots for compositing)
    for (const base of overlayBases) {
      const col = slotIndex % gridSize;
      const row = Math.floor(slotIndex / gridSize);
      baseToSlot[base] = { col, row };
      loadPromises.push(this._loadTriple(base, col, row));
      slotIndex++;
    }

    // 5c. Load color variant textures (copy of base + color multiplier applied)
    for (const [variantKey, variant] of colorVariantDefs) {
      const col = slotIndex % gridSize;
      const row = Math.floor(slotIndex / gridSize);
      colorSlotMap[variantKey] = { col, row };
      loadPromises.push(this._loadTripleColored(variant.base, col, row, variant.color));
      slotIndex++;
    }

    await Promise.all(loadPromises);

    // 6. Build tileMap from manifest + baseToSlot + color variants
    for (const block of manifest) {
      const tiles = {};
      const colorKey = block.color ? block.color.join(',') : null;

      for (const [face, entry] of Object.entries(block.textures)) {
        // If this block has a color multiplier, use its color variant slot
        if (colorKey && entry.exists) {
          const variantKey = `${entry.base}:${face}:${colorKey}`;
          const variantSlot = colorSlotMap[variantKey];
          if (variantSlot) {
            tiles[face] = { col: variantSlot.col, row: variantSlot.row };
            continue;
          }
        }
        // Fall back to base slot
        if (entry.exists) {
          const slot = baseToSlot[entry.base];
          if (slot) {
            tiles[face] = { col: slot.col, row: slot.row };
          }
        }
      }

      // 6b. Apply overlay compositing for blocks with overlay definitions
      if (block.overlay) {
        for (const [face, overlayName] of Object.entries(block.overlay)) {
          const overlaySlot = baseToSlot[overlayName];
          const targetSlot = tiles[face];
          if (overlaySlot && targetSlot) {
            this._compositeOverlay(targetSlot, overlaySlot);
          }
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
    console.log(`[PBRTextureAtlas] Atlas built: ${totalSlots} tiles, ${Object.keys(this.tileMap).length} block mappings`);
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
   * Load a texture and apply an RGB color multiplier to the diffuse channel.
   * Used for blocks like tinted flowers that share a base texture but need different colors.
   * Normal and smoothness maps are loaded as-is (no color modification).
   */
  async _loadTripleColored(base, col, row, color) {
    const x = this._gap + col * (this.tileSize + this._gap);
    const y = this._gap + row * (this.tileSize + this._gap);

    try {
      // Load diffuse with color multiplier
      await this._loadImageColored(`textures/blocks/${base}.png`, this.diffuseCanvas, x, y, color);
      // Load normal map (unchanged)
      await this._loadImage(`textures/blocks/${base}_n.png`, this.normalCanvas, x, y);
      // Load smoothness map (unchanged)
      await this._loadImage(`textures/blocks/${base}_s.png`, this.smoothnessCanvas, x, y);
    } catch (e) {
      console.error(`[PBRTextureAtlas] Failed to load colored ${base}:`, e.message);
    }
  }

  /**
   * Composite an overlay texture onto a target tile using alpha blending.
   * The overlay tile is alpha-blended over the target tile in the diffuse atlas.
   * For normal/smoothness atlases, the overlay replaces the target where alpha > 0.
   */
  _compositeOverlay(targetSlot, overlaySlot) {
    const tx = this._gap + targetSlot.col * (this.tileSize + this._gap);
    const ty = this._gap + targetSlot.row * (this.tileSize + this._gap);
    const ox = this._gap + overlaySlot.col * (this.tileSize + this._gap);
    const oy = this._gap + overlaySlot.row * (this.tileSize + this._gap);
    const size = this.tileSize;

    // Get pixel data from both tiles
    const targetDiffuse = this.diffuseCanvas.getContext('2d').getImageData(tx, ty, size, size);
    const overlayDiffuse = this.diffuseCanvas.getContext('2d').getImageData(ox, oy, size, size);

    // Alpha-composite overlay onto target (diffuse)
    for (let i = 0; i < targetDiffuse.data.length; i += 4) {
      const overlayAlpha = overlayDiffuse.data[i + 3] / 255;
      if (overlayAlpha > 0) {
        const targetAlpha = targetDiffuse.data[i + 3] / 255;
        // Standard alpha compositing: result = overlay * overlayAlpha + target * (1 - overlayAlpha)
        targetDiffuse.data[i]     = overlayDiffuse.data[i]     * overlayAlpha + targetDiffuse.data[i]     * (1 - overlayAlpha * targetAlpha);
        targetDiffuse.data[i + 1] = overlayDiffuse.data[i + 1] * overlayAlpha + targetDiffuse.data[i + 1] * (1 - overlayAlpha * targetAlpha);
        targetDiffuse.data[i + 2] = overlayDiffuse.data[i + 2] * overlayAlpha + targetDiffuse.data[i + 2] * (1 - overlayAlpha * targetAlpha);
        targetDiffuse.data[i + 3] = Math.min(255, (overlayAlpha + targetAlpha * (1 - overlayAlpha)) * 255);
      }
    }
    this.diffuseCanvas.getContext('2d').putImageData(targetDiffuse, tx, ty);

    // For normal map: blend overlay normal where overlay has alpha
    const targetNormal = this.normalCanvas.getContext('2d').getImageData(tx, ty, size, size);
    const overlayNormal = this.normalCanvas.getContext('2d').getImageData(ox, oy, size, size);
    for (let i = 0; i < targetNormal.data.length; i += 4) {
      const overlayAlpha = overlayNormal.data[i + 3] / 255;
      if (overlayAlpha > 0.5) {
        targetNormal.data[i]     = overlayNormal.data[i];
        targetNormal.data[i + 1] = overlayNormal.data[i + 1];
        targetNormal.data[i + 2] = overlayNormal.data[i + 2];
      }
    }
    this.normalCanvas.getContext('2d').putImageData(targetNormal, tx, ty);

    // For smoothness: blend overlay smoothness where overlay has alpha
    const targetSmooth = this.smoothnessCanvas.getContext('2d').getImageData(tx, ty, size, size);
    const overlaySmooth = this.smoothnessCanvas.getContext('2d').getImageData(ox, oy, size, size);
    for (let i = 0; i < targetSmooth.data.length; i += 4) {
      const overlayAlpha = overlaySmooth.data[i + 3] / 255;
      if (overlayAlpha > 0.5) {
        targetSmooth.data[i]     = overlaySmooth.data[i];
        targetSmooth.data[i + 1] = overlaySmooth.data[i + 1];
        targetSmooth.data[i + 2] = overlaySmooth.data[i + 2];
      }
    }
    this.smoothnessCanvas.getContext('2d').putImageData(targetSmooth, tx, ty);
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
   * Load a single image, apply an RGB color multiplier, and draw it onto a canvas.
   * color: [r, g, b] array with values 0-1. Each pixel's RGB is multiplied by the color.
   * Alpha channel is preserved unchanged.
   */
  _loadImageColored(url, canvas, x, y, color) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        // Draw the image first
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, x, y, this.tileSize, this.tileSize);

        // Apply color multiplier to the loaded pixels
        const imageData = ctx.getImageData(x, y, this.tileSize, this.tileSize);
        const data = imageData.data;
        const [cr, cg, cb] = color;

        for (let i = 0; i < data.length; i += 4) {
          // Only modify pixels that have alpha (skip fully transparent)
          if (data[i + 3] > 0) {
            data[i]     = Math.min(255, data[i]     * cr);
            data[i + 1] = Math.min(255, data[i + 1] * cg);
            data[i + 2] = Math.min(255, data[i + 2] * cb);
            // Alpha unchanged
          }
        }
        ctx.putImageData(imageData, x, y);

        // Replicate edge pixels to prevent atlas tile bleeding
        this._replicateEdges(ctx, x, y, this.tileSize);
        resolve();
      };
      img.onerror = () => {
        // Fill with fallback color
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = `rgb(${Math.floor(100 * color[0])}, ${Math.floor(100 * color[1])}, ${Math.floor(100 * color[2])})`;
        ctx.fillRect(x, y, this.tileSize, this.tileSize);
        resolve();
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
