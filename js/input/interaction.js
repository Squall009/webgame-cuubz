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

// Debug logging — set CuubzLogger.DEBUG = true in browser console to enable.
//
// This file previously called a bare `_log(...)` that it never declared, silently
// borrowing whichever of the three colliding global `_log` declarations (client.js,
// host.js, game.js) happened to load last. Those were renamed on 2026-07-29
// (refactor.md §2.1 / PR 3), so this file now owns its logger explicitly — otherwise
// breaking or placing a block would throw ReferenceError.
var _interactionLog;
if (typeof CuubzLogger !== 'undefined') { _interactionLog = CuubzLogger.log; } else { _interactionLog = function() {}; }

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

    // Attack override flag — set by the game loop when a mob attack fires.
    // When true, block breaking is skipped this frame (mob attack takes priority).
    this._attackOverride = false;
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

    // Debug: log mouse state periodically (disabled)
    // if (this.mouse && this.mouse._debugFrame === undefined) this.mouse._debugFrame = 0;
    // if (this.mouse) this.mouse._debugFrame++;
    // if (this.mouse && this.mouse._debugFrame % 120 === 0) {
    //   console.log(`[BREAK_DEBUG] mouse.leftClick=${this.mouse.leftClick}, justClickedLeft=${this.mouse.justClickedLeft}, breakingBlock=${this.breakingBlock ? 'yes' : 'no'}`);
    // }

    // If a mob attack fired this frame, skip block breaking entirely.
    // This prevents simultaneously breaking a block behind a mob while attacking it.
    if (this._attackOverride) {
      this._attackOverride = false;
      // If we were mid-break, cancel it (mob moved in front of our block)
      if (this.breakingBlock) {
        this._cancelBreak();
      }
    } else if (isHoldingBreak) {
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
    // console.log('[BREAK] _startBreak called');
    const target = this._getTargetBlock();
    if (!target) {
      // console.log('[BREAK] No target block (raycast failed)');
      return;
    }

    const { blockPos, faceNormal, chunkX, chunkZ } = target;

    // Get chunk data
    const chunkData = this.chunkManager.getChunkData(chunkX, chunkZ);
    if (!chunkData) {
      // console.log(`[BREAK] No chunk data at (${chunkX},${chunkZ}) — chunk not in memoryCache`);
      return;
    }

    // Check distance to player
    const dx = blockPos.x - this.player.position.x;
    const dy = blockPos.y - this.player.position.y;
    const dz = blockPos.z - this.player.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist > this.breakRange) {
      // console.log(`[BREAK] Too far: dist=${dist.toFixed(1)} > ${this.breakRange}`);
      return;
    }

    // Get block type at position (convert to local coords)
    const lx = ((blockPos.x % 16) + 16) % 16;
    const lz = ((blockPos.z % 16) + 16) % 16;
    const blockType = chunkData.getBlock(lx, blockPos.y, lz);

    if ((blockType === BLOCK_TYPES.AIR || blockType === BLOCK_TYPES.CAVE_AIR) ||
        this.unbreakableBlocks.has(blockType)) {
      // console.log(`[BREAK] Block type ${blockType} is air/unbreakable`);
      return;
    }

    // Get block properties
    const props = BLOCK_PROPERTIES[blockType];
    if (!props) {
      // console.log(`[BREAK] No BLOCK_PROPERTIES for block type ${blockType}`);
      return;
    }
    if (props.hardness === -1) {
      // console.log(`[BREAK] Block type ${blockType} is unbreakable (hardness=-1)`);
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

    // Trigger swing animation callback (for first-person hand)
    if (this.onBreakStarted) {
      this.onBreakStarted();
    }

    // console.log(`[BREAK] Started breaking block ${blockType} at (${blockPos.x},${blockPos.y},${blockPos.z}) hardness=${hardness}`);

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

    // ─── Tool Efficiency ──────────────────────────────────
    // Check if the player is holding a tool that matches this block's required tool
    const blockProps = BLOCK_PROPERTIES[this.breakingBlock.blockType];
    const requiredTool = blockProps ? blockProps.tool : null;

    let miningSpeedMultiplier = 1.0;
    if (requiredTool && this.inventory) {
      const toolInfo = this.inventory.getToolInfo();
      if (toolInfo && toolInfo.toolType === requiredTool) {
        miningSpeedMultiplier = toolInfo.miningSpeed || 1.0;
        // console.log(`[TOOL] ✓ ${toolInfo.toolType} (${toolInfo.miningSpeed}x) mining ${this.breakingBlock.blockType} — multiplier=${miningSpeedMultiplier}`);
      } else {
        // console.log(`[TOOL] ✗ mismatch: block=${this.breakingBlock.blockType} required=${requiredTool}, held=${toolInfo?.toolType || 'none'} speed=${toolInfo?.miningSpeed || 'N/A'}`);
      }
    }

    // Progress break based on hardness and tool efficiency
    // Base break time = hardness * 1.5 seconds (dirt=0.75s, stone=4.5s, etc.)
    // Tool multiplier: wooden=2x, stone=4x, iron=6x, gold=12x, diamond=8x, netherite=10x
    const breakSpeed = (1 / (this.breakingBlock.hardness * 1.5)) * miningSpeedMultiplier;
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

    // Also mark adjacent chunks for mesh rebuild (newly exposed faces)
    this._markAdjacentChunksDirty(x, y, z, chunkX, chunkZ);

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

    _interactionLog('[BlockInteraction] Broke block ' + blockType + ' at (' + x + ', ' + y + ', ' + z + ')');

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
    if (placeX === px && (placeY === py || placeY === py + 1) && placeZ === pz) {
      return;
    }

    // Determine block type to place
    let finalPlaceType = this.selectedBlockType;

    // If inventory exists, use selected hotbar slot
    if (this.inventory) {
      const selectedItem = this.inventory.getSelectedItem();
      if (selectedItem && typeof selectedItem.typeId === 'number') {
        finalPlaceType = selectedItem.typeId;
      }
    }

    this._placeAt(placeX, placeY, placeZ, finalPlaceType);
  }

  /**
   * Place a block at the given world coordinates.
   * Handles chunk lookup, inventory consumption, and mesh rebuild.
   * @param {number} wx - World X
   * @param {number} wy - World Y
   * @param {number} wz - World Z
   * @param {number} placeType - Block type ID to place
   */
  _placeAt(wx, wy, wz, placeType) {
    // Check distance to player
    const dx = wx - this.player.position.x;
    const dy = wy - this.player.position.y;
    const dz = wz - this.player.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist > this.placeRange) return;

    // Find which chunk contains the placement position
    const targetChunkX = Math.floor(wx / 16);
    const targetChunkZ = Math.floor(wz / 16);

    // Get chunk data
    let chunkData = this.chunkManager.getChunkData(targetChunkX, targetChunkZ);
    if (!chunkData) return;

    // Convert to local coords
    const lx = ((wx % 16) + 16) % 16;
    const lz = ((wz % 16) + 16) % 16;

    // Don't overwrite non-air blocks (check both AIR and CAVE_AIR)
    const existingBlock = chunkData.getBlock(lx, wy, lz);
    if (existingBlock !== BLOCK_TYPES.AIR && existingBlock !== BLOCK_TYPES.CAVE_AIR) return;

    // Consume from inventory if available
    if (this.inventory && !this.player.creativeMode) {
      const consumed = this.inventory.consumeSelectedBlock();
      if (!consumed) return; // Can't place — no blocks in selected slot
    }

    // Place the block
    chunkData.setBlock(lx, wy, lz, placeType);

    // Mark chunk as dirty for saving
    this.chunkManager.markChunkDirty(targetChunkX, targetChunkZ);

    // Also mark adjacent chunks for mesh rebuild (face culling may change)
    this._markAdjacentChunksDirty(wx, wy, wz, targetChunkX, targetChunkZ);

    _interactionLog('[BlockInteraction] Placed block ' + placeType + ' at (' + wx + ', ' + wy + ', ' + wz + ')');

    // Multiplayer: track for network sync
    this._lastPlaced = { x: wx, y: wy, z: wz, blockType: placeType };
  }

  /**
   * Mark adjacent chunks for mesh rebuild when a block is placed/broken.
   * This ensures face culling is updated for neighboring chunks.
   */
  _markAdjacentChunksDirty(wx, wy, wz, cx, cz) {
    const lx = ((wx % 16) + 16) % 16;
    const lz = ((wz % 16) + 16) % 16;

    // Check each face — if on chunk boundary, mark neighbor chunk
    if (lx === 0) this.chunkManager.markChunkDirty(cx - 1, cz);
    if (lx === 15) this.chunkManager.markChunkDirty(cx + 1, cz);
    if (lz === 0) this.chunkManager.markChunkDirty(cx, cz - 1);
    if (lz === 15) this.chunkManager.markChunkDirty(cx, cz + 1);
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
