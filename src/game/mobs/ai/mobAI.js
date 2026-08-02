/**
 * Cuubz — Mob AI State Machine
 * Drives all mob behavior: idle, wander, chase, attack, flee, hurt, dead, return home.
 * Designed to be called once per frame from the MobManager.
 */

import { shouldAggro, shouldLoseAggro, triggerPackAggro } from './mobSenses.js';
import { AI_STATES, MOB_BEHAVIORS } from '../mobDefinitions.js';

/**
 * Run one tick of the AI state machine for a mob.
 * @param {Mob} mob
 * @param {number} deltaTime - Seconds since last tick
 * @param {object} blockAccess - World block data interface
 * @param {{x:number,y:number,z:number}|null} playerPosition
 * @param {Mob[]} allMobs - All active mobs (for pack aggro)
 * @param {function} applyMovementFn - (mob, tx, tz, dt, blockAccess) => void
 */
export function updateAI(mob, deltaTime, blockAccess, playerPosition, allMobs, applyMovementFn) {
  if (mob.isDead || mob.hurtTimer > 0) return;

  // Decrement AI timer
  mob.aiTimer -= deltaTime;

  // Decrement flee cooldown
  if (mob.fleeCooldownTimer > 0) mob.fleeCooldownTimer -= deltaTime;

  // Distance to player
  const distToPlayer = playerPosition ? mob.distanceTo(playerPosition) : Infinity;

  // Passive mobs use a tighter flee distance (half of senseRange, at most 10 blocks)
  const senseRange = mob.definition.ai.senseRange || 20;
  const fleeDistance = mob.definition.behavior === MOB_BEHAVIORS.WANDER_FLEE
    ? Math.min(senseRange * 0.4, 10)
    : senseRange;

  const playerInSense = playerPosition && distToPlayer <= senseRange;
  const playerInFleeRange = playerPosition && distToPlayer <= fleeDistance;
  const playerInAggro = playerPosition && distToPlayer <= (mob.definition.ai.aggroRange || 0);
  const playerInAttackRange = playerPosition && distToPlayer <= mob.definition.ai.attackRange;

  // ────────────────────────────────────────────────
  // State Machine
  // ────────────────────────────────────────────────
  switch (mob.aiState) {
    case AI_STATES.IDLE:
      _stateIdle(mob, deltaTime, playerPosition, playerInAggro, playerInSense);
      break;

    case AI_STATES.WANDER:
      _stateWander(mob, deltaTime, blockAccess, playerPosition, playerInAggro, playerInSense, applyMovementFn);
      break;

    case AI_STATES.CHASE:
      _stateChase(mob, deltaTime, blockAccess, playerPosition, playerInAttackRange, applyMovementFn);
      // Trigger pack aggro
      if (playerPosition) {
        triggerPackAggro(mob, allMobs, playerPosition);
      }
      break;

    case AI_STATES.ATTACK:
      _stateAttack(mob, deltaTime, playerPosition, blockAccess);
      break;

    case AI_STATES.FLEE:
      _stateFlee(mob, deltaTime, blockAccess, playerPosition, applyMovementFn);
      break;

    case AI_STATES.RETURN_HOME:
      _stateReturnHome(mob, deltaTime, blockAccess, applyMovementFn);
      break;
  }

  // Check for aggro transitions (hostile mobs only).
  //
  // The range + line-of-sight test used to be inlined here, duplicating `shouldAggro`,
  // which was exported and had no callers at all. Routing through it puts the aggro
  // gate — including the MAX_ENGAGED_MOBS budget, which is the ceiling on how many mobs
  // may converge at once — in exactly one place, so the two cannot drift apart again.
  // The predicate's `isDead`/`hurtTimer` checks are redundant with `updateAI`'s early
  // return, not contradictory, so this is the same decision plus the budget.
  if (mob.definition.behavior === MOB_BEHAVIORS.AGGRESSIVE && playerPosition) {
    if (mob.aiState !== AI_STATES.CHASE && mob.aiState !== AI_STATES.ATTACK && mob.aiState !== AI_STATES.HURT) {
      if (shouldAggro(mob, playerPosition, blockAccess, allMobs)) {
        mob.targetEntity = playerPosition;
        mob.aiState = AI_STATES.CHASE;
      }
    } else if ((mob.aiState === AI_STATES.CHASE || mob.aiState === AI_STATES.ATTACK) && playerPosition) {
      // Check if we should lose aggro
      if (shouldLoseAggro(mob, playerPosition)) {
        mob.targetEntity = null;
        // Disengaging clears the pack-recruit mark, so a mob that was pulled in once can
        // pull others in later — the flag suppresses the cascade, it is not a life sentence.
        mob.recruitedByPack = false;
        mob.aiState = AI_STATES.RETURN_HOME;
      }
    }
  }

  // Check for flee transitions (passive mobs)
  // Only flee when player is very close (fleeDistance) and cooldown has expired
  if (mob.definition.behavior === MOB_BEHAVIORS.WANDER_FLEE && playerPosition) {
    if (mob.aiState !== AI_STATES.FLEE && mob.aiState !== AI_STATES.HURT && mob.fleeCooldownTimer <= 0) {
      if (playerInFleeRange) {
        mob.fleeTarget = playerPosition;
        mob.aiState = AI_STATES.FLEE;
        mob.aiTimer = 3.0; // Flee for 3 seconds max
      }
    }
  }
}

