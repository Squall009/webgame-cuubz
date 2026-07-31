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
  // Intended: float upward at 0.3 units/second.
  //
  // D-88, the arithmetic: this was `group.position.y += 0.3 * group.userData.deltaTime || 0.016;`,
  // which parses as `(0.3 * deltaTime) || 0.016` — `*` binds tighter than `||`. The fallback
  // was therefore not a frame time at all: whenever `deltaTime` was missing (or 0), the mob
  // was displaced by a flat 0.016 *units* that frame instead of `0.3 * 0.016` units, ~21x
  // too far, and the intended 0.3 rate did not apply to it. The parenthesised form below is
  // the rate-times-time the line always claimed to be.
  //
  // D-88, the ordering — WHY THIS STILL DOES NOT MOVE ANYTHING ON SCREEN:
  // `MobRenderer.update()` assigns `group.position` from `mob.position` on the line
  // immediately before it calls `animator.update()`, every frame. So this `+=`, and
  // `crumbleDeath`'s sink and shake, and `hurtReaction`'s recoil, are all overwritten before
  // anything renders — a dissolving mob does not actually rise. That is a separate,
  // pre-existing defect with a design question behind it (do animations own an offset from
  // the data-model position, or the position itself?) and it is NOT one of D-88's three
  // clear-cut fixes. It is recorded here rather than fixed so the arithmetic above is not
  // mistaken for a claim about what the player sees. The scale, rotation, opacity and
  // emissive channels are unaffected — nothing resyncs those from the data model, which is
  // why the fade and shrink below do render.
  const dt = group.userData.deltaTime || 0.016;
  group.position.y += 0.3 * dt;

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
