/**
 * Cuubz — Hop Cycle Animation
 * For rabbit-like mobs that hop instead of walking.
 * All transforms are applied RELATIVE to initial (reset) pose.
 */

/**
 * Apply a hop cycle to a mob's render group.
 * @param {THREE.Group} group
 * @param {number} time - Accumulated animation time
 * @param {number} speed - Animation speed multiplier
 */
export function hopCycle(group, time, speed) {
  const parts = group.userData.parts;
  const init = group.userData.initialTransforms;
  if (!parts) return;

  const t = time * speed;
  const hopPhase = (t * 3.0) % (Math.PI * 2);

  // ── Vertical hop (relative to initial Y) ──
  const hopHeight = Math.max(0, Math.sin(hopPhase)) * 0.2;

  const body = parts.body;
  if (body) {
    const baseY = init && init[body.name] ? init[body.name].position.y : 0;
    body.position.y = baseY + hopHeight;

    // Body compression/stretch (relative to initial scale)
    const baseScale = init && init[body.name] ? init[body.name].scale.y : 1;
    const compression = 1 - Math.sin(hopPhase) * 0.15;
    body.scale.y = baseScale * compression;
    body.scale.z = baseScale * (1 + (1 - compression) * 0.5);
  }

  // ── Back legs tuck (relative to initial Y) ──
  if (parts.leg_BL) {
    const tuck = Math.max(0, Math.sin(hopPhase)) * 0.15;
    const baseY = init && init['leg_BL'] ? init['leg_BL'].position.y : 0;
    parts.leg_BL.position.y = baseY - tuck;
  }
  if (parts.leg_BR) {
    const tuck = Math.max(0, Math.sin(hopPhase)) * 0.15;
    const baseY = init && init['leg_BR'] ? init['leg_BR'].position.y : 0;
    parts.leg_BR.position.y = baseY - tuck;
  }

  // ── Ears flop (relative to initial rotation) ──
  if (parts.ear_L) {
    const baseZ = init && init['ear_L'] ? init['ear_L'].rotation.z : 0;
    parts.ear_L.rotation.z = baseZ + Math.sin(hopPhase) * 0.15;
  }
  if (parts.ear_R) {
    const baseZ = init && init['ear_R'] ? init['ear_R'].rotation.z : 0;
    parts.ear_R.rotation.z = baseZ - Math.sin(hopPhase) * 0.15;
  }

  // ── Front legs subtle bounce (relative to initial Y) ──
  if (parts.leg_FL) {
    const baseY = init && init['leg_FL'] ? init['leg_FL'].position.y : 0;
    parts.leg_FL.position.y = baseY + Math.sin(hopPhase) * 0.03;
  }
  if (parts.leg_FR) {
    const baseY = init && init['leg_FR'] ? init['leg_FR'].position.y : 0;
    parts.leg_FR.position.y = baseY + Math.sin(hopPhase) * 0.03;
  }
}
