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
        const maxDist = 7;
        const hit = mobManager.raycastMobs(origin, direction, maxDist);
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

          // Apply damage and knockback
          hit.mob.takeDamage(damage, 'player_attack');
          const dx = hit.mob.position.x - state.player.position.x;
          const dz = hit.mob.position.z - state.player.position.z;
          const dist = Math.sqrt(dx*dx + dz*dz) || 1;
          // D-101: was `hit.mob.knockback(...)`, which is a NUMBER — the constructor's
          // `this.knockback = def.knockback || 0` shadows the method of the same name. This
          // threw on every single hit, and the throw is why the two lines below it never
          // ran: no hand swing, and `_attackOverride` never set, so attacking a mob also
          // broke the block behind it. Silenced after frame 10 by the catch below.
          hit.mob.applyKnockback(dx/dist, dz/dist, 0.5 + damage * 0.1);

          // Trigger hand swing animation
          if (state.firstPersonHand) state.firstPersonHand.swing();

          // Prevent block breaking this frame (mob attack takes priority)
          if (state.blockInteraction) state.blockInteraction._attackOverride = true;
        }
      }
    } catch(e) {
      if (state.frameCount < 10) console.warn('[Cuubz] Mob attack error:', e.message);
    }
  }

  // Update mouse input (clears just-clicked flags) — AFTER blockInteraction and mob attack read them
  state.mouse.update();
}
