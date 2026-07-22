/**
 * Texture Atlas Builder — Fully Dynamic
 * 
 * Scans textures/ folder for PNG files matching the naming convention:
 *   BLOCKID_SIDENUM-basefilename.png
 * Examples: 1_0-grass_top.png, 1_1-grass_side.png, 2_0-dirt.png
 * 
 * Builds a lookup array indexed by block ID. Each entry tracks how many
 * side variants exist and their atlas positions. UV mapping is computed
 * dynamically from this data — no hardcoded mappings.
 * 
 * Adding a new texture: just drop the PNG in textures/ with the correct
 * naming convention. The next game load picks it up automatically.
 */

class TextureAtlas {
  constructor() {
    // Atlas canvas dimensions (will be computed based on actual texture count)
    this.canvas = null;
    this.context = null;
    this.threeTexture = null;
    this.loaded = false;

    // Tile size in pixels — read from first loaded texture, defaults to 32
    this.tileSize = 32;

    // Grid dimensions (tiles per row/col)
    this.gridW = 0;
    this.gridH = 0;
    this.totalTiles = 0;

    /**
     * sideMap[blockId] → { count, baseSlot, tiles: [{file, col, row}] }
     * 
     * Example for grass (block ID 1):
     *   { count: 2, baseSlot: 1, tiles: [
     *       { file: '1_0-grass_top.png', col: 1, row: 0 },
     *       { file: '1_1-grass_side.png', col: 2, row: 0 }
     *     ]}
     * 
     * Example for dirt (block ID 2):
     *   { count: 1, baseSlot: 3, tiles: [
     *       { file: '2_0-dirt.png', col: 3, row: 0 }
     *     ]}
     */
    this.sideMap = {};

    // Track which block IDs have textures (sparse array — air=0 and boss_spawn=26 are null)
    this.maxBlockId = 0;

    // Debug info for overlay rendering
    this.debugInfo = []; // [{blockId, col, row, label}]

    /**
     * nameToId maps texture base names to block IDs.
     * Populated dynamically during _discoverTextures() from manifest filenames.
     * Example: { 'grass_top': 1, 'grass_side': 1, 'dirt': 2 }
     */
    this.nameToId = {};

    /**
     * idToName maps block IDs to their primary texture base name for display.
     * Populated dynamically during _discoverTextures().
     * Example: { 1: 'grass', 2: 'dirt' }
     */
    this.idToName = {};
  }

  /**
   * Discover all texture files by scanning the textures/ directory.
   * Uses a manifest.json if present, otherwise tries known block ID ranges.
   * 
   * Returns an array of { fileId, sideNum, filename } sorted by fileId then sideNum.
   */
  _discoverTextures() {
    const discovered = [];

    // Try loading manifest first (preferred — explicit and fast)
    return fetch('textures/manifest.json')
      .then(r => r.ok ? r.json() : null)
      .catch(() => null)
      .then(manifest => {
        if (manifest && Array.isArray(manifest)) {
          // Manifest format: ["1_0-grass_top.png", "1_1-grass_side.png", ...]
          const parsed = [];
          for (const file of manifest) {
            const match = file.match(/^(\d+)_(\d+)-(.+)\.png$/);
            if (match) {
              const fileId = parseInt(match[1]);
              const sideNum = parseInt(match[2]);
              const baseName = match[3]; // e.g., 'grass_top', 'dirt'

              parsed.push({ fileId, sideNum, filename: file });

              // Build nameToId mapping (base name → block ID)
              this.nameToId[baseName] = fileId;

              // Build idToName mapping — use first texture's base name as primary
              if (!this.idToName[fileId]) {
                // Convert 'grass_top' → 'grass', 'coal_ore' → 'coal ore'
                const displayName = baseName.replace(/_/g, ' ');
                this.idToName[fileId] = displayName;
              }
            }
          }
          // Sort by block ID then side number
          parsed.sort((a, b) => a.fileId - b.fileId || a.sideNum - b.sideNum);
          return parsed;
        }
        // No manifest — fall back to scanning known block IDs
        return this._scanByBlockRange();
      });
  }

