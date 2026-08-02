/**
 * Cuubz — Mob Senses Module
 * Detection, aggro, line-of-sight, and pack coordination.
 * Used by the AI state machine to make decisions each tick.
 */

import { AI_STATES, MOB_BEHAVIORS } from '../mobDefinitions.js';

/**
 * ── Engagement budget ────────────────────────────────────────────────────────
 *
 * The number of hostile mobs allowed to be committed to the player (CHASE or ATTACK)
 * at any one moment. Everything else in this file is a range tweak; this is the hard
 * ceiling, and it is what makes the worst case bounded rather than merely unlikely.
 *
 * Without it, the only thing limiting how many mobs converge on a player is how many
 * happen to be within aggro range — which on a dense spawn tick is "all of them".
 * Mobs over budget stay in WANDER and are re-considered every tick, so the moment one
 * of the engaged pair dies or loses interest, the next closest takes its place. The
 * fight stays continuous; it just stops being simultaneous.
 */
export const MAX_ENGAGED_MOBS = 2;

/**
 * How many pack members a single chasing mob may recruit per trigger. Recruits are
 * additionally capped by MAX_ENGAGED_MOBS, so this is a rate limit on the burst, not
 * a second budget.
 */
export const MAX_PACK_RECRUITS = 2;

/**
 * A pack recruit must be within this multiple of its OWN aggroRange of the player to
 * join. A wolf 10 blocks behind its packmate is not "in the fight" just because its
 * packmate is — recruiting it is how a chase used to drag in mobs that could not see
 * the player and would not have aggroed on their own.
 */
export const PACK_RECRUIT_RANGE_FACTOR = 1.25;

/**
 * Count how many mobs are currently committed to the player.
 * @param {Mob[]} allMobs
 * @param {Mob} [exclude] - Mob to skip (usually the one asking)
 * @returns {number}
 */
export function countEngagedMobs(allMobs, exclude = null) {
  if (!allMobs) return 0;
  let count = 0;
  for (const other of allMobs) {
    if (other === exclude) continue;
    if (other.isDead) continue;
    if (other.aiState === AI_STATES.CHASE || other.aiState === AI_STATES.ATTACK) count++;
  }
  return count;
}

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
 *
 * `allMobs` is optional only so the exported predicate stays usable in isolation; the
 * AI always passes it, and omitting it skips the engagement budget — which is the one
 * check that keeps a crowd from committing at once. Pass it.
 *
 * @param {Mob} mob
 * @param {{x:number,y:number,z:number}} playerPosition
 * @param {object} blockAccess
 * @param {Mob[]} [allMobs] - All active mobs, for the engagement budget
 * @returns {boolean}
 */
export function shouldAggro(mob, playerPosition, blockAccess, allMobs = null) {
  if (!playerPosition) return false;
  if (mob.definition.behavior !== MOB_BEHAVIORS.AGGRESSIVE) return false;
  if (mob.isDead || mob.hurtTimer > 0) return false;

  const dist = mob.distanceTo(playerPosition);
  const aggroRange = mob.definition.ai.aggroRange;
  if (dist > aggroRange) return false;

  // Engagement budget — a mob that would be the (N+1)th attacker stays where it is and
  // re-asks next tick, rather than joining a pile-on.
  if (allMobs && countEngagedMobs(allMobs, mob) >= MAX_ENGAGED_MOBS) return false;

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
 *
 * ─── WHY THIS IS SO HEAVILY GUARDED ──────────────────────────────────────────
 *
 * This function used to be a chain reaction. It is called every tick from
 * `_stateChase`, and it flipped every idle/wander packmate inside `packRadius` to
 * CHASE with no line-of-sight test and no distance-to-player test. Those recruits ran
 * `_stateChase` on the next tick and recruited *their* neighbours, so aggro propagated
 * hop by hop across the entire same-type population — a wolf 60 blocks away, through
 * a hillside, with the player never in its senses, ended up sprinting at them. Both
 * `packAggro` mobs (`corrupt_wolf`, `corrupt_wisp`) have high spawn weights, so in
 * practice this is what "every enemy on the screen attacks at once" was.
 *
 * Four guards, each closing a different half of that:
 *
 *   1. **Recruits do not re-propagate** (`recruitedByPack`). This is the one that
 *      actually breaks the chain: propagation now radiates one hop from a mob that
 *      aggroed on its own senses, and stops. The flag is cleared when the mob
 *      disengages (`mobAI.js`, RETURN_HOME), so a pack can re-form later.
 *   2. **A recruit must plausibly have found the player itself** — within
 *      PACK_RECRUIT_RANGE_FACTOR of its own `aggroRange`. Being near a packmate is
 *      not evidence the player is near you.
 *   3. **MAX_PACK_RECRUITS** bounds a single trigger, so one chaser cannot empty a
 *      whole `packRadius` in one tick.
 *   4. **MAX_ENGAGED_MOBS** bounds the total, and is re-counted as recruits are added
 *      so a burst inside one call cannot overshoot it.
 *
 * @param {Mob} mob
 * @param {Mob[]} otherMobs
 * @param {{x:number,y:number,z:number}} playerPosition
 */
export function triggerPackAggro(mob, otherMobs, playerPosition) {
  if (!mob.definition.ai.packAggro) return;
  if (mob.aiState !== AI_STATES.CHASE && mob.aiState !== AI_STATES.ATTACK) return;
  if (!playerPosition) return;

  // Guard 1: a mob that was itself recruited does not recruit. Without this, every
  // other guard only slows the cascade down instead of stopping it.
  if (mob.recruitedByPack) return;

  let engaged = countEngagedMobs(otherMobs);
  if (engaged >= MAX_ENGAGED_MOBS) return;

  const members = detectPackMembers(mob, otherMobs);
  let recruited = 0;

  for (const member of members) {
    if (recruited >= MAX_PACK_RECRUITS) break;
    if (engaged >= MAX_ENGAGED_MOBS) break;
    if (member.aiState !== AI_STATES.IDLE && member.aiState !== AI_STATES.WANDER) continue;

    // Guard 2: close enough to the player that it could nearly have aggroed alone.
    const reach = (member.definition.ai.aggroRange || 0) * PACK_RECRUIT_RANGE_FACTOR;
    if (member.distanceTo(playerPosition) > reach) continue;

    member.targetEntity = playerPosition;
    member.aiState = AI_STATES.CHASE;
    member.recruitedByPack = true;
    recruited++;
    engaged++;
  }
}
