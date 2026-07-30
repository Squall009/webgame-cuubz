/**
 * Cuubz — Body Language Animations
 * Shared idle subtleties: breathing, twitching, rocking, hovering.
 * All transforms are applied RELATIVE to initial (reset) pose.
 */

/**
 * Gentle breathing idle — body rises/falls, head sways slightly.
 */
export function breathingIdle(group, time) {
  const parts = group.userData.parts;
  const init = group.userData.initialTransforms;
  if (!parts) return;

  const breath = Math.sin(time * 2.0) * 0.015;

  const body = parts.body || parts.torso;
  if (body) {
    const baseY = init && init[body.name] ? init[body.name].position.y : 0;
    body.position.y = baseY + breath;
  }

  if (parts.head) {
    const baseRotY = init && init['head'] ? init['head'].rotation.y : 0;
    const baseRotX = init && init['head'] ? init['head'].rotation.x : 0;
    parts.head.rotation.y = baseRotY + Math.sin(time * 0.5) * 0.1;
    parts.head.rotation.x = baseRotX + Math.sin(time * 0.7) * 0.03;
  }

  if (parts.tail) {
    const baseY = init && init['tail'] ? init['tail'].rotation.y : 0;
    parts.tail.rotation.y = baseY + Math.sin(time * 1.2) * 0.05;
  }
}

/**
 * Twitch idle — small quick movements for small animals.
 */
export function twitchIdle(group, time) {
  const parts = group.userData.parts;
  const init = group.userData.initialTransforms;
  if (!parts) return;

  if (parts.ear_L) {
    const baseZ = init && init['ear_L'] ? init['ear_L'].rotation.z : 0;
    parts.ear_L.rotation.z = baseZ + Math.sin(time * 3.7) * 0.1;
  }
  if (parts.ear_R) {
    const baseZ = init && init['ear_R'] ? init['ear_R'].rotation.z : 0;
    parts.ear_R.rotation.z = baseZ - Math.sin(time * 3.7) * 0.1;
  }

  if (parts.snout) {
    const baseZ = init && init['snout'] ? init['snout'].scale.z : 1;
    const twitch = Math.sin(time * 8.0) * 0.02;
    parts.snout.scale.z = baseZ + twitch;
  }

  if (parts.tail) {
    const baseY = init && init['tail'] ? init['tail'].rotation.y : 0;
    parts.tail.rotation.y = baseY + Math.sin(time * 2.3) * 0.1;
  }

  const body = parts.body;
  if (body) {
    const baseZ = init && init[body.name] ? init[body.name].rotation.z : 0;
    body.rotation.z = baseZ + Math.sin(time * 1.1) * 0.02;
  }
}

/**
 * Rocking idle — slow, heavy sway for large creatures.
 */
export function rockingIdle(group, time) {
  const parts = group.userData.parts;
  const init = group.userData.initialTransforms;
  if (!parts) return;

  const rock = Math.sin(time * 0.8) * 0.04;

  const body = parts.body || parts.torso;
  if (body) {
    const baseZ = init && init[body.name] ? init[body.name].rotation.z : 0;
    const baseX = init && init[body.name] ? init[body.name].rotation.x : 0;
    body.rotation.z = baseZ + rock;
    body.rotation.x = baseX + Math.sin(time * 0.5) * 0.02;
  }

  if (parts.head) {
    const baseZ = init && init['head'] ? init['head'].rotation.z : 0;
    const baseY = init && init['head'] ? init['head'].rotation.y : 0;
    parts.head.rotation.z = baseZ - rock * 0.5;
    parts.head.rotation.y = baseY + Math.sin(time * 0.6) * 0.08;
  }

  if (parts.arm_L) {
    const baseX = init && init['arm_L'] ? init['arm_L'].rotation.x : 0;
    parts.arm_L.rotation.x = baseX + Math.sin(time * 0.7) * 0.05;
  }
  if (parts.arm_R) {
    const baseX = init && init['arm_R'] ? init['arm_R'].rotation.x : 0;
    parts.arm_R.rotation.x = baseX - Math.sin(time * 0.7) * 0.05;
  }
}

/**
 * Hover idle — gentle figure-8 motion + bobbing for flying mobs.
 */
export function hoverIdle(group, time) {
  const parts = group.userData.parts;
  const init = group.userData.initialTransforms;
  if (!parts) return;

  const bob = Math.sin(time * 1.5) * 0.05;

  const body = parts.body || parts.torso || parts.core;
  if (body) {
    const baseY = init && init[body.name] ? init[body.name].position.y : 0;
    const baseZ = init && init[body.name] ? init[body.name].rotation.z : 0;
    const baseX = init && init[body.name] ? init[body.name].rotation.x : 0;
    body.position.y = baseY + bob;
    body.rotation.z = baseZ + Math.sin(time * 0.7) * 0.05;
    body.rotation.x = baseX + Math.sin(time * 0.9) * 0.03;
  }

  // Orbiting particles (relative to initial positions)
  if (parts.particle_1) {
    const baseX = init && init['particle_1'] ? init['particle_1'].position.x : 0;
    const baseZ = init && init['particle_1'] ? init['particle_1'].position.z : 0;
    const orbitRadius = Math.sqrt(baseX * baseX + baseZ * baseZ) || 0.3;
    const angle = Math.atan2(baseZ, baseX) + time * 2.0;
    parts.particle_1.position.x = Math.cos(angle) * orbitRadius;
    parts.particle_1.position.z = Math.sin(angle) * orbitRadius;
  }
  if (parts.particle_2) {
    const baseX = init && init['particle_2'] ? init['particle_2'].position.x : 0;
    const baseZ = init && init['particle_2'] ? init['particle_2'].position.z : 0;
    const orbitRadius = Math.sqrt(baseX * baseX + baseZ * baseZ) || 0.25;
    const angle = Math.atan2(baseZ, baseX) + time * 2.0 + 2.1;
    parts.particle_2.position.x = Math.cos(angle) * orbitRadius;
    parts.particle_2.position.z = Math.sin(angle) * orbitRadius;
  }
  if (parts.particle_3) {
    const baseX = init && init['particle_3'] ? init['particle_3'].position.x : 0;
    const baseY = init && init['particle_3'] ? init['particle_3'].position.y : 0.45;
    const baseZ = init && init['particle_3'] ? init['particle_3'].position.z : 0;
    const orbitRadius = Math.sqrt(baseX * baseX + baseZ * baseZ) || 0.2;
    const angle = Math.atan2(baseZ, baseX) + time * 1.5 + 1.0;
    parts.particle_3.position.x = Math.cos(angle) * orbitRadius;
    parts.particle_3.position.y = baseY + Math.sin(time * 1.5) * 0.1;
    parts.particle_3.position.z = Math.sin(angle) * orbitRadius;
  }
}
