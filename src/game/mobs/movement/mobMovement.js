/**
 * Cuubz — Mob Movement System
 * Handles velocity, gravity, AABB collision against solid blocks, step-up for stairs,
 * and flying movement for air-based mobs.
 */

import { AI_STATES } from '../mobDefinitions.js';

/**
 * Apply movement toward a target position for a ground-based mob.
 * Uses axis-separated AABB collision resolution (X → Y → Z).
 * @param {Mob} mob
 * @param {number} targetX
 * @param {number} targetZ
 * @param {number} deltaTime - Seconds
 * @param {object} blockAccess - World block getter
 */
export function applyGroundMovement(mob, targetX, targetZ, deltaTime, blockAccess) {
  deltaTime = Math.min(deltaTime, 0.1); // Clamp to prevent tunneling

  // Direction toward target
  const dx = targetX - mob.position.x;
  const dz = targetZ - mob.position.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  if (dist < 0.01) {
    // At target — slow down
    mob.velocity.x *= 0.8;
    mob.velocity.z *= 0.8;
    if (Math.abs(mob.velocity.x) < 0.01) mob.velocity.x = 0;
    if (Math.abs(mob.velocity.z) < 0.01) mob.velocity.z = 0;
  } else {
    // Set horizontal velocity toward target
    const speed = mob.speed * (mob.definition.fleeSpeed && mob.aiState === AI_STATES.FLEE ? mob.definition.fleeSpeed / mob.speed : 1.0);
    mob.velocity.x = (dx / dist) * speed;
    mob.velocity.z = (dz / dist) * speed;

    // Update yaw to face movement direction
    const targetYaw = Math.atan2(dx, dz);
    let yawDiff = targetYaw - mob.yaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    mob.yaw += yawDiff * Math.min(1, deltaTime * 8); // Smooth rotation
  }

  // Apply gravity
  if (!mob.isFlying) {
    mob.velocity.y += -25 * deltaTime; // blocks/s²
    if (mob.velocity.y < -40) mob.velocity.y = -40; // Terminal velocity
  }

  // Move and collide (X → Y → Z axis-separated)
  _moveAndCollide(mob, deltaTime, blockAccess);
}

/**
 * Apply movement for a flying mob (no gravity, 3D movement).
 * @param {Mob} mob
 * @param {number} targetX
 * @param {number} targetZ
 * @param {number} deltaTime
 * @param {object} blockAccess
 */
export function applyFlyingMovement(mob, targetX, targetZ, deltaTime, blockAccess) {
  deltaTime = Math.min(deltaTime, 0.1);

  const dx = targetX - mob.position.x;
  const dz = targetZ - mob.position.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  if (dist < 0.01) {
    mob.velocity.x *= 0.9;
    mob.velocity.z *= 0.9;
  } else {
    const speed = mob.speed;
    mob.velocity.x = (dx / dist) * speed;
    mob.velocity.z = (dz / dist) * speed;

    const targetYaw = Math.atan2(dx, dz);
    let yawDiff = targetYaw - mob.yaw;
    while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
    while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
    mob.yaw += yawDiff * Math.min(1, deltaTime * 6);
  }

  // Maintain height with gentle oscillation
  const baseY = mob.spawnPosition.y + 3;
  const heightOsc = Math.sin(mob.animationTimer * 0.5) * 0.5;
  const targetY = baseY + heightOsc;
  mob.velocity.y = (targetY - mob.position.y) * 2;
  if (Math.abs(mob.velocity.y) > 3) mob.velocity.y = Math.sign(mob.velocity.y) * 3;

  // Move and collide with lightweight collision (just position update)
  const hw = (mob.definition.hitbox.width || 0.6) / 2;
  const hh = mob.definition.hitbox.height || 0.6;

  // Check for solid blocks in the way — if so, push back
  const newX = mob.position.x + mob.velocity.x * deltaTime;
  const newY = mob.position.y + mob.velocity.y * deltaTime;
  const newZ = mob.position.z + mob.velocity.z * deltaTime;

  const minX = Math.floor(newX - hw);
  const maxX = Math.floor(newX + hw);
  const minY = Math.floor(newY);
  const maxY = Math.ceil(newY + hh);
  const minZ = Math.floor(newZ - hw);
  const maxZ = Math.floor(newZ + hw);

  let blocked = false;
  for (let bx = minX; bx <= maxX && !blocked; bx++) {
    for (let by = minY; by < maxY && !blocked; by++) {
      for (let bz = minZ; bz <= maxZ && !blocked; bz++) {
        const block = blockAccess.getBlockAtWorld ? blockAccess.getBlockAtWorld(bx, by, bz) : 0;
        if (block !== 0 && block !== 12) {
          blocked = true;
        }
      }
    }
  }

  if (!blocked) {
    mob.position.x = newX;
    mob.position.y = newY;
    mob.position.z = newZ;
  } else {
    mob.velocity.x *= -0.5;
    mob.velocity.z *= -0.5;
  }

  mob.onGround = false; // Flying mobs are never "on ground"
}

/**
 * Axis-separated AABB move and collide for ground mobs.
 * Resolves X → Y → Z independently.
 */