/**
 * ── IDLE: Standing still, timer counts down, then transition to WANDER ──
 */
export function _stateIdle(mob, deltaTime, playerPosition, playerInAggro, playerInSense) {
  if (mob.aiTimer <= 0) {
    mob.aiState = AI_STATES.WANDER;
    mob.aiTimer = _randRange(mob.definition.ai.wanderInterval || [3, 8]);
    _pickWanderTarget(mob);
  }
}

/**
 * ── WANDER: Move toward a random point within leash distance ──
 */
export function _stateWander(mob, deltaTime, blockAccess, playerPosition, playerInAggro, playerInSense, applyMovementFn) {
  // If no wander target or timer expired, pick a new one
  if (!mob.wanderTarget || mob.aiTimer <= 0) {
    _pickWanderTarget(mob);
    mob.aiTimer = _randRange(mob.definition.ai.wanderInterval || [3, 8]);
  }

  // Move toward wander target
  if (mob.wanderTarget) {
    const dist = mob.distanceTo(mob.wanderTarget);
    if (dist > 0.5) {
      applyMovementFn(mob, mob.wanderTarget.x, mob.wanderTarget.z, deltaTime, blockAccess);
    } else {
      // Reached target, go back to idle
      mob.aiState = AI_STATES.IDLE;
      mob.aiTimer = _randRange([2, 5]);
      mob.wanderTarget = null;
    }
  }
}

/**
 * ── CHASE: Move toward the target player ──
 */
export function _stateChase(mob, deltaTime, blockAccess, playerPosition, playerInAttackRange, applyMovementFn) {
  if (!playerPosition || !mob.targetEntity) {
    mob.aiState = AI_STATES.RETURN_HOME;
    return;
  }

  // If in attack range, transition to attack
  if (playerInAttackRange && mob.attackCooldownTimer <= 0) {
    mob.aiState = AI_STATES.ATTACK;
    mob.animationTimer = 0;
    return;
  }

  // Chase the player
  applyMovementFn(mob, playerPosition.x, playerPosition.z, deltaTime, blockAccess);
}

/**
 * ── ATTACK: Deal damage to the player, then return to chase ──
 * The actual damage is dealt by the caller (mobManager) after this returns.
 * This function manages the animation timing and cooldown.
 */
