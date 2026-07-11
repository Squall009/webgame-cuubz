/**
 * Cuubz — Player Entity
 * Movement, physics, AABB collision against solid blocks.
 *
 * Uses axis-separated AABB resolution (X → Y → Z) to prevent corner catching.
 * Includes step-up mechanic for smooth stair climbing.
 *
 * Creative mode fly:
 *   - Double-tap Space (within 300ms) to toggle fly on/off
 *   - Hold Space to ascend, hold Shift to descend
 *   - Only available in creative mode
 */

class Player {
  constructor() {
    // Position (world coordinates) — feet bottom center
    this.position = { x: 0, y: 20, z: 0 };

    // Velocity
    this.velocity = { x: 0, y: 0, z: 0 };

    // Camera rotation
    this.yaw = 0;   // Horizontal rotation (radians)
    this.pitch = 0; // Vertical rotation (radians)

    // Player dimensions (block units) — standard Minecraft ~0.6w × 1.8h
    this.width = 0.6;
    this.height = 1.8;

    // Physics constants
    this.gravity = -25;       // blocks/s²
    this.jumpVelocity = 9;    // blocks/s
    this.moveSpeed = 5;       // blocks/s (walking)
    this.sprintMultiplier = 1.6;
    this.maxFallSpeed = 40;   // Terminal velocity

    // Creative mode physics
    this.gravityEnabled = true;
    this.flyMode = false;
    this.flySpeed = 8;

    // State
    this.onGround = false;
    this.inWater = false;
    this.isSprinting = false;

    // Fly mode double-tap detection (creative only)
    this._lastJumpDown = 0;   // performance.now() of last jump press edge
    this.doubleTapThreshold = 300; // ms between two jump presses to toggle fly

    // Step-up height for smooth stair climbing
    this.stepHeight = 0.5;

    // Inventory reference (set by game.js)
    this.inventory = null;

    // World manager reference (set via linkWorld)
    this.worldManager = null;
  }

  /**
   * Link the world manager so player methods can access block data without
   * being passed it every frame. Called once during game initialization.
   */
  linkWorld(worldManager) {
    this.worldManager = worldManager;
  }

  setCreativeMode(creative) {
    if (creative) {
      this.gravityEnabled = false;
      this.flySpeed = 8;
    } else {
      this.gravityEnabled = true;
      this.flyMode = false;
      this._lastJumpDown = 0;
    }
  }

  get isFlying() {
    return this.flyMode && !this.gravityEnabled;
  }

  update(deltaTime, inputState, world) {
    // Clamp delta to prevent tunneling at low FPS
    deltaTime = Math.min(deltaTime, 0.1);

    // Apply gravity (survival mode, not flying)
    if (this.gravityEnabled && !this.flyMode) {
      this.velocity.y += this.gravity * deltaTime;
      if (this.velocity.y < -this.maxFallSpeed) {
        this.velocity.y = -this.maxFallSpeed;
      }
    }

    // Fly mode vertical movement (creative only)
    if (this.flyMode && !this.gravityEnabled) {
      if (inputState.jumpHeld) {
        this.velocity.y = this.flySpeed;
      } else if (inputState.sneak) {
        this.velocity.y = -this.flySpeed;
      } else {
        this.velocity.y *= 0.9;
        if (Math.abs(this.velocity.y) < 0.1) this.velocity.y = 0;
      }
    }

    // Movement direction from camera yaw.
    // Three.js Euler 'YXZ': forward = (-sin(yaw), 0, -cos(yaw)), right = (cos(yaw), 0, -sin(yaw))
    const moveX = -Math.sin(this.yaw);
    const moveZ = -Math.cos(this.yaw);
    const sideX =  Math.cos(this.yaw);
    const sideZ = -Math.sin(this.yaw);

    let speed = this.moveSpeed;
    if (!this.gravityEnabled) speed *= 1.5;
    if (this.isSprinting) speed *= this.sprintMultiplier;

    // Reset horizontal velocity every frame — prevents stale yaw direction bleeding
    this.velocity.x = 0;
    this.velocity.z = 0;

    let dx = 0, dz = 0;
    if (inputState.forward)  { dx += moveX; dz += moveZ; }
    if (inputState.backward) { dx -= moveX; dz -= moveZ; }
    if (inputState.left)     { dx -= sideX; dz -= sideZ; }
    if (inputState.right)    { dx += sideX; dz += sideZ; }

    const mag = Math.sqrt(dx * dx + dz * dz);
    if (mag > 0) {
      dx = (dx / mag) * speed;
      dz = (dz / mag) * speed;
    }

    this.velocity.x = dx;
    this.velocity.z = dz;

    // Jump / fly toggle — uses edge-detected input (fires once per press)
    if (inputState.jumpDown) {
      const now = performance.now();

      if (!this.gravityEnabled) {
        // Creative mode: double-tap Space to toggle fly on/off
        if (this.flyMode && (now - this._lastJumpDown) <= this.doubleTapThreshold) {
          // Second tap — deactivate fly
          console.log('[Cuubz] ⬇️ FLY MODE DEACTIVATED');
          this.flyMode = false;
          this.gravityEnabled = true;
          this.velocity.y = 0;
        } else if (!this.flyMode && (now - this._lastJumpDown) <= this.doubleTapThreshold) {
          // Second tap — activate fly
          console.log('[Cuubz] 🚀 FLY MODE ACTIVATED — hold Space to ascend, Shift to descend');
          this.flyMode = true;
          this.gravityEnabled = false;
          this.velocity.y = this.jumpVelocity * 0.8;
        } else if (!this.flyMode && this.onGround) {
          // Single tap on ground — normal jump (creative without fly)
          this.velocity.y = this.jumpVelocity;
          this.onGround = false;
        }
        this._lastJumpDown = now;
      } else {
        // Survival mode: single jump from ground only
        if (this.onGround) {
          this.velocity.y = this.jumpVelocity;
          this.onGround = false;
        }
      }
    }

    this._moveAndCollide(deltaTime, world);

    // Clamp to world floor
    this.position.y = Math.max(MIN_Y, this.position.y);
  }