export function _moveAndCollide(mob, deltaTime, world) {
  if (!world) {
    mob.position.x += mob.velocity.x * deltaTime;
    mob.position.y += mob.velocity.y * deltaTime;
    mob.position.z += mob.velocity.z * deltaTime;
    return;
  }

  const hw = (mob.definition.hitbox.width || 0.8) / 2;
  const hh = mob.definition.hitbox.height || 0.9;

  // Step-up: check if we're about to collide with a small step
  let stepUp = 0;
  if (mob.velocity.y <= 0) {
    stepUp = _checkStepUp(mob, deltaTime, hw, hh, world);
    if (stepUp > 0) {
      mob.position.y += stepUp;
      mob.velocity.y = 0;
    }
  }

  // --- X ---
  const newX = mob.position.x + mob.velocity.x * deltaTime;
  if (_resolveAxis(mob, newX, mob.position.y, mob.position.z, hw, hh, 'x', world)) {
    mob.velocity.x = 0;
  } else {
    mob.position.x = newX;
  }

  // --- Y ---
  const newY = mob.position.y + mob.velocity.y * deltaTime;
  if (_resolveAxis(mob, mob.position.x, newY, mob.position.z, hw, hh, 'y', world)) {
    mob.onGround = mob.velocity.y <= 0;
    mob.velocity.y = 0;
  } else {
    mob.position.y = newY;
    mob.onGround = false;
  }

  // --- Z ---
  const newZ = mob.position.z + mob.velocity.z * deltaTime;
  if (_resolveAxis(mob, mob.position.x, mob.position.y, newZ, hw, hh, 'z', world)) {
    mob.velocity.z = 0;
  } else {
    mob.position.z = newZ;
  }
}

/**
 * Check if the mob can step up onto a half-block or full block stair.
 * Returns the step height to lift, or 0 if not needed.
 */
export function _checkStepUp(mob, deltaTime, hw, hh, world) {
  if (!world || !world.getBlockAtWorld) return 0;

  const stepHeight = 0.5;
  const hx = mob.position.x + mob.velocity.x * deltaTime;
  const hz = mob.position.z + mob.velocity.z * deltaTime;

  const minX = Math.floor(hx - hw);
  const maxX = Math.floor(hx + hw);
  const minZ = Math.floor(hz - hw);
  const maxZ = Math.floor(hz + hw);

  for (let bx = minX; bx <= maxX; bx++) {
    for (let bz = minZ; bz <= maxZ; bz++) {
      const by = Math.floor(mob.position.y);
      const block = world.getBlockAtWorld(bx, by, bz);
      if (block !== 0 && block !== 12) {
        // Check if the block above is air
        const above = world.getBlockAtWorld(bx, by + 1, bz);
        if (above === 0 || above === 12) {
          return stepHeight;
        }
      }
    }
  }
  return 0;
}

/**
 * Resolve AABB collision on one axis.
 * Returns true if collision occurred and position was snapped.
 */
export function _resolveAxis(mob, newX, newY, newZ, hw, hh, axis, world) {
  if (!world || !world.getBlockAtWorld) return false;

  const minX = Math.floor(newX - hw);
  const maxX = Math.floor(newX + hw);
  const minY = Math.floor(newY);
  const maxY = Math.ceil(newY + hh);
  const minZ = Math.floor(newZ - hw);
  const maxZ = Math.floor(newZ + hw);

  for (let bx = minX; bx <= maxX; bx++) {
    for (let by = minY; by < maxY; by++) {
      for (let bz = minZ; bz <= maxZ; bz++) {
        const block = world.getBlockAtWorld(bx, by, bz);
        if (block === null || block === undefined) continue; // Unloaded = pass through
        if (block === 0 || block === 12) continue; // Air

        const overlapX = (newX - hw) < (bx + 1) && (newX + hw) > bx;
        const overlapY = newY < (by + 1) && (newY + hh) > by;
        const overlapZ = (newZ - hw) < (bz + 1) && (newZ + hw) > bz;

        if (!overlapX || !overlapY || !overlapZ) continue;

        // Check if this block is damaging (lava, toxic slime)
        // For now, just snap

        switch (axis) {
          case 'x':
            mob.position.x = mob.velocity.x > 0 ? bx - hw : bx + 1 + hw;
            return true;
          case 'y':
            mob.position.y = mob.velocity.y > 0 ? by - hh : by + 1;
            return true;
          case 'z':
            mob.position.z = mob.velocity.z > 0 ? bz - hw : bz + 1 + hw;
            return true;
        }
      }
    }
  }

  return false;
}

/**
 * Main entry point — applies the correct movement type based on the mob.
 * @param {Mob} mob
 * @param {number} targetX
 * @param {number} targetZ
 * @param {number} deltaTime
 * @param {object} blockAccess
 */
export function applyMovement(mob, targetX, targetZ, deltaTime, blockAccess) {
  if (mob.isFlying) {
    applyFlyingMovement(mob, targetX, targetZ, deltaTime, blockAccess);
  } else {
    applyGroundMovement(mob, targetX, targetZ, deltaTime, blockAccess);
  }
}