  /**
   * Fallback: try loading textures for block IDs 0-30, side numbers 0-5.
   * Stops at first failure per block ID. Fully dynamic — picks up any new files.
   */
  _scanByBlockRange() {
    const discovered = [];

    // Try each block ID from 0 to 50, side numbers 0-5
    for (let fileId = 0; fileId <= 50; fileId++) {
      let foundAny = false;
      for (let sideNum = 0; sideNum <= 5; sideNum++) {
        // Try common base names — if file exists, add it
        const candidates = this._getBaseNames(fileId);
        for (const base of candidates) {
          const filename = `${fileId}_${sideNum}-${base}.png`;
          if (this._textureExists(filename)) {
            discovered.push({ fileId, sideNum, filename });
            foundAny = true;
          }
        }
      }
    }

    // Sort by block ID then side number
    discovered.sort((a, b) => a.fileId - b.fileId || a.sideNum - b.sideNum);
    return discovered;
  }

  /**
   * Get possible base filenames for a given block ID.
   * Returns array of candidates to try when scanning.
   */
  _getBaseNames(fileId) {
    // Map known block IDs to their texture base names (VoxelGen + Cuubz IDs).
    const nameMap = {
      1: ['bedrock'],
      2: ['stone'],
      3: ['dirt'],
      4: ['grass_top', 'grass_side'],
      5: ['sand'],
      6: ['gravel'],
      7: ['water'],
      8: ['coal_ore'],
      9: ['iron_ore'],
      10: ['gold_ore'],
      11: ['diamond_ore'],
      13: ['snow'],
      14: ['snow_stone'],
      15: ['lava'],
      16: ['terracotta'],
      17: ['red_sand'],
      18: ['ice'],
      19: ['clay'],
      32: ['wood_log'],
      33: ['leaves'],
      34: ['planks'],
      35: ['obsidian'],
      36: ['blackstone'],
      37: ['toxic_slime'],
      38: ['corrupt_cry'],
      39: ['bed'],
      40: ['apple'],
      41: ['quest_key'],
      42: ['red_flower'],
      43: ['yellow_flower'],
      44: ['cave_torch'],
      45: ['glowstone'],
    };
    return nameMap[fileId] || [];
  }

  /**
   * Check if a texture file exists (without loading it).
   */
  _textureExists(filename) {
    // We can't truly check existence in browser without fetching.
    // Instead, we'll try to load and catch errors during buildAtlas().
    return true; // Always attempt — failures are caught during image load
  }

  /**
   * Build the atlas by loading all discovered texture PNGs.
   * Returns a Promise that resolves when all textures are loaded and baked.
   */
  async buildAtlas() {
    // console.log('[TextureAtlas] Discovering textures...');

    // Step 1: Discover all texture files
    const textures = await this._discoverTextures();
    // console.log(`[TextureAtlas] Found ${textures.length} texture files`);

    if (textures.length === 0) {
      console.warn('[TextureAtlas] No textures found! Atlas will be empty.');
      return this;
    }

    // Step 2: Group by block ID and build sideMap lookup array
    const grouped = {};
    for (const tex of textures) {
      if (!grouped[tex.fileId]) {
        grouped[tex.fileId] = [];
      }
      grouped[tex.fileId].push(tex);
      this.maxBlockId = Math.max(this.maxBlockId, tex.fileId);
    }

    // Assign sequential atlas slots to each block's side variants
    let slotIndex = 0;
    for (let fileId = 0; fileId <= this.maxBlockId; fileId++) {
      const sides = grouped[fileId] || [];
      if (sides.length === 0) continue;

      // Sort by side number within each block
      sides.sort((a, b) => a.sideNum - b.sideNum);

      this.sideMap[fileId] = {
        count: sides.length,
        baseSlot: slotIndex,
        tiles: [],
      };

      for (const side of sides) {
        // Index tiles array by sideNum so entry.tiles[0] = top, entry.tiles[1] = side, etc.
        this.sideMap[fileId].tiles[side.sideNum] = {
          fileId: side.fileId,
          sideNum: side.sideNum,
          filename: side.filename,
          atlasSlot: slotIndex,
        };
        slotIndex++;
      }
    }

    // Step 3: Calculate grid dimensions
    this.totalTiles = slotIndex;
    const minGridSize = Math.ceil(Math.sqrt(this.totalTiles));
    this.gridW = minGridSize;
    this.gridH = minGridSize; // Always square grid to keep horizontal and vertical UV ratios equal

    // console.log(`[TextureAtlas] ${this.maxBlockId + 1} block IDs, ${this.totalTiles} total tiles in a square ${this.gridW}x${this.gridH} grid`);

    // Step 4: Load all textures and build canvas
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.gridW * this.tileSize;
    this.canvas.height = this.gridH * this.tileSize;
    this.context = this.canvas.getContext('2d');

    // Fill with fallback color (dark grey)
    this.context.fillStyle = '#808080';
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height);

