/**
 * Cuubz — Block Interaction System
 * Handles block breaking and placing via mouse input + raycasting.
 */

class BlockInteraction {
  /**
   * @param {Object} options - Configuration
   * @param {VoxelRenderer} options.renderer - Voxel renderer with raycast() method
   * @param {ChunkManager} options.chunkManager - Chunk manager for updating chunks
   * @param {MouseInput} options.mouse - Mouse input handler
   * @param {Player} options.player - Player entity
   */
  constructor(options) {
    this.renderer = options.renderer;
    this.chunkManager = options.chunkManager;
    this.mouse = options.mouse;
    this.player = options.player;
    // Optional touch input for mobile break/place (set by main.js)
    this.touch = null;

    // Interaction range (blocks)
    this.breakRange = 7;
    this.placeRange = 7;

    // Break animation state
    this.breakProgress = 0;
    this.breakingBlock = null; // { blockPos, faceNormal }

    // Block types that can be broken/placed
    this.unbreakableBlocks = new Set([11]); // BEDROCK is unbreakable (id=11)

    // Selected block type for placing (from hotbar)
    this.selectedBlockType = 3; // Default: STONE
  }

  /**
   * Update interaction state each frame.
   * @param {number} delta - Time delta in seconds
   */
  update(delta) {
    if (!this.renderer) return;

    // Handle block breaking on left click (mouse) or break button held (touch)
    const shouldBreak = this.mouse && this.mouse.justLeftClicked || 
                        (this.touch && this.touch.breakPressed);
    if (shouldBreak) {
      this._tryBreakBlock();
    }

    // Handle block placing on right click (mouse) or place button held (touch)
    const shouldPlace = this.mouse && this.mouse.justRightClicked || 
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
    const hit = this.renderer.raycast(this.breakRange);
    if (!hit || !hit.point) return null;

    // Calculate world position of the block face
    const point = hit.point;
    const normal = hit.faceNormal;

    // Block position is the integer coordinates of the block being targeted
    const bx = Math.floor(point.x - (normal ? normal.x * 0.5 : 0));
    const by = Math.floor(point.y - (normal ? normal.y * 0.5 : 0));
    const bz = Math.floor(point.z - (normal ? normal.z * 0.5 : 0));

    // Chunk coordinates
    const chunkX = Math.floor(bx / 16);
    const chunkZ = Math.floor(bz / 16);

    return { blockPos: { x: bx, y: by, z: bz }, faceNormal: normal, chunkX, chunkZ };
  }

  /**
   * Try to break the targeted block.
   */
  _tryBreakBlock() {
    const target = this._getTargetBlock();
    if (!target) return;

    const { blockPos, chunkX, chunkZ } = target;

    // Get chunk data
    const chunkData = this.chunkManager.getChunkData(chunkX, chunkZ);
    if (!chunkData) return;

    // Check distance to player
    const dx = blockPos.x - this.player.position.x;
    const dy = blockPos.y - this.player.position.y;
    const dz = blockPos.z - this.player.position.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (dist > this.breakRange) return;

    // Get block type at position
    const blockType = chunkData.getBlock(blockPos.x, blockPos.y, blockPos.z);
    if (blockType === 0 || this.unbreakableBlocks.has(blockType)) return;

    // Break the block (set to AIR)
    chunkData.setBlock(blockPos.x, blockPos.y, blockPos.z, 0);

    // Mark chunk as dirty for saving
    this.chunkManager.markChunkDirty(chunkX, chunkZ);

    // Rebuild chunk mesh
    this._rebuildChunk(chunkX, chunkZ);

    _log(`[BlockInteraction] Broke block ${blockType} at (${blockPos.x}, ${blockPos.y}, ${blockPos.z})`);
  }

