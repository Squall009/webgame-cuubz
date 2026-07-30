/**
 * Cuubz — Death Animations
 * Shared death sequences: collapse, crumble, dissolve.
 */

/**
 * Collapse death — rotate 90 degrees and fade out.
 * For organic mobs (deer, rabbit, wolf).
 * @param {THREE.Group} group
 * @param {number} progress - 0 to 1
 */
export function collapseDeath(group, progress) {
  // Fall over sideways
  group.rotation.x = progress * Math.PI / 2;
  group.rotation.z = progress * 0.1;

  // Fade out in last 50%
  if (progress > 0.5) {
    const fade = 1 - (progress - 0.5) / 0.5;
    group.traverse(child => {
      if (child.isMesh && child.material) {
        child.material.transparent = true;
        child.material.opacity = fade;
      }
    });
  }
}

/**
 * Crumble death — scale oscillates and shrinks, sinks into ground.
 * For golem/stone mobs.
 * @param {THREE.Group} group
 * @param {number} progress - 0 to 1
 */
export function crumbleDeath(group, progress) {
  // Sink into ground
  const sink = progress * 0.5;
  group.position.y -= sink;

  // Scale oscillations (cracking apart)
  const shake = Math.sin(progress * 30) * (1 - progress) * 0.03;
  group.position.x += shake;
  group.position.z += shake;

  // Overall shrink
  const scale = 1 - progress * 0.3;
  group.scale.set(scale, scale, scale);

  // Fade out in last 40%
  if (progress > 0.6) {
    const fade = 1 - (progress - 0.6) / 0.4;
    group.traverse(child => {
      if (child.isMesh && child.material) {
        child.material.transparent = true;
        child.material.opacity = fade;
      }
    });
  }
}

/**
 * Dissolve death — float upward with fade, for energy/wisp mobs.
 * @param {THREE.Group} group
 * @param {number} progress - 0 to 1
 */
export function dissolveDeath(group, progress) {
  // Float upward
  group.position.y += 0.3 * group.userData.deltaTime || 0.016;

  // Rotation (spinning out)
  group.rotation.y += 0.05;

  // Scale shrink
  const scale = 1 - progress;
  group.scale.set(scale, scale, scale);

  // Fade
  const fade = 1 - progress;
  group.traverse(child => {
    if (child.isMesh && child.material) {
      child.material.transparent = true;
      child.material.opacity = fade;
    }
  });
}
