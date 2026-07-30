/**
 * Cuubz — Mob Senses Module
 * Detection, aggro, line-of-sight, and pack coordination.
 * Used by the AI state machine to make decisions each tick.
 */

import { AI_STATES, MOB_BEHAVIORS } from '../mobDefinitions.js';

/**
 * Check if a mob can see a target (line of sight + distance).
 * @param {Mob} mob
 * @param {{x:number,y:number,z:number}} targetPosition
 * @param {object} blockAccess
 * @returns {boolean}
 */
export function canSeeTarget(mob, targetPosition, blockAccess) {
  if (!targetPosition || !blockAccess) return false;
  const dist = mob.distanceTo(targetPosition);
  if (dist > mob.definition.ai.senseRange) return false;
  return mob.canSee(targetPosition, blockAccess);
}

/**
 * Check if a mob should aggro on a player.
 * @param {Mob} mob
 * @param {{x:number,y:number,z:number}} playerPosition
 * @param {object} blockAccess
 * @returns {boolean}
 */
export function shouldAggro(mob, playerPosition, blockAccess) {
  if (!playerPosition) return false;
  if (mob.definition.behavior !== MOB_BEHAVIORS.AGGRESSIVE) return false;
  if (mob.isDead || mob.hurtTimer > 0) return false;

  const dist = mob.distanceTo(playerPosition);
  const aggroRange = mob.definition.ai.aggroRange;
  if (dist > aggroRange) return false;

  // Line of sight check
  return mob.canSee(playerPosition, blockAccess);
}

/**
 * Check if a mob should lose aggro on its current target.
 * @param {Mob} mob
 * @param {{x:number,y:number,z:number}|null} playerPosition
 * @returns {boolean}
 */
export function shouldLoseAggro(mob, playerPosition) {
  if (!playerPosition) return true;
  if (!mob.targetEntity) return true;

  const dist = mob.distanceTo(playerPosition);
  const loseRange = mob.definition.ai.loseInterestRange;
  if (dist > loseRange) return true;

  return false;
}

/**
 * Check if a passive mob should flee from a nearby player.
 * @param {Mob} mob
 * @param {{x:number,y:number,z:number}} playerPosition
 * @returns {boolean}
 */
export function shouldFlee(mob, playerPosition) {
  if (!playerPosition) return false;
  if (mob.definition.behavior !== MOB_BEHAVIORS.WANDER_FLEE) return false;
  if (mob.isDead) return false;

  const dist = mob.distanceTo(playerPosition);
  return dist <= mob.definition.ai.senseRange;
}

/**
 * Find nearby mobs of the same type for pack aggro.
 * @param {Mob} mob
 * @param {Mob[]} otherMobs - Array of all active mobs
 * @returns {Mob[]} Nearby same-type mobs
 */
export function detectPackMembers(mob, otherMobs) {
  if (!mob.definition.ai.packAggro || !otherMobs) return [];

  const packRadius = mob.definition.ai.packRadius;
  const members = [];

  for (const other of otherMobs) {
    if (other === mob) continue;
    if (other.isDead) continue;
    if (other.mobType !== mob.mobType) continue;
    if (mob.distanceTo(other.position) <= packRadius) {
      members.push(other);
    }
  }

  return members;
}

/**
 * Trigger pack aggro — if this mob is chasing, tell nearby same-type mobs to chase too.
 * @param {Mob} mob
 * @param {Mob[]} otherMobs
 * @param {{x:number,y:number,z:number}} playerPosition
 */
export function triggerPackAggro(mob, otherMobs, playerPosition) {
  if (!mob.definition.ai.packAggro) return;
  if (mob.aiState !== AI_STATES.CHASE && mob.aiState !== AI_STATES.ATTACK) return;

  const members = detectPackMembers(mob, otherMobs);
  for (const member of members) {
    if (member.aiState === AI_STATES.IDLE || member.aiState === AI_STATES.WANDER) {
      member.targetEntity = playerPosition;
      member.aiState = AI_STATES.CHASE;
    }
  }
}