    const loadPromises = [];

    for (let fileId = 0; fileId <= this.maxBlockId; fileId++) {
      const entry = this.sideMap[fileId];
      if (!entry) continue;

      for (const tile of entry.tiles) {
        const promise = new Promise((resolve) => {
          const img = new Image();
          img.onload = () => {
            // Calculate grid position from atlas slot
            const col = tile.atlasSlot % this.gridW;
            const row = Math.floor(tile.atlasSlot / this.gridW);

            tile.col = col;
            tile.row = row;
            entry.tiles[tile.sideNum] = tile; // Update with computed positions

            // Draw to atlas canvas
            this.context.drawImage(img, col * this.tileSize, row * this.tileSize, this.tileSize, this.tileSize);

            // console.log(`[TextureAtlas] ${tile.filename} → blockID=${fileId}, slot=${tile.atlasSlot}, grid=(${col},${row})`);
            resolve();
          };
          img.onerror = () => {
            console.error(`[TextureAtlas] FAILED to load: textures/${tile.filename}`);
            // Still assign position (shows fallback color)
            const col = tile.atlasSlot % this.gridW;
            const row = Math.floor(tile.atlasSlot / this.gridW);
            tile.col = col;
            tile.row = row;
            resolve();
          };
          img.src = `textures/${tile.filename}`;
        });

        loadPromises.push(promise);
      }
    }

    await Promise.all(loadPromises);

    // Step 5: Build debug info for overlay rendering
    this._buildDebugInfo();

    // Step 6: Create THREE.Texture from canvas
    if (typeof THREE !== 'undefined') {
      this.threeTexture = new THREE.CanvasTexture(this.canvas);
      this.threeTexture.magFilter = THREE.NearestFilter;
      this.threeTexture.minFilter = THREE.NearestFilter;
      this.threeTexture.generateMipmaps = false;
      this.threeTexture.premultiplyAlpha = false;  // Preserve raw alpha for cutout rendering
    }

