/**
 * Cuubz — Hurt Animation
 * Shared hurt reaction: red flash, recoil push back.
 *
 * ─── D-88: THIS IS THE ONE ANIMATION THAT WRITES TO `material` ──────────────
 *
 * Every other animation in `animTypes/` writes to `group.userData.parts[*].position` /
 * `.rotation` / `.scale`, and `MobAnimator._resetToInitialPose()` rewinds all of that at
 * the top of every frame. That is why nothing else here needs cleanup and nothing else
 * leaks. `hurtReaction` writes `material.emissive` and `material.emissiveIntensity`, which
 * no per-frame reset touches, so its undo has to be explicit.
 *
 * That undo used to live in an `if (progress >= 1)` branch at the bottom of this function,
 * and it fired only because `MobAnimator` was feeding in a permanently-1 progress — the
 * very defect D-88 fixed. With a correct clock, progress can NEVER reach 1 while the state
 * is still HURT: `mob.takeDamage()` arms `hurtTimer` to the animation's own duration
 * (`mob.js:136`), `mob.update()` clears HURT the instant `hurtTimer <= 0` (`mob.js:103`),
 * and `mobManager.update()` runs every `mob.update()` BEFORE `renderer.update()` — so on
 * the frame the timer expires the animator already sees a non-HURT state and never
 * dispatches here again. `stone_golem` is not even close: `speed: 0.5, duration: 0.4` means
 * the animator clock only reaches progress ≈ 0.5 before the timer runs out, at any frame
 * rate. It would have been left glowing red permanently after one hit.
 *
 * So the undo moved OUT of this function and into `MobAnimator._onStateExit()`, below, as
 * `clearHurtReaction`. This function now only ever applies the effect; the animator owns
 * taking it off.
 */

import * as THREE from 'three';

/**
 * Apply hurt reaction to a mob's render group.
 *
 * Leaves `_origEmissive` / `_origEmissiveIntensity` banked on each material. Those are
 * CONSUMED by `clearHurtReaction` and deleted there, so the next hit re-banks from clean
 * values — which is what keeps the `emissive.getHex() !== 0` test below meaning "this part
 * is designed to glow" rather than "this part is still red from the last hit".
 *
 * @param {THREE.Group} group
 * @param {number} progress - 0 to 1 animation progress
 */
export function hurtReaction(group, progress) {
  // Red emissive flash (4 rapid pulses)
  const flashIntensity = Math.sin(progress * Math.PI * 8) > 0 ? 0.5 : 0;

  group.traverse(child => {
    if (!child.isMesh || !child.material) return;
    const mat = child.material;

    // D-104: a material that does not ALREADY have `emissive` must never be given one.
    //
    // This used to add the property to any material that lacked it — every
    // `MeshBasicMaterial`, i.e. the eye meshes from `mobModelBuilder` — on the theory that
    // it was harmless because the basic shader never reads it. It is not harmless. Three
    // r134's `refreshUniformsCommon` (three.module.js:24534) branches on the MATERIAL:
    //
    //     if ( material.emissive ) uniforms.emissive.value.copy( material.emissive )...
    //
    // `ShaderLib.basic` has no `emissive` uniform, so `uniforms.emissive` is undefined and
    // that line threw `Cannot read properties of undefined (reading 'value')` out of
    // `renderBufferDirect` — every hit on a mob killed the whole render loop. The eyes
    // simply do not flash now; they are 0x000000 spheres a few pixels across.
    if (!mat.emissive) return;

    if (!mat._origEmissive) {
      mat._origEmissive = mat.emissive.clone();
      mat._origEmissiveIntensity = mat.emissiveIntensity || 0;
    }
    // Check for emissive parts - they get boosted red
    if (mat.emissive.getHex() !== 0) {
      // Emissive parts: mix red into their glow
      mat.emissive.setHex(0xff2200);
    } else if (flashIntensity > 0) {
      // Non-emissive parts: brief red flash
      mat.emissive = new THREE.Color(0xff0000);
    }
    mat.emissiveIntensity = flashIntensity;
  });

  // Recoil push back (first 40% of animation).
  //
  // D-88 (recorded, not fixed here): this cannot actually move the mob.
  // `MobRenderer.update()` assigns `group.position` from `mob.position` on the line
  // immediately before it calls `animator.update()`, so the `+=` below is overwritten on
  // the next frame before anything renders. Same for `dissolveDeath`'s float and
  // `crumbleDeath`'s sink. Fixing that means deciding whether animations own an offset from
  // the data-model position or the position itself, which is a renderer design question and
  // is NOT part of D-88's three clear-cut defects. The emissive flash above is unaffected —
  // materials are not resynced from the data model.
  if (progress < 0.4) {
    const push = -(progress / 0.4) * 0.1;
    group.position.z += push;
  }
}

/**
 * Undo everything `hurtReaction` wrote to the materials of `group`.
 *
 * Called by `MobAnimator._onStateExit()` when the mob leaves HURT — by the timer expiring,
 * by dying, or by any other transition — and by the animator when a mob is hit AGAIN while
 * already in HURT, so the restart re-banks from restored values rather than from red ones.
 *
 * Idempotent and null-safe by construction:
 *   • it restores only from a banked `_origEmissive`, and DELETES the bank as it goes, so a
 *     second call is a no-op rather than a second restore from stale values;
 *   • every access is guarded, so it cannot throw on a mesh whose material has been
 *     replaced or removed.
 *
 * On disposed materials: `MobRenderer.removeMob()` disposes materials and then drops the
 * render object, so the animator that owns them is never updated again and this function is
 * never reached with a disposed material. It is written to be harmless if that ever changes
 * — `dispose()` in three r134 frees GPU-side resources and dispatches an event; it does not
 * poison `material.emissive`, so a restore would write to a live JS object that nothing
 * renders. It cannot resurrect anything, because the mesh is already out of the scene.
 *
 * @param {THREE.Group} group
 */
export function clearHurtReaction(group) {
  if (!group || typeof group.traverse !== 'function') return;

  group.traverse(child => {
    if (!child.isMesh || !child.material) return;
    const mat = child.material;
    if (!mat._origEmissive) return; // never flashed, or already cleared — nothing to undo

    // D-104: there used to be an `_origEmissiveAbsent` branch here that `delete`d `emissive`
    // and `emissiveIntensity` off materials `hurtReaction` had added them to. It is gone
    // with the thing it undid — `hurtReaction` now skips those materials outright, so a
    // banked `_origEmissive` only ever exists on a material that had one to begin with.
    mat.emissive = mat._origEmissive;
    mat.emissiveIntensity = mat._origEmissiveIntensity;
    delete mat._origEmissive;
    delete mat._origEmissiveIntensity;
  });
}
