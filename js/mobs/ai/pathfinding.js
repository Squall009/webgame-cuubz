/**
 * Cuubz — Mob Pathfinding System
 * Two-tier pathfinding:
 *   Tier 1 (fast): Direct chase with simple obstacle avoidance (runs every frame)
 *   Tier 2 (expensive): A* escape when stuck (limited to 64 nodes, cached)
 */

/**
 * Tier 1: Direct movement toward target with obstacle avoidance.
 * Casts a forward ray at mob eye height; if blocked, tries lateral offsets.
 * @param {Mob} mob
 * @param {{x:number,z:number}} target
 * @param {object} blockAccess - World block getter
 * @returns {{dx:number, dz:number, stuck:boolean}} Movement direction and stuck flag
 */
function directChase(mob, target, blockAccess) {
  const dx = target.x - mob.position.x;
  const dz = target.z - mob.position.z;
  const dist = Math.sqrt(dx * dx + dz * dz);
  if (dist < 0.01) return { dx: 0, dz: 0, stuck: false };

  const dirX = dx / dist;
  const dirZ = dz / dist;

  // Cast a forward ray at mob eye height
  const eyeY = mob.position.y + (mob.definition.hitbox.height * 0.5);
  const lookAhead = 1.5;
  const checkX = Math.floor(mob.position.x + dirX * lookAhead);
  const checkY = Math.floor(eyeY);
  const checkZ = Math.floor(mob.position.z + dirZ * lookAhead);

  const block = blockAccess.getBlockAtWorld ? blockAccess.getBlockAtWorld(checkX, checkY, checkZ) : 0;
  const isBlocked = block !== 0 && block !== 12; // Non-air

  let stuck = false;

  if (isBlocked) {
    // Try lateral offsets (left and right)
    const perpX = -dirZ;
    const perpZ = dirX;

    let foundOpen = false;
    const offsets = [1.0, -1.0, 1.5, -1.5, 2.0, -2.0];

    for (const offset of offsets) {
      const testX = Math.floor(mob.position.x + dirX * 0.5 + perpX * offset);
      const testZ = Math.floor(mob.position.z + dirZ * 0.5 + perpZ * offset);
      const testBlock = blockAccess.getBlockAtWorld ? blockAccess.getBlockAtWorld(testX, checkY, testZ) : 0;
      if (testBlock === 0 || testBlock === 12) {
        // Found open space, steer toward it
        const steerX = perpX * offset;
        const steerZ = perpZ * offset;
        const steerDist = Math.sqrt(steerX * steerX + steerZ * steerZ);
        if (steerDist > 0.01) {
          return { dx: dirX * 0.3 + steerX / steerDist * 0.7, dz: dirZ * 0.3 + steerZ / steerDist * 0.7, stuck: false };
        }
      }
    }

    // No lateral opening found — stuck
    stuck = true;
  }

  return { dx: dirX, dz: dirZ, stuck };
}

/**
 * Tier 2: A* pathfinding on a 2D grid.
 * Only runs when mob is stuck for >1 second.
 * Maximum 64 nodes searched.
 * @param {Mob} mob
 * @param {{x:number, z:number}} goal
 * @param {object} blockAccess
 * @returns {{x:number, z:number}[]} Array of waypoints
 */
function astarPathfind(mob, goal, blockAccess) {
  const startX = Math.floor(mob.position.x);
  const startZ = Math.floor(mob.position.z);
  const goalX = Math.floor(goal.x);
  const goalZ = Math.floor(goal.z);

  const hitboxW = Math.ceil(mob.definition.hitbox.width || 0.6);

  // Simple A* on integer grid
  const openSet = [{ x: startX, z: startZ, g: 0, f: heuristic(startX, startZ, goalX, goalZ), parent: null }];
  const closedSet = new Set();
  const nodeLimit = 64;

  while (openSet.length > 0 && closedSet.size < nodeLimit) {
    // Find lowest f in open set
    let bestIdx = 0;
    for (let i = 1; i < openSet.length; i++) {
      if (openSet[i].f < openSet[bestIdx].f) bestIdx = i;
    }

    const current = openSet.splice(bestIdx, 1)[0];
    const key = `${current.x},${current.z}`;

    if (closedSet.has(key)) continue;
    closedSet.add(key);

    // Reached goal?
    if (Math.abs(current.x - goalX) <= 1 && Math.abs(current.z - goalZ) <= 1) {
      return reconstructPath(current);
    }

    // 6-neighbor search (cardinal + diagonal)
    const neighbors = [
      { x: -1, z: 0 }, { x: 1, z: 0 }, { x: 0, z: -1 }, { x: 0, z: 1 },
      { x: -1, z: -1 }, { x: 1, z: 1 }, { x: 1, z: -1 }, { x: -1, z: 1 },
    ];

    for (const n of neighbors) {
      const nx = current.x + n.x;
      const nz = current.z + n.z;
      const nkey = `${nx},${nz}`;
      if (closedSet.has(nkey)) continue;

      // Walkability check
      const mobY = Math.floor(mob.position.y);
      if (!isWalkable(nx, mobY, nz, hitboxW, blockAccess)) continue;

      const moveCost = (n.x !== 0 && n.z !== 0) ? 1.414 : 1.0;
      const g = current.g + moveCost;
      const h = heuristic(nx, nz, goalX, goalZ);
      openSet.push({ x: nx, z: nz, g, f: g + h, parent: current });
    }
  }

  // No path found — return empty
  return [];
}