    this.loaded = true;
    // console.log(`[TextureAtlas] Atlas built: ${this.totalTiles} tiles, grid=${this.gridW}x${this.gridH}, tileSize=${this.tileSize}px`);
    return this;
  }

  /**
   * Build debug info for the overlay display.
   */
  _buildDebugInfo() {
    this.debugInfo = [];
    for (let fileId = 0; fileId <= this.maxBlockId; fileId++) {
      const entry = this.sideMap[fileId];
      if (!entry) continue;

      for (const tile of entry.tiles) {
        this.debugInfo.push({
          blockId: fileId,
          sideNum: tile.sideNum,
          col: tile.col,
          row: tile.row,
          filename: tile.filename,
          label: `${fileId}_${tile.sideNum}`,
        });
      }
    }
  }

  /**
   * Get UV coordinates for a block ID and face direction.
   * 
   * Accepts EITHER a numeric blockId OR a texture base name (string).
   * If a string is passed, it's looked up in the dynamic nameToId map.
   * 
   * Face name to side index mapping (dynamic — uses whatever sides exist):
   *   'top'       → side 0 (first texture)
   *   'bottom'    → last side (or side 0 if only one exists)
   *   'front','back','right','left' → side 1 if it exists, else side 0
   * 
   * This means:
   * - A block with 1 texture uses it for ALL faces
   * - Grass (2 textures): top=side0, sides=side1, bottom=last(=side1) or could be overridden
   * - Future blocks can add side 2+ and they're automatically available
   */
  getFaceUV(blockNameOrId, faceDirection) {
    // Resolve string name to numeric ID if needed
    let blockId;
    if (typeof blockNameOrId === 'string') {
      // Try direct lookup in nameToId first (e.g., 'grass_top' → 1)
      blockId = this.nameToId[blockNameOrId];
      // If not found, try matching against known base names for each side
      if (blockId === undefined) {
        console.warn(`[TextureAtlas] Unknown texture name "${blockNameOrId}", skipping UV mapping`);
        return { u: 0, v: 1.0, size: 0 };
      }
    } else {
      blockId = blockNameOrId;
    }

    const entry = this.sideMap[blockId];

    // No texture for this block (air, boss_spawn, etc.) → return transparent UV
    if (!entry || entry.count === 0) {
      return { u: 0, v: 1.0, size: 0 };
    }

    // Determine which side index to use based on face direction
    let sideIndex;
    switch (faceDirection) {
      case 'top':
        sideIndex = 0;
        break;
      case 'bottom':
        // Use last side if multiple exist, otherwise side 0
        sideIndex = entry.count > 1 ? entry.count - 1 : 0;
        break;
      case 'front':
      case 'back':
      case 'right':
      case 'left':
        // Use side 1 if it exists (for blocks with separate side textures), else side 0
        sideIndex = entry.count > 1 ? 1 : 0;
        break;
      default:
        sideIndex = 0;
    }

    // Clamp to valid range
    sideIndex = Math.max(0, Math.min(sideIndex, entry.count - 1));

    const tile = entry.tiles[sideIndex];
    if (!tile) {
      return { u: 0, v: 1.0, size: 1.0 / this.gridW };
    }

    // Calculate normalized UVs (WebGL coordinate system: Y flipped)
    const tileSizeFrac = 1.0 / this.gridW;
    return {
      u: tile.col * tileSizeFrac,
      v: 1.0 - (tile.row + 1) * tileSizeFrac, // Flip Y for WebGL
      size: tileSizeFrac,
      blockId: entry.baseSlot + sideIndex,
    };
  }

  /**
   * Get the THREE.Texture object for use in materials.
   */
  getTexture() {
    if (!this.threeTexture && this.loaded) {
      this.threeTexture = new THREE.CanvasTexture(this.canvas);
      this.threeTexture.magFilter = THREE.NearestFilter;
      this.threeTexture.minFilter = THREE.NearestFilter;
      this.threeTexture.generateMipmaps = false;
      this.threeTexture.premultiplyAlpha = false;  // Preserve raw alpha for cutout rendering
    }
    return this.threeTexture;
  }

  /**
   * Get the canvas element for debug overlay rendering.
   */
  getCanvas() {
    return this.canvas;
  }

  /**
   * Get sideMap lookup array (for debugging/inspection).
   */
  getSideMap() {
    return this.sideMap;
  }

  /**
   * Get idToName mapping for tooltip display.
   * Returns object like { 1: 'grass', 2: 'dirt', ... }
   */
  getIdToName() {
    return this.idToName;
  }

  /**
   * Get debug info for overlay rendering.
   */
  getDebugInfo() {
    return this.debugInfo;
  }
}

// Export for module systems
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TextureAtlas;
}