export function _stateAttack(mob, deltaTime, playerPosition, blockAccess) {
  const attackAnim = mob.definition.animations && mob.definition.animations.attack;
  const duration = attackAnim ? attackAnim.duration : 0.3;

  mob.animationTimer += deltaTime;

  // Once the attack animation completes, apply damage and go back to chase.
  //
  // D-88 (recorded, not fixed): this flips ATTACK → CHASE from inside `mobManager.update()`'s
  // AI pass, which runs BEFORE `renderer.update()` in the same tick. So the animator never
  // sees ATTACK on the frame the attack completes, and `lungeAttack`/`slamAttack`/
  // `chargeAttack`'s final recovery frame — the one that lerps the body back to its rest
  // pose — is never dispatched. One-shots are truncated one frame early, at every frame
  // rate, for the same ordering reason that made the HURT cleanup an exit hook.
  //
  // Harmless as it stands: `MobAnimator._resetToInitialPose()` puts every part back at the
  // top of the next frame, so the dropped frame is the one that would have moved the parts
  // to where the reset puts them anyway. Do NOT reorder the manager's two passes to "fix"
  // it — the AI must see the same tick's movement, and the renderer must see the AI's
  // decision, so this ordering is the correct one and the animator is what has to
  // accommodate it.
  if (mob.animationTimer >= duration) {
    mob.attackCooldownTimer = 1.0 / (mob.definition.attackSpeed || 1);
    mob.aiState = AI_STATES.CHASE;
    mob.animationTimer = 0;
  }
}

/**
 * ── FLEE: Run away from the threat ──
 */
export function _stateFlee(mob, deltaTime, blockAccess, playerPosition, applyMovementFn) {
  if (!playerPosition) {
    mob.aiState = AI_STATES.IDLE;
    mob.fleeCooldownTimer = 5 + Math.random() * 3;
    return;
  }

  // Run in the opposite direction
  const dx = mob.position.x - playerPosition.x;
  const dz = mob.position.z - playerPosition.z;
  const dist = Math.sqrt(dx * dx + dz * dz);

  if (dist > mob.definition.ai.fleeRange || dist < 0.1) {
    // Safe distance reached — go back to idle with cooldown
    mob.aiState = AI_STATES.IDLE;
    mob.aiTimer = _randRange([2, 4]);
    mob.fleeCooldownTimer = 5 + Math.random() * 3; // 5-8s before can flee again
    return;
  }

  // Flee direction (away from player)
  const fleeX = mob.position.x + (dx / dist) * 20;
  const fleeZ = mob.position.z + (dz / dist) * 20;
  applyMovementFn(mob, fleeX, fleeZ, deltaTime, blockAccess);

  // Flee timer — brief flee then re-evaluate
  mob.aiTimer -= deltaTime;
  if (mob.aiTimer <= 0) {
    mob.aiState = AI_STATES.IDLE;
    mob.aiTimer = _randRange([2, 4]);
    mob.fleeCooldownTimer = 5 + Math.random() * 3;
  }
}

/**
 * ── RETURN_HOME: Walk back to spawn position ──
 */
export function _stateReturnHome(mob, deltaTime, blockAccess, applyMovementFn) {
  const dist = mob.distanceTo(mob.spawnPosition);
  if (dist <= 1.0) {
    mob.aiState = AI_STATES.IDLE;
    mob.aiTimer = _randRange([2, 5]);
    return;
  }

  applyMovementFn(mob, mob.spawnPosition.x, mob.spawnPosition.z, deltaTime, blockAccess);
}

/**
 * Pick a random wander target within leash distance from spawn.
 */
export function _pickWanderTarget(mob) {
  const leash = mob.definition.leashDistance || 24;
  const angle = Math.random() * Math.PI * 2;
  const radius = Math.random() * leash;
  mob.wanderTarget = {
    x: mob.spawnPosition.x + Math.cos(angle) * radius,
    y: mob.spawnPosition.y,
    z: mob.spawnPosition.z + Math.sin(angle) * radius,
  };
}

/**
 * Random float in range [min, max].
 */
export function _randRange(range) {
  if (!range || range.length < 2) return 3;
  return range[0] + Math.random() * (range[1] - range[0]);
}
