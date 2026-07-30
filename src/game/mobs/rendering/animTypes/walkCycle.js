/**
 * Cuubz — Walk Cycle Animation
 * Generates leg-swinging walk animations for 4-legged and 2-legged mobs.
 * All transforms are applied RELATIVE to initial (reset) pose.
 */

/**
 * Apply a walk cycle to a mob's render group.
 * @param {THREE.Group} group
 * @param {number} time - Accumulated animation time
 * @param {number} speed - Animation speed multiplier
 * @param {string} gait - 'trot' | 'gallop' | 'stomp'
 */
export function walkCycle(group, time, speed, gait) {
  const parts = group.userData.parts;
  const init = group.userData.initialTransforms;
  if (!parts) return;

  const t = time * speed;
  const legSwing = gait === 'stomp' ? 0.3 : 0.4;
  const bodyBob = gait === 'stomp' ? 0.08 : 0.04;

  // ── Legs: diagonal pair swing (relative to initial rotation) ──
  if (parts.leg_FL && parts.leg_BR) {
    const swing1 = Math.sin(t * 4.0) * legSwing;
    parts.leg_FL.rotation.x = swing1;
    parts.leg_BR.rotation.x = swing1;

    if (parts.leg_FR && parts.leg_BL) {
      const swing2 = Math.sin(t * 4.0 + Math.PI) * legSwing;
      parts.leg_FR.rotation.x = swing2;
      parts.leg_BL.rotation.x = swing2;
    }
  }

  // ── Body vertical bob (relative to initial Y) ──
  const body = parts.body || parts.torso;
  if (body) {
    const baseY = init && init[body.name] ? init[body.name].position.y : 0;
    const bob = Math.abs(Math.sin(t * 4.0)) * bodyBob;
    body.position.y = baseY + bob;

    // Stomp gait: extra body drop on each step
    if (gait === 'stomp') {
      const drop = Math.abs(Math.cos(t * 4.0)) * 0.04;
      body.position.y = baseY + bob - drop;
    }
  }

  // ── Tail sway (relative to initial rotation) ──
  if (parts.tail) {
    const baseRotY = init && init['tail'] ? init['tail'].rotation.y : 0;
    parts.tail.rotation.y = baseRotY + Math.sin(t * 3.0) * 0.2;
  }

  // ── Head bob (relative to initial Y) ──
  if (parts.head) {
    const baseY = init && init['head'] ? init['head'].position.y : 0;
    parts.head.position.y = baseY + Math.sin(t * 4.0) * 0.01;
  }
}
