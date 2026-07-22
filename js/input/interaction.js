/**
 * Cuubz — Block Interaction System
 * Progressive block breaking with crack overlay, block placing, and dropped items.
 * 
 * Breaking:
 *   - Hold left click to start breaking a block
 *   - Break progress based on block hardness (harder = slower)
 *   - Crack overlay shows damage stages (0-8)
 *   - On break complete: spawn dropped item at block position
 * 
 * Placing:
 *   - Right click to place selected block type
 */

class BlockInteraction {
  /**
   * @param {Object} options - Configuration
   * @param {VoxelRenderer} options.renderer - Voxel renderer with raycast() method
   * @param {ChunkManager} options.chunkManager - Chunk manager for updating chunks
   * @param {MouseInput} options.mouse - Mouse input handler
   * @param {Player} options.player - Player entity
   * @param {Inventory} [options.inventory] - Player inventory (optional)
   */
  constructor(options) {
    this.renderer = options.renderer;
    this.chunkManager = options.chunkManager;
    this.mouse = options.mouse;
    this.player = options.player;
    // Optional touch input for mobile break/place (set by main.js)
    this.touch = null;
    // Optional inventory for block drops
    this.inventory = options.inventory || null;

    // Interaction range (blocks)
    this.breakRange = 7;
    this.placeRange = 7;

    // Progressive breaking state
    this.breakingBlock = null; // { x, y, z, chunkX, chunkZ, blockType, hardness, faceNormal }
    this.breakProgress = 0;    // 0-1 float
    this.breakStartTime = 0;

    // Crack overlay
    this.crackOverlay = null;
    this.crackTexture = null;
    this.crackCanvas = null;
    this.crackCtx = null;

    // Block types that can be broken/placed
    this.unbreakableBlocks = new Set([
      BLOCK_TYPES.BEDROCK,    // 1
      BLOCK_TYPES.OBSIDIAN,   // 35
      BLOCK_TYPES.WATER,      // 7 — fluid, can't be broken
      BLOCK_TYPES.LAVA,       // 15 — fluid, can't be broken
    ]);

    // Selected block type for placing (from hotbar)
    this.selectedBlockType = 3; // Default: STONE

    // Multiplayer: track last block change for network sync (cleared by main.js after send)
    this._lastBroken = null;  // { x, y, z }
    this._lastPlaced = null;  // { x, y, z, blockType }
  }

  /**
   * Update interaction state each frame.
   * @param {number} delta - Time delta in seconds
   */
  update(delta) {
    if (!this.renderer) return;

    // ─── Block Breaking (Progressive) ────────────────────
    const isHoldingBreak = (this.mouse && this.mouse.leftClick) ||
                           (this.touch && this.touch.breakHeld);
    const justStartedBreak = (this.mouse && this.mouse.justClickedLeft) ||
                             (this.touch && this.touch.breakJustPressed);

    // Debug: log mouse state periodically
    if (this.mouse && this.mouse._debugFrame === undefined) this.mouse._debugFrame = 0;
    if (this.mouse) this.mouse._debugFrame++;
    if (this.mouse && this.mouse._debugFrame % 120 === 0) {
      console.log(`[BREAK_DEBUG] mouse.leftClick=${this.mouse.leftClick}, justClickedLeft=${this.mouse.justClickedLeft}, breakingBlock=${this.breakingBlock ? 'yes' : 'no'}`);
    }

    if (isHoldingBreak) {
      if (!this.breakingBlock) {
        // Try to start breaking — retry every frame while holding
        // (not just on click) so it works even if raycast fails initially
        this._startBreak();
      } else if (this.breakingBlock) {
        this._continueBreak(delta);
      }
    } else {
      // Released — cancel breaking
      if (this.breakingBlock) {
        this._cancelBreak();
      }
    }

    // ─── Block Placing ──────────────────────────────────
    const shouldPlace = (this.mouse && this.mouse.justClickedRight) ||
                        (this.touch && this.touch.placePressed);
    if (shouldPlace) {
      this._tryPlaceBlock();
    }
  }

