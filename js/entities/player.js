/**
 * Cuubz — Player Entity
 * Movement, physics, AABB collision against solid blocks.
 */

class Player {
  constructor() {
    // Position (world coordinates)
    this.position = { x: 0, y: 20, z: 0 };
    
    // Velocity
    this.velocity = { x: 0, y: 0, z: 0 };
    
    // Camera rotation
    this.yaw = 0;   // Horizontal rotation (radians)
    this.pitch = 0; // Vertical rotation (radians)
    
    // Player dimensions (block units)
    this.width = 0.8;
    this.height = 1.8;
    
    // Physics constants
    this.gravity = -25;      // blocks/s²
    this.jumpVelocity = 9;   // blocks/s
    this.moveSpeed = 5;      // blocks/s (walking)
    this.sprintMultiplier = 1.6;
    
    // State
    this.onGround = false;
    this.isSprinting = false;
    
    // Inventory reference (set by game.js)
    this.inventory = null;
  }

  /**
   * Update player physics and movement
   */
  update(deltaTime, inputState, world) {
    // Apply gravity
    this.velocity.y += this.gravity * deltaTime;
    
    // Get movement direction from camera yaw
    const moveX = Math.sin(this.yaw);
    const moveZ = Math.cos(this.yaw);
    const sideX = Math.cos(this.yaw);
    const sideZ = -Math.sin(this.yaw);
    
    // Calculate movement speed
    let speed = this.moveSpeed;
    if (this.isSprinting) speed *= this.sprintMultiplier;
    
    // Apply input-based movement
    let dx = 0, dz = 0;
    
    if (inputState.forward) { dx += moveX; dz += moveZ; }
    if (inputState.backward) { dx -= moveX; dz -= moveZ; }
    if (inputState.left) { dx -= sideX; dz -= sideZ; }
    if (inputState.right) { dx += sideX; dz += sideZ; }
    
    // Normalize diagonal movement
    const mag = Math.sqrt(dx * dx + dz * dz);
    if (mag > 0) {
      dx = (dx / mag) * speed;
      dz = (dz / mag) * speed;
    }
    
    this.velocity.x = dx;
    this.velocity.z = dz;
    
    // Handle jump
    if (inputState.jump && this.onGround) {
      this.velocity.y = this.jumpVelocity;
      this.onGround = false;
    }
    
    // Apply movement with collision detection
    this._moveWithCollision(deltaTime, world);
    
    // Clamp to world bounds
    this.position.y = Math.max(-32, this.position.y);
  }

  /**
   * Move player with AABB collision detection against solid blocks
   */
  _moveWithCollision(deltaTime, world) {
    if (!world) {
      // No world — just apply velocity directly (for testing)
      this.position.x += this.velocity.x * deltaTime;
      this.position.y += this.velocity.y * deltaTime;
      this.position.z += this.velocity.z * deltaTime;
      return;
    }
    
    // Move in X axis with collision
    const newX = this.position.x + this.velocity.x * deltaTime;
    if (!this._checkCollision(newX, this.position.y, this.position.z, world)) {
      this.position.x = newX;
    } else {
      this.velocity.x = 0;
    }

    // Move in Y axis with collision
    const newY = this.position.y + this.velocity.y * deltaTime;
    if (!this._checkCollision(this.position.x, newY, this.position.z, world)) {
      this.position.y = newY;
      this.onGround = false;
    } else {
      if (this.velocity.y < 0) {
        // Landing on ground
        this.onGround = true;
        
        // Snap to block boundary
        this.position.y = Math.ceil(this.position.y);
      }
      this.velocity.y = 0;
    }
    
    // Move in Z axis with collision
    const newZ = this.position.z + this.velocity.z * deltaTime;
    if (!this._checkCollision(this.position.x, this.position.y, newZ, world)) {
      this.position.z = newZ;
    } else {
      this.velocity.z = 0;
    }
  }

  /**
   * Check AABB collision at a position against world blocks
   */
  _checkCollision(x, y, z, world) {
    if (!world) return false;
    
    const halfWidth = this.width / 2;
    const feetY = y;
    const headY = y + this.height;
    
    // Check all blocks in player's AABB
    const minX = Math.floor(x - halfWidth);
    const maxX = Math.floor(x + halfWidth);
    const minY = Math.floor(feetY);
    const maxY = Math.floor(headY);
    const minZ = Math.floor(z - halfWidth);
    const maxZ = Math.floor(z + halfWidth);
    
    for (let bx = minX; bx <= maxX; bx++) {
      for (let by = minY; by < maxY; by++) {
        for (let bz = minZ; bz <= maxZ; bz++) {
          const block = world.getBlockAtWorld(bx, by, bz);
          if (block && this._isSolid(block)) {
            return true;
          }
        }
      }
    }
    
    return false;
  }

  /**
   * Check if a block type is solid for collision purposes
   */
  _isSolid(blockType) {
    // Import from chunkData when available
    const solidTypes = [1, 2, 3, 4, 5, 7, 9, 10, 11, 12, 13, 14, 16, 18, 19, 20, 21, 22, 23, 25];
    return solidTypes.includes(blockType);
  }

  /**
   * Get player eye position (for camera)
   */
  getEyePosition() {
    return {
      x: this.position.x,
      y: this.position.y + 1.6, // Eye height
      z: this.position.z,
    };
  }

  /**
   * Reset player to spawn position
   */
  respawn(spawnPoint) {
    this.position = {
      x: spawnPoint ? spawnPoint.x : 0,
      y: spawnPoint ? spawnPoint.y : 20,
      z: spawnPoint ? spawnPoint.z : 0,
    };
    this.velocity = { x: 0, y: 0, z: 0 };
  }
}

module.exports = Player;
