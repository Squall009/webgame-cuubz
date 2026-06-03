/**
 * Cuubz — Player Entity
 * Movement, physics, AABB collision against solid blocks.
 *
 * Uses axis-separated AABB resolution (X → Y → Z) to prevent corner catching.
 * Includes step-up mechanic for smooth stair climbing.
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

    // Double-jump → fly mode detection (survival mode)
    this.jumpCount = 0;       // consecutive jump presses
    this.jumpTimer = 0;        // ms since last jump press
    this.doubleJumpThreshold = 750; // max ms between jumps to count as double-tap (increased from 250ms for usability)

    // Step-up height for smooth stair climbing
    this.stepHeight = 0.5;

    // Inventory reference (set by game.js)
    this.inventory = null;
  }

  setCreativeMode(creative) {
    if (creative) {
      this.gravityEnabled = false;
      this.flySpeed = 8;
    } else {
      this.gravityEnabled = true;
      this.flyMode = false;
    }
  }

  toggleFlyMode() {
    if (!this.gravityEnabled) {
      this.flyMode = !this.flyMode;
    }
  }

  get isFlying() {
    return this.flyMode && !this.onGround;
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

    // Fly mode vertical movement
    if (this.flyMode && !this.gravityEnabled) {
      if (inputState.jump) {
        this.velocity.y = this.flySpeed;
      } else if (inputState.sneak || inputState.backward_fly) {
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

    // Jump (survival only) — single jump on ground, double-jump triggers flying mode
    if (this.gravityEnabled && inputState.jump) {
      const now = performance.now();
      
      if (this.onGround) {
        // First jump from ground — reset counter
        this.velocity.y = this.jumpVelocity;
        this.onGround = false;
        this.jumpCount = 1;
        this.jumpTimer = now;
      } else if (this.jumpCount === 0 || (now - this.jumpTimer) > this.doubleJumpThreshold * 3) {
        // Too much time since last jump — treat as fresh single jump attempt mid-air (ignored)
        // This handles: player jumps, lands, then tries to jump again without ground contact flag resetting
      } else if (this.jumpCount === 1 && (now - this.jumpTimer) <= this.doubleJumpThreshold) {
        // Double-jump detected! Activate flying mode.
        console.log('[Cuubz] 🚀 DOUBLE-JUMP → FLY MODE ACTIVATED! Press Space to go up, Shift/S to go down.');
        this.gravityEnabled = false;
        this.flyMode = true;
        this.velocity.y = this.jumpVelocity * 0.8; // upward boost on activation
        this.jumpCount = 2;
        this.jumpTimer = now;
      } else if (this.jumpCount === 1) {
        // Second jump press but too slow — treat as mid-air jump attempt (ignored in survival)
      } else {
        // Already double-jumped or too slow — ignore extra jump presses
      }
    }

    // Reset jump counter when landing
    if (this.onGround) {
      this.jumpCount = 0;
      this.jumpTimer = 0;
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
      // position.x already snapped inside _resolveAxis
      this.velocity.x = 0;
    } else {
      this.position.x = newX;
    }

    // --- Y ---
    // This is the critical one. _resolveAxis scans the full AABB volume at the
    // new position. If any solid block overlaps, the player is snapped to its
    // surface. This correctly handles: landing, walking off edges (no hit →
    // onGround=false → gravity takes over), and ceiling bumps.
    const newY = this.position.y + this.velocity.y * deltaTime;
    if (this._resolveAxis(this.position.x, newY, this.position.z, hw, 'y', world)) {
      // position.y snapped. landing = true, head-bump = false.
      this.onGround = this.velocity.y <= 0;
      this.velocity.y = 0; // MUST zero — otherwise gravity accumulates and tunnels
    } else {
      this.position.y = newY;
      this.onGround = false; // no floor contact — gravity will accelerate next frame
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
   *
   * The Y range spans [floor(feetY), ceil(headY)) — exactly the blocks the
   * player body occupies. No extra rows above or below; those caused false
   * positives in earlier versions.
   */
  _resolveAxis(newX, newY, newZ, hw, axis, world) {
    const minX = Math.floor(newX - hw);
    const maxX = Math.floor(newX + hw);
    const minY = Math.floor(newY);              // feet block (inclusive)
    const maxY = Math.ceil(newY + this.height); // head block (exclusive)
    const minZ = Math.floor(newZ - hw);
    const maxZ = Math.floor(newZ + hw);

    for (let bx = minX; bx <= maxX; bx++) {
      for (let by = minY; by < maxY; by++) {
        for (let bz = minZ; bz <= maxZ; bz++) {
          if (!this._isSolidAt(bx, by, bz, world)) continue;

          // Block occupies [bx, bx+1] × [by, by+1] × [bz, bz+1]
          // Player AABB occupies [newX-hw, newX+hw] × [newY, newY+height] × [newZ-hw, newZ+hw]
          // Only snap if there is actual overlap (guards against adjacent-but-touching blocks)
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
                ? by - this.height  // head bump: snap feet down below block
                : by + 1;           // landing: snap feet to block top
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
    if (typeof CuubzLogger !== 'undefined' && CuubzLogger.DEBUG) {
      console.log(`[Player] pos=(${this.position.x.toFixed(2)}, ${this.position.y.toFixed(2)}, ${this.position.z.toFixed(2)}) ` +
        `vel=(${this.velocity.x.toFixed(2)}, ${this.velocity.y.toFixed(2)}, ${this.velocity.z.toFixed(2)}) onGround=${this.onGround}`);
    }
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
      y: spawnPoint ? spawnPoint.y : 20,
      z: spawnPoint ? spawnPoint.z : 0,
    };
    this.velocity = { x: 0, y: 0, z: 0 };
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Player;
}