  /**
   * Get the block position and face normal from raycast hit.
   * @returns {{ blockPos, faceNormal, chunkX, chunkZ } | null}
   */
  _getTargetBlock() {
    const hit = this.renderer.raycast(this.breakRange, this.chunkManager);
    if (!hit || !hit.point) {
      // Debug: log raycast failure
      if (!hit) {
        console.log('[BREAK] Raycast returned null (no hit)');
      } else {
        console.log('[BREAK] Raycast hit has no point:', hit);
      }
      return null;
    }

    const point = hit.point;
    const normal = hit.faceNormal;

    // Block position: step into the block from the hit point by half the face normal,
    // then floor. This works correctly for all 6 face directions (+/- X/Y/Z).
    const bx = Math.floor(point.x - (normal ? normal.x * 0.5 : 0));
    const by = Math.floor(point.y - (normal ? normal.y * 0.5 : 0));
    const bz = Math.floor(point.z - (normal ? normal.z * 0.5 : 0));

    // Chunk coordinates
    const chunkX = Math.floor(bx / 16);
    const chunkZ = Math.floor(bz / 16);

    return { blockPos: { x: bx, y: by, z: bz }, faceNormal: normal, chunkX, chunkZ };
  }

  /**
   * Start breaking a block.
   */
  _startBreak() {
    console.log('[BREAK] _startBreak called');
    const target = this._getTargetBlock();
    if (!target) {
      console.log('[BREAK] No target block (raycast failed)');
      return;
    }

    const { blockPos, faceNormal, chunkX, chunkZ } = target;

    // Get chunk data
    const chunkData = this.chunkManager.getChunkData(chunkX, chunkZ);
    if (!chunkData) {
      console.log(`[BREAK] No chunk data at (${chunkX},${chunkZ}) — chunk not in memoryCache`);
      return;
    }

    // Check distance to player
    const dx = blockPos.x - this.player.position.x;
    const dy = blockPos.y - this.player.position.y;
    const dz = blockPos.z - this.player.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist > this.breakRange) {
      console.log(`[BREAK] Too far: dist=${dist.toFixed(1)} > ${this.breakRange}`);
      return;
    }

    // Get block type at position (convert to local coords)
    const lx = ((blockPos.x % 16) + 16) % 16;
    const lz = ((blockPos.z % 16) + 16) % 16;
    const blockType = chunkData.getBlock(lx, blockPos.y, lz);

    if ((blockType === BLOCK_TYPES.AIR || blockType === BLOCK_TYPES.CAVE_AIR) ||
        this.unbreakableBlocks.has(blockType)) {
      console.log(`[BREAK] Block type ${blockType} is air/unbreakable`);
      return;
    }

    // Get block properties
    const props = BLOCK_PROPERTIES[blockType];
    if (!props) {
      console.log(`[BREAK] No BLOCK_PROPERTIES for block type ${blockType}`);
      return;
    }
    if (props.hardness === -1) {
      console.log(`[BREAK] Block type ${blockType} is unbreakable (hardness=-1)`);
      return;
    }

    const hardness = props.hardness || 1;

    // Start breaking
    this.breakingBlock = {
      x: blockPos.x, y: blockPos.y, z: blockPos.z,
      chunkX, chunkZ, blockType, hardness, faceNormal,
    };
    this.breakProgress = 0;
    this.breakStartTime = performance.now();

    console.log(`[BREAK] Started breaking block ${blockType} at (${blockPos.x},${blockPos.y},${blockPos.z}) hardness=${hardness}`);