  /**
   * Try to place a block on the targeted face.
   */
  _tryPlaceBlock() {
    const target = this._getTargetBlock();
    if (!target) return;

    const { blockPos, faceNormal, chunkX, chunkZ } = target;

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

    // Find which chunk contains the placement position
    const targetChunkX = Math.floor(placeX / 16);
    const targetChunkZ = Math.floor(placeZ / 16);

    // Get or generate chunk data for target chunk
    let chunkData = this.chunkManager.getChunkData(targetChunkX, targetChunkZ);
    if (!chunkData) {
      // Chunk not loaded yet — skip placing
      return;
    }

    // Place the block
    chunkData.setBlock(placeX, placeY, placeZ, this.selectedBlockType);

    // Mark chunk as dirty for saving
    this.chunkManager.markChunkDirty(targetChunkX, targetChunkZ);

    // Rebuild chunk mesh
    this._rebuildChunk(targetChunkX, targetChunkZ);

    _log(`[BlockInteraction] Placed block ${this.selectedBlockType} at (${placeX}, ${placeY}, ${placeZ})`);
  }

  /**
   * Rebuild a chunk's mesh after block changes.
   */
  _rebuildChunk(cx, cz) {
    const key = `${cx},${cz}`;
    const entry = this.chunkManager.loadedChunks.get(key);
    if (!entry || !entry.data) return;

    // Remove old meshes from scene
    if (entry.mesh) {
      if (this.renderer.chunkGroup) {
        this.renderer.chunkGroup.remove(entry.mesh);
      }
      if (entry.mesh.geometry) entry.mesh.geometry.dispose();
      if (entry.mesh.material) entry.mesh.material.dispose();
    }

    if (entry.transMesh) {
      if (this.renderer.chunkGroup) {
        this.renderer.chunkGroup.remove(entry.transMesh);
      }
      if (entry.transMesh.geometry) entry.transMesh.geometry.dispose();
      if (entry.transMesh.material) entry.transMesh.material.dispose();
    }

    // Rebuild meshes
    const chunkData = entry.data;
    const meshBuilder = new ChunkMeshBuilder();
    const meshData = meshBuilder.buildMeshData(chunkData, this.chunkManager.textureAtlas);
    let solidMesh = null;
    let transMesh = null;

    if (meshData.indices.length > 0 || (meshData.transparentIndices && meshData.transparentIndices.length > 0)) {
      const geoResult = meshBuilder.buildThreeGeometry(meshData, chunkData);

      // Solid mesh
      if (geoResult.solidGeometry) {
        let material;
        if (this.chunkManager.textureAtlas && this.chunkManager.textureAtlas.loaded) {
          material = new THREE.MeshLambertMaterial({
            map: this.chunkManager.textureAtlas.getTexture(),
            fog: true
          });
        } else {
          material = new THREE.MeshLambertMaterial({
            color: 0x8B7355,
            fog: true
          });
        }

        solidMesh = new THREE.Mesh(geoResult.solidGeometry, material);
        solidMesh.position.set(cx * 16, 0, cz * 16);
        if (this.renderer.chunkGroup) {
          this.renderer.chunkGroup.add(solidMesh);
        }
      }

      // Transparent mesh
      if (geoResult.transparentGeometry) {
        const transMaterial = new THREE.MeshLambertMaterial({
          map: this.chunkManager.textureAtlas ? this.chunkManager.textureAtlas.getTexture() : null,
          transparent: true,
          opacity: 0.6,
          depthWrite: false,
          fog: true
        });

        transMesh = new THREE.Mesh(geoResult.transparentGeometry, transMaterial);
        transMesh.position.set(cx * 16, 0, cz * 16);
        if (this.renderer.chunkGroup) {
          this.renderer.chunkGroup.add(transMesh);
        }
      }
    }

    // Update entry
    entry.mesh = solidMesh;
    entry.transMesh = transMesh;
    entry.built = !!(solidMesh || transMesh);
  }

  /**
   * Set the selected block type for placing.
   * @param {number} blockType - Block type ID from BLOCK_TYPES
   */
  setSelectedBlockType(blockType) {
    this.selectedBlockType = blockType;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = BlockInteraction;
}