  /**
   * Axis-separated AABB move and collide.
   * Resolves X → Y → Z independently.
   *
   * Walk-off-edge: gravity continuously accumulates in velocity.y whenever
   * gravityEnabled is true. The moment the player leaves a block, _resolveAxis
   * finds no floor collision, onGround becomes false, and the fall starts
   * naturally next frame. No special-casing required.
   */
  _moveAndCollide(deltaTime, world) {
    if (!world) {
      this.position.x += this.velocity.x * deltaTime;
      this.position.y += this.velocity.y * deltaTime;
      this.position.z += this.velocity.z * deltaTime;
      return;
    }

    const hw = this.width / 2;

    // --- X ---
    const newX = this.position.x + this.velocity.x * deltaTime;
    if (this._resolveAxis(newX, this.position.y, this.position.z, hw, 'x', world)) {
      this.velocity.x = 0;
    } else {
      this.position.x = newX;
    }

    // --- Y ---
    const newY = this.position.y + this.velocity.y * deltaTime;
    if (this._resolveAxis(this.position.x, newY, this.position.z, hw, 'y', world)) {
      this.onGround = this.velocity.y <= 0;
      this.velocity.y = 0;
    } else {
      this.position.y = newY;
      this.onGround = false;
    }

    // --- Z ---
    const newZ = this.position.z + this.velocity.z * deltaTime;
    if (this._resolveAxis(this.position.x, this.position.y, newZ, hw, 'z', world)) {
      this.velocity.z = 0;
    } else {
      this.position.z = newZ;
    }

    this.inWater = this._checkInWater(world);
  }

  /**
   * Check the AABB at (newX, newY, newZ) for solid block overlap on one axis.
   * Returns true and snaps this.position if a collision is found.
   */
  _resolveAxis(newX, newY, newZ, hw, axis, world) {
    const minX = Math.floor(newX - hw);
    const maxX = Math.floor(newX + hw);
    const minY = Math.floor(newY);
    const maxY = Math.ceil(newY + this.height);
    const minZ = Math.floor(newZ - hw);
    const maxZ = Math.floor(newZ + hw);

    for (let bx = minX; bx <= maxX; bx++) {
      for (let by = minY; by < maxY; by++) {
        for (let bz = minZ; bz <= maxZ; bz++) {
          if (!this._isSolidAt(bx, by, bz, world)) continue;

          const overlapX = (newX - hw) < (bx + 1) && (newX + hw) > bx;
          const overlapY = newY < (by + 1) && (newY + this.height) > by;
          const overlapZ = (newZ - hw) < (bz + 1) && (newZ + hw) > bz;

          if (!overlapX || !overlapY || !overlapZ) continue;

          switch (axis) {
            case 'x':
              this.position.x = this.velocity.x > 0 ? bx - hw : bx + 1 + hw;
              return true;
            case 'y':
              this.position.y = this.velocity.y > 0
                ? by - this.height
                : by + 1;
              return true;
            case 'z':
              this.position.z = this.velocity.z > 0 ? bz - hw : bz + 1 + hw;
              return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Check if a block is solid. Unloaded chunks treated as solid (prevents
   * falling through chunk borders while adjacent chunk loads).
   */
  _isSolidAt(bx, by, bz, world) {
    const block = world.getBlockAtWorld(bx, by, bz);
    if (block === null || block === undefined) return true; // unloaded = solid
    if (block === 0) return false;
    const props = BLOCK_PROPERTIES[block];
    return props && props.solid === true;
  }

  _debugLog() {
    // Disabled — too verbose for normal gameplay
  }

  _checkInWater(world) {
    if (!world) return false;
    const block = world.getBlockAtWorld(
      Math.floor(this.position.x),
      Math.floor(this.position.y),
      Math.floor(this.position.z)
    );
    return block === BLOCK_TYPES.WATER;
  }

  getEyePosition() {
    return {
      x: this.position.x,
      y: this.position.y + 1.6,
      z: this.position.z,
    };
  }

  respawn(spawnPoint) {
    this.position = {
      x: spawnPoint ? spawnPoint.x : 0,
      y: spawnPoint ? spawnPoint.y : SEA_LEVEL + 4,
      z: spawnPoint ? spawnPoint.z : 0,
    };
    this.velocity = { x: 0, y: 0, z: 0 };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Player;
}