    // Create crack overlay
    this._createCrackOverlay(blockPos.x, blockPos.y, blockPos.z, blockType);
  }

  /**
   * Continue breaking the current block.
   * @param {number} delta - Time delta in seconds
   */
  _continueBreak(delta) {
    if (!this.breakingBlock) return;

    // Check if still targeting the same block
    const target = this._getTargetBlock();
    if (!target) {
      this._cancelBreak();
      return;
    }

    const { blockPos } = target;
    if (blockPos.x !== this.breakingBlock.x ||
        blockPos.y !== this.breakingBlock.y ||
        blockPos.z !== this.breakingBlock.z) {
      // Switched to a different block — cancel and start new break
      this._cancelBreak();
      this._startBreak();
      return;
    }

    // Progress break based on hardness
    // Base break time = hardness * 1.5 seconds (dirt=0.75s, stone=4.5s, etc.)
    const breakSpeed = 1 / (this.breakingBlock.hardness * 1.5);
    this.breakProgress += breakSpeed * delta;

    // Update crack overlay
    const damageLevel = Math.min(8, Math.floor(this.breakProgress * 9));
    this._updateCrackOverlay(damageLevel);

    // Check if broken
    if (this.breakProgress >= 1) {
      this._completeBreak();
    }
  }

  /**
   * Complete breaking the current block.
   */
  _completeBreak() {
    const { x, y, z, chunkX, chunkZ, blockType } = this.breakingBlock;

    // Get chunk data and set block to air
    const chunkData = this.chunkManager.getChunkData(chunkX, chunkZ);
    if (chunkData) {
      const lx = ((x % 16) + 16) % 16;
      const lz = ((z % 16) + 16) % 16;
      chunkData.setBlock(lx, y, lz, BLOCK_TYPES.AIR);
    }

    // Mark chunk as dirty for saving
    this.chunkManager.markChunkDirty(chunkX, chunkZ);

    // Remove crack overlay
    this._removeCrackOverlay();

    // Determine what drops
    const dropType = this._getDropType(blockType);
    if (dropType !== null && dropType !== 0) {
      // Spawn dropped item at block position
      if (this.onBlockBroken) {
        this.onBlockBroken(dropType, { x, y, z });
      }
    }

    _log('[BlockInteraction] Broke block ' + blockType + ' at (' + x + ', ' + y + ', ' + z + ')');

    // Multiplayer: track for network sync
    this._lastBroken = { x, y, z };

    this.breakingBlock = null;
    this.breakProgress = 0;
  }

  /**
   * Cancel breaking the current block.
   */
  _cancelBreak() {
    this.breakingBlock = null;
    this.breakProgress = 0;
    this._removeCrackOverlay();
  }

  /**
   * Determine what item type drops from a block.
   * @param {number} blockType - The block type that was broken
   * @returns {number|string|null} The drop type ID, or null for no drop
   */
  _getDropType(blockType) {
    // Use BLOCK_PROPERTIES.drop if available (from inventory system)
    if (typeof _INLINE_BLOCK_PROPERTIES !== 'undefined') {
      const props = _INLINE_BLOCK_PROPERTIES[blockType];
      if (props) {
        if (props.drop !== null) return props.drop;
        if (props.mineable && props.drop) return props.drop;
      }
    }

    // Try window.BLOCK_PROPERTIES (browser context)
    if (typeof window !== 'undefined' && window.BLOCK_PROPERTIES) {
      const props = window.BLOCK_PROPERTIES[blockType];
      if (props && props.drop !== null) return props.drop;
    }

    // Default: most blocks drop themselves
    // Exceptions: grass drops dirt, unbreakable blocks drop nothing
    if (blockType === BLOCK_TYPES.GRASS) return BLOCK_TYPES.DIRT;
    if (blockType === BLOCK_TYPES.BEDROCK || blockType === BLOCK_TYPES.OBSIDIAN) return null;
    if (blockType === BLOCK_TYPES.WATER || blockType === BLOCK_TYPES.LAVA) return null;
    if (blockType === BLOCK_TYPES.AIR || blockType === BLOCK_TYPES.CAVE_AIR) return null;

    return blockType;
  }

  /**
   * Try to place a block on the targeted face.
   */
  _tryPlaceBlock() {
    const target = this._getTargetBlock();
    if (!target) return;

    const { blockPos, faceNormal } = target;

    if (!faceNormal) return;

    // Calculate placement position (adjacent to the face)
    const placeX = blockPos.x + Math.round(faceNormal.x);
    const placeY = blockPos.y + Math.round(faceNormal.y);
    const placeZ = blockPos.z + Math.round(faceNormal.z);

    // Check distance to player
    const dx = placeX - this.player.position.x;
    const dy = placeY - this.player.position.y;
    const dz = placeZ - this.player.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist > this.placeRange) return;

    // Don't place inside player
    const px = Math.floor(this.player.position.x);
    const py = Math.floor(this.player.position.y);
    const pz = Math.floor(this.player.position.z);
    if (placeX === px && (placeY === py || placeY === py + 1) && placeZ === pz) return;

    // Determine block type to place
    let placeType = this.selectedBlockType;

    // If inventory exists, use selected hotbar slot
    if (this.inventory) {
      const selectedItem = this.inventory.getSelectedItem();
      if (selectedItem && typeof selectedItem.typeId === 'number') {
        placeType = selectedItem.typeId;
      }
    }

    // Find which chunk contains the placement position
    const targetChunkX = Math.floor(placeX / 16);
    const targetChunkZ = Math.floor(placeZ / 16);

    // Get chunk data
    let chunkData = this.chunkManager.getChunkData(targetChunkX, targetChunkZ);
    if (!chunkData) return;

    // Convert to local coords
    const lx = ((placeX % 16) + 16) % 16;
    const lz = ((placeZ % 16) + 16) % 16;

    // Don't overwrite non-air blocks
    const existingBlock = chunkData.getBlock(lx, placeY, lz);
    if (existingBlock !== BLOCK_TYPES.AIR && existingBlock !== BLOCK_TYPES.CAVE_AIR) return;

    // Consume from inventory if available
    if (this.inventory && !this.player.creativeMode) {
      const consumed = this.inventory.consumeSelectedBlock();
      if (!consumed) return; // Can't place — no blocks in selected slot
    }

    // Place the block
    chunkData.setBlock(lx, placeY, lz, placeType);

    // Mark chunk as dirty for saving
    this.chunkManager.markChunkDirty(targetChunkX, targetChunkZ);

    _log('[BlockInteraction] Placed block ' + placeType + ' at (' + placeX + ', ' + placeY + ', ' + placeZ + ')');

    // Multiplayer: track for network sync
    this._lastPlaced = { x: placeX, y: placeY, z: placeZ, blockType: placeType };
  }

  // ─── Crack Overlay ────────────────────────────────────

  /**
   * Create a crack overlay at the block position.
   */
  _createCrackOverlay(x, y, z, blockType) {
    this._removeCrackOverlay();

    // Create canvas texture
    this.crackCanvas = document.createElement('canvas');
    this.crackCanvas.width = 64;
    this.crackCanvas.height = 64;
    this.crackCtx = this.crackCanvas.getContext('2d');
    this.crackTexture = new THREE.CanvasTexture(this.crackCanvas);

    // Create box geometry slightly larger than block
    const geometry = new THREE.BoxGeometry(1.02, 1.02, 1.02);
    const material = new THREE.MeshLambertMaterial({
      map: this.crackTexture,
      transparent: true,
      opacity: 0.75,
      depthWrite: false,
      side: THREE.FrontSide,
    });

    this.crackOverlay = new THREE.Mesh(geometry, material);
    this.crackOverlay.position.set(x + 0.5, y + 0.5, z + 0.5);

    // Add to scene
    if (this.renderer && this.renderer.scene) {
      this.renderer.scene.add(this.crackOverlay);
    }

    // Update texture to stage 0
    this._updateCrackOverlay(0);
  }

  /**
   * Update the crack overlay texture for a given damage level.
   * @param {number} damageLevel - 0-8 (9 stages)
   */
  _updateCrackOverlay(damageLevel) {
    if (!this.crackCtx || !this.crackTexture) return;

    const ctx = this.crackCtx;
    ctx.clearRect(0, 0, 64, 64);

    // Semi-transparent dark overlay
    ctx.fillStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.fillRect(0, 0, 64, 64);

    // Draw crack lines based on damage level
    const numCracks = damageLevel + 1;
    let seed = 42 + damageLevel * 1000;
    function rand() {
      seed = (seed * 16807) % 2147483647;
      return (seed - 1) / 2147483646;
    }

    ctx.strokeStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.lineWidth = Math.max(1, 2.5 - damageLevel * 0.2);
    ctx.lineCap = 'round';

    for (let i = 0; i < numCracks; i++) {
      let x = rand() * 64;
      let y = rand() * 64;
      ctx.beginPath();
      ctx.moveTo(x, y);
      const segments = 2 + Math.floor(rand() * (2 + damageLevel));
      for (let j = 0; j < segments; j++) {
        x += (rand() - 0.5) * 20;
        y += (rand() - 0.5) * 20;
        ctx.lineTo(x, y);
      }
      ctx.stroke();
    }

    this.crackTexture.needsUpdate = true;
  }

  /**
   * Remove the crack overlay.
   */
  _removeCrackOverlay() {
    if (this.crackOverlay) {
      if (this.renderer && this.renderer.scene) {
        this.renderer.scene.remove(this.crackOverlay);
      }
      this.crackOverlay.geometry.dispose();
      this.crackOverlay.material.dispose();
      if (this.crackTexture) this.crackTexture.dispose();
      this.crackOverlay = null;
      this.crackTexture = null;
      this.crackCanvas = null;
      this.crackCtx = null;
    }
  }

  /**
   * Set the selected block type for placing.
   * @param {number} blockType - Block type ID from BLOCK_TYPES
   */
  setSelectedBlockType(blockType) {
    this.selectedBlockType = blockType;
  }

  /**
   * Clean up resources.
   */
  dispose() {
    this._removeCrackOverlay();
    this.breakingBlock = null;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BlockInteraction;
}