/**
 * Check if a grid cell is walkable for a mob.
 */
function isWalkable(x, y, z, halfWidth, blockAccess) {
  if (!blockAccess || !blockAccess.getBlockAtWorld) return true;

  // Check floor
  const floorBlock = blockAccess.getBlockAtWorld(x, y - 1, z);
  if (floorBlock === null || floorBlock === undefined) return true; // Unloaded = walkable
  const floorIsSolid = floorBlock !== 0 && floorBlock !== 12 && floorBlock !== 7 && floorBlock !== 15;
  if (!floorIsSolid) return false;

  // Check head space
  const headBlock = blockAccess.getBlockAtWorld(x, y + 1, z);
  if (headBlock === null || headBlock === undefined) return true;
  const headIsAir = headBlock === 0 || headBlock === 12;
  if (!headIsAir) return false;

  // For wide mobs, check adjacent cells too
  if (halfWidth > 1) {
    for (let wx = -halfWidth + 1; wx <= halfWidth - 1; wx++) {
      for (let wz = -halfWidth + 1; wz <= halfWidth - 1; wz++) {
        if (wx === 0 && wz === 0) continue;
        const adjBlock = blockAccess.getBlockAtWorld(x + wx, y, z + wz);
        if (adjBlock === null || adjBlock === undefined) continue;
        if (adjBlock !== 0 && adjBlock !== 12) return false;
      }
    }
  }

  return true;
}

/**
 * Reconstruct path from A* linked list.
 */
function reconstructPath(node) {
  const path = [];
  let current = node;
  while (current) {
    path.unshift({ x: current.x, z: current.z });
    current = current.parent;
  }
  return path;
}

/**
 * Manhattan distance heuristic.
 */
function heuristic(x1, z1, x2, z2) {
  return Math.abs(x1 - x2) + Math.abs(z1 - z2);
}

/**
 * Evaluate the mob's stuck status and compute movement direction.
 * @param {Mob} mob
 * @param {{x:number, z:number}} target
 * @param {number} deltaTime
 * @param {object} blockAccess
 * @returns {{dx:number, dz:number}} Movement direction vector
 */
function computeMovement(mob, target, deltaTime, blockAccess) {
  // Check if we have a valid A* path
  if (mob.path && mob.path.length > 0 && mob.pathIndex < mob.path.length) {
    const waypoint = mob.path[mob.pathIndex];
    const dx = waypoint.x + 0.5 - mob.position.x;
    const dz = waypoint.z + 0.5 - mob.position.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 0.5) {
      mob.pathIndex++;
      if (mob.pathIndex >= mob.path.length) {
        mob.path = [];
        mob.pathIndex = 0;
        mob.stuckTimer = 0;
      }
      return computeMovement(mob, target, deltaTime, blockAccess); // Recurse for next waypoint
    }

    // Normalize
    return { dx: dx / dist, dz: dz / dist };
  }

  // Tier 1: Direct chase
  const result = directChase(mob, target, blockAccess);

  if (result.stuck) {
    mob.stuckTimer += deltaTime;
    // If stuck for more than 1 second, trigger A*
    if (mob.stuckTimer > 1.0) {
      const goal = { x: target.x, z: target.z };
      mob.path = astarPathfind(mob, goal, blockAccess);
      mob.pathIndex = 0;
      mob.stuckTimer = 0;

      if (mob.path.length > 0) {
        return computeMovement(mob, target, deltaTime, blockAccess);
      }
    }
  } else {
    mob.stuckTimer = 0;
  }

  return result;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { computeMovement, directChase, astarPathfind };
}