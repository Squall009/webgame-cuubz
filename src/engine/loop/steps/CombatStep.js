/**
 * Cuubz — render-loop step 4: combat (PR 18)
 *
 * `src/main.js:521–575`, verbatim. The left-click mob raycast and, at the end,
 * `state.mouse.update()`.
 *
 * The `mouse.update()` at the bottom is the reason this step exists as its own unit:
 * it clears the just-clicked flags, and both `ViewStep`'s `blockInteraction.update()`
 * and the raycast below read them first. Nothing may be inserted between the raycast
 * and that call.
 *
 * PR 33 / D-27 removed the `typeof NAMED_ITEMS !== 'undefined' &&` half of the weapon
 * lookup below. `NAMED_ITEMS` is a module import, so the guard was constant-true; the
 * `NAMED_ITEMS[item.typeId]` lookup it short-circuited is the whole expression now.
 */

import * as THREE from 'three';
import { NAMED_ITEMS } from '../../../game/systems/InventorySystem.js';
import { reportStepError } from '../reportStepError.js';

/**
 * How far the player's swing reaches, in blocks. The same 7 as
 * `BlockInteraction.breakRange` and `placeRange` — one arm's length for everything.
 *
 * **S11 — exported because it is the other half of every boss's melee range.** A boss
 * whose melee range is below this can be hit from a distance at which it cannot hit back;
 * a boss whose range is above it can never be safely approached. All six were well below
 * it, so every boss in the game could be beaten by standing at six blocks and clicking.
 * `test/unit/game/bossBalance.test.js` binds to this rather than transcribing a 7.
 */
export const PLAYER_ATTACK_REACH = 7;

/**
 * @param {import('../../../core/GameState.js').GameState} state
 */
export function combatStep(state) {
  // ─── Player Attack Mobs (Left Click) ────────────────
  // Uses mouse.leftClick (held state) so holding left-click
  // repeatedly attacks mobs with a cooldown between hits.
  // The cooldown is based on the weapon's attack speed.
  // Must run BEFORE mouse.update() clears justClickedLeft.
  if (state.mobIntegration && state.mouse && state.mouse.leftClick && state.renderer.camera && state.attackCooldown <= 0) {
    try {
      const mobManager = state.mobIntegration.getManager();
      if (mobManager) {
        const origin = state.renderer.camera.position;
        const direction = new THREE.Vector3();
        state.renderer.camera.getWorldDirection(direction);
        const hit = mobManager.raycastMobs(origin, direction, PLAYER_ATTACK_REACH);
        if (hit) {
          // Get attack damage
          const damage = state.inventory.getAttackDamage();

          // Calculate cooldown from weapon attack speed
          // Minecraft base = 4.0 attacks/sec, weapon attackSpeed is a modifier
          // e.g. sword: -2.4 → actual = 1.6 att/sec → cooldown = 0.625s
          let attackCooldown = 0.25; // Default fist speed (4 att/sec)
          const item = state.inventory.getSelectedItem();
          if (item && typeof item.typeId === 'string') {
            const def = NAMED_ITEMS[item.typeId];
            if (def && def.attackSpeed !== undefined) {
              const actualSpeed = 4.0 + def.attackSpeed;
              if (actualSpeed > 0) {
                attackCooldown = 1.0 / actualSpeed;
              }
            }
          }
          state.attackCooldown = attackCooldown;

          // ─── A boss is not damaged locally (S6, §6.4) ──────────────────
          //
          // `hit.mob` is the drawn mob; the authority is the `BossEntity` behind it,
          // and on a guest that lives on someone else's machine entirely. So a hit on
          // a boss is *reported*, never applied here — `BossSync.reportHit` calls the
          // host's runner directly on a host and sends `BOSS_HIT` on a guest. Applying
          // it locally as well would double-count the host's own swings and would show
          // a guest a health bar the host does not agree with.
          const bossMob = state.bossSync ? state.bossSync.bossMob : null;
          const hostBossMob = state.bossEncounter ? state.bossEncounter.bossMob : null;
          const isBoss = hit.mob === bossMob || hit.mob === hostBossMob;

          if (isBoss) {
            // Reported, not applied. A boss takes no knockback either — a four-tonne
            // Dune Colossus that could be shoved out of its own arena is not a boss.
            state.bossSync.reportHit(damage, state.player.position);
          } else {
            // Apply damage and knockback
            hit.mob.takeDamage(damage, 'player_attack');
            const dx = hit.mob.position.x - state.player.position.x;
            const dz = hit.mob.position.z - state.player.position.z;
            const dist = Math.sqrt(dx*dx + dz*dz) || 1;
            // D-101: was `hit.mob.knockback(...)`, which is a NUMBER — the constructor's
            // `this.knockback = def.knockback || 0` shadows the method of the same name. This
            // threw on every single hit, and the throw is why the two lines below it never
            // ran: no hand swing, and `_attackOverride` never set, so attacking a mob also
            // broke the block behind it. Reported once by the catch below — D-89 turned
            // that catch from "silent after frame 10" into a one-shot latch.
            hit.mob.applyKnockback(dx/dist, dz/dist, 0.5 + damage * 0.1);
          }

          // Trigger hand swing animation
          if (state.firstPersonHand) state.firstPersonHand.swing();

          // Prevent block breaking this frame (mob attack takes priority)
          if (state.blockInteraction) state.blockInteraction._attackOverride = true;
        }
      }
    } catch (e) {
      reportStepError(state, 'Mob attack', e);
    }
  }

  // Update mouse input (clears just-clicked flags) — AFTER blockInteraction and mob attack read them
  state.mouse.update();
}
