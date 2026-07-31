/**
 * Cuubz — Mob Animator
 * Main animation controller that ties all animation types together.
 * Manages per-state animation functions and crossfades between states.
 */

import { AI_STATES, ANIM_TYPES } from '../mobDefinitions.js';
import { chargeAttack, lungeAttack, slamAttack } from './animTypes/attackAnim.js';
import { breathingIdle, hoverIdle, rockingIdle, twitchIdle } from './animTypes/bodyLanguage.js';
import { collapseDeath, crumbleDeath, dissolveDeath } from './animTypes/deathAnim.js';
import { hopCycle } from './animTypes/hopCycle.js';
import { clearHurtReaction, hurtReaction } from './animTypes/hurtAnim.js';
import { walkCycle } from './animTypes/walkCycle.js';

export class MobAnimator {
  /**
   * @param {Mob} mob - The mob data model
   * @param {THREE.Group} renderGroup - The mob's 3D model group
   */
  constructor(mob, renderGroup) {
    this.mob = mob;
    this.group = renderGroup;
    this.animationTime = 0;
    this.currentState = mob.aiState;

    // ─── D-88: WHY THERE ARE TWO CLOCKS ──────────────────────────────────────
    //
    // `animationTime` is the animator's MONOTONIC LIFETIME: it only ever accumulates, and
    // that is exactly what the looping animations want — `walkCycle`, `hopCycle` and the
    // idles are periodic functions of it, so resetting it would visibly snap a mob's gait
    // every time it changed state.
    //
    // The one-shot animations want the opposite. `_animateAttack` and `_animateHurt`
    // compute `progress = time / duration` against a duration of 0.2–0.8 s, and they used
    // to be handed `animationTime * speed`. Any mob that had been alive for longer than its
    // own attack duration — i.e. every mob, about a third of a second after spawning —
    // therefore saw `progress === 1` on the very first frame of the state and on every
    // frame after it. `lungeAttack`/`slamAttack`/`chargeAttack` at progress 1 are their own
    // end pose (the recovery lerp has completed), and `hurtReaction` at progress >= 1 runs
    // its "reset after completion" branch, which restores the original emissive. So **no
    // attack animation had ever played and the red hurt flash had never appeared**;
    // D-77 kept it invisible until PR 33 turned mob rendering on.
    //
    // `_animateDeath` already had the right shape — it banks `_deathStartTime` and
    // subtracts it. This is the same thing, generalised: DEAD is terminal so a one-time
    // `undefined` check is enough for it, but ATTACK and HURT are re-entered (chase →
    // attack → chase → attack), so the stamp has to be re-taken on every state entry. It is
    // taken in `update()`, in the branch that already detects the transition, before any
    // animation function is dispatched.
    this._stateStartTime = 0;

    // ─── D-88: AND WHY THERE IS A STATE-EXIT HOOK ────────────────────────────
    //
    // Giving the one-shots a correct clock has a consequence: `progress` can no longer
    // reach 1 while the state is still live. `mob.takeDamage()` arms `hurtTimer` to the
    // hurt animation's own duration, `mob.update()` clears HURT the instant that timer
    // hits 0, and `mobManager.update()` runs every `mob.update()` BEFORE `renderer.update()`
    // — so the frame the timer expires, this animator already sees a different state.
    //
    // That matters for exactly one animation. `hurtReaction` is the only one that writes to
    // `material` instead of to parts, and its undo used to sit in an `if (progress >= 1)`
    // branch that only ever fired BECAUSE the clock was broken. A correct clock therefore
    // removed the only caller of the cleanup, which would have left `stone_golem` glowing
    // red permanently after one hit and stripped `corrupt_wisp` of its designed 0x8b00ff
    // emissive. The undo now runs from `_onStateExit`, below.
    //
    // `_lastHurtTimer` is how a SECOND hit landing while the mob is still in HURT is
    // noticed: the state does not change, so the transition branch cannot see it, but
    // `takeDamage` re-arms `hurtTimer` to the full duration, and a timer that goes UP is a
    // new hit. Nothing else in `src/` raises it.
    this._lastHurtTimer = mob.hurtTimer || 0;

    // Crossfade state
    this.previousState = null;
    this.transitionProgress = 1; // 1 = fully transitioned
    this.transitionDuration = 0.15; // 150ms crossfade
    this.snapshotTransforms = null; // Save of transforms at transition start

    // DeltaTime for death animations
    this.group.userData.deltaTime = 0.016;
  }

  /**
   * Update the animation for one frame.
   * @param {number} deltaTime - Seconds since last frame
   */
  update(deltaTime) {
    this.animationTime += deltaTime;
    this.group.userData.deltaTime = deltaTime;

    const state = this.mob.aiState;
    const animDef = this.mob.definition.animations && this.mob.definition.animations[state];

    // ── Reset all parts to initial transforms ──
    this._resetToInitialPose();

    // ── Detect state change and start crossfade ──
    if (state !== this.currentState) {
      // D-88: take off anything the state we are LEAVING wrote outside the part
      // transforms, before the new state's animation writes anything. Covers the mob that
      // was hit once and left alone (HURT → IDLE/CHASE when `hurtTimer` expires) and the
      // mob that dies mid-flash (HURT → DEAD), which is the same transition as far as this
      // is concerned — the death animations fade `opacity`, and a stuck red `emissive`
      // would fade with them.
      this._onStateExit(this.currentState);

      this.previousState = this.currentState;
      this.currentState = state;
      this.transitionProgress = 0;
      // D-88: restart the one-shot clock. See the constructor note.
      this._stateStartTime = this.animationTime;

      // Snapshot current transforms for blend
      this.snapshotTransforms = this._captureTransforms();
    } else if (state === AI_STATES.HURT && (this.mob.hurtTimer || 0) > this._lastHurtTimer) {
      // D-88: hit AGAIN while still in HURT. The state did not change, so the branch above
      // cannot see it, but `takeDamage` re-armed `hurtTimer` to the full duration and the
      // data model is treating this as a fresh hurt (it zeroes `mob.animationTimer` too).
      //
      // The flash SHOULD restart, and not restarting is not a neutral choice: the clock
      // would keep running from the first hit, `progress` would clamp to 1 for the rest of
      // the extended window, and `sin(1 * 8π)` is 0 — so the second hit would render no
      // flash at all, which is the opposite of what a second hit should look like.
      //
      // Clearing first is what keeps the re-bank honest: `hurtReaction` banks
      // `_origEmissive` on the first material it sees without one, so re-banking on top of
      // a still-red material would record red as the original and make it permanent.
      clearHurtReaction(this.group);
      this._stateStartTime = this.animationTime;
    }

    // Sampled every frame, not just in the branches above, so the comparison is always
    // against the previous frame. Falls back to 0 for a mob whose definition has no hurt
    // animation — `takeDamage` never sets the field on those.
    this._lastHurtTimer = this.mob.hurtTimer || 0;

    // ── Apply state-specific animation ──
    if (state === AI_STATES.DEAD) {
      this._animateDeath(deltaTime);
    } else {
      this._animateState(state, animDef, deltaTime);
    }

    // ── Crossfade: blend between previous state snapshot and current ──
    if (this.transitionProgress < 1 && this.previousState && this.snapshotTransforms) {
      this.transitionProgress = Math.min(1, this.transitionProgress + deltaTime / this.transitionDuration);

      // Blend all parts
      for (const [id, mesh] of Object.entries(this.group.userData.parts || {})) {
        if (this.snapshotTransforms[id]) {
          const snap = this.snapshotTransforms[id];
          const t = this.transitionProgress;
          mesh.position.lerpVectors(snap.position, mesh.position, t);
          mesh.rotation.x = snap.rotation.x + (mesh.rotation.x - snap.rotation.x) * t;
          mesh.rotation.y = snap.rotation.y + (mesh.rotation.y - snap.rotation.y) * t;
          mesh.rotation.z = snap.rotation.z + (mesh.rotation.z - snap.rotation.z) * t;
        }
      }
    }
  }

  /**
   * Undo whatever the state being left wrote OUTSIDE the part transforms (D-88).
   *
   * `_resetToInitialPose()` already rewinds `position` / `rotation` / `scale` on every part
   * at the top of every frame, so an animation that only moves parts needs nothing here —
   * which is every animation except `hurtReaction`, the only one that writes to `material`.
   * If a future animation writes to materials, its undo belongs in this switch and not in a
   * progress threshold inside the animation itself; a threshold is only reachable if the
   * state outlives the animation, and `mob.update()` guarantees it does not.
   *
   * Deliberately NOT called from a teardown path: `MobRenderer.removeMob()` takes the group
   * out of the scene, disposes its geometries and materials and drops the render object, so
   * a mob despawned mid-flash never renders again and has nothing to restore. Calling this
   * from there would write to materials that were just disposed. `clearHurtReaction` is
   * written to be harmless if it happens anyway — see its header.
   *
   * @param {string|null} previousState - The state being left.
   */
  _onStateExit(previousState) {
    if (previousState === AI_STATES.HURT) {
      clearHurtReaction(this.group);
    }
  }

  /**
   * Reset all mesh parts to their initial transforms.
   */
  _resetToInitialPose() {
    const init = this.group.userData.initialTransforms;
    const parts = this.group.userData.parts;
    if (!init || !parts) return;

    for (const [id, mesh] of Object.entries(parts)) {
      if (init[id]) {
        mesh.position.copy(init[id].position);
        mesh.rotation.copy(init[id].rotation);
        mesh.scale.copy(init[id].scale);
      }
    }
  }

  /**
   * Capture current transforms of all parts for crossfade blending.
   * @returns {object} { partId: { position, rotation, scale } }
   */
  _captureTransforms() {
    const snapshot = {};
    const parts = this.group.userData.parts;
    if (!parts) return snapshot;

    for (const [id, mesh] of Object.entries(parts)) {
      snapshot[id] = {
        position: mesh.position.clone(),
        rotation: mesh.rotation.clone(),
        scale: mesh.scale.clone(),
      };
    }
    return snapshot;
  }

  /**
   * Dispatch to the correct animation function based on state.
   */
  _animateState(state, animDef, deltaTime) {
    if (!animDef) return;

    const speed = animDef.speed || 1;
    // Looping animations read the monotonic lifetime; one-shots read time since this state
    // was entered. D-88 — see the constructor.
    const time = this.animationTime * speed;
    const stateTime = (this.animationTime - this._stateStartTime) * speed;

    switch (state) {
      case AI_STATES.IDLE:
        this._animateIdle(time);
        break;
      case AI_STATES.WANDER:
      case AI_STATES.RETURN_HOME:
        this._animateWalk(time, animDef);
        break;
      case AI_STATES.CHASE:
        this._animateWalk(time, animDef);
        break;
      case AI_STATES.FLEE:
        this._animateWalk(time, animDef);
        break;
      case AI_STATES.ATTACK:
        this._animateAttack(stateTime, animDef);
        break;
      case AI_STATES.HURT:
        this._animateHurt(stateTime, animDef);
        break;
    }
  }

  /**
   * Dispatch idle animation based on type.
   */
  _animateIdle(time) {
    const animDef = this.mob.definition.animations && this.mob.definition.animations.idle;
    if (!animDef) return;

    switch (animDef.type) {
      case ANIM_TYPES.BREATHING:
        breathingIdle(this.group, time);
        break;
      case ANIM_TYPES.TWITCH:
        twitchIdle(this.group, time);
        break;
      case ANIM_TYPES.ROCKING:
        rockingIdle(this.group, time);
        break;
      case ANIM_TYPES.HOVER:
        hoverIdle(this.group, time);
        break;
    }
  }

  /**
   * Dispatch walk animation based on type and gait.
   */
  _animateWalk(time, animDef) {
    if (!animDef) return;

    switch (animDef.type) {
      case ANIM_TYPES.WALK:
        walkCycle(this.group, time, 1, animDef.gait || 'trot');
        break;
      case ANIM_TYPES.HOP:
        hopCycle(this.group, time, 1);
        break;
      case ANIM_TYPES.HOVER:
        hoverIdle(this.group, time);
        break;
    }
  }

  /**
   * Dispatch attack animation based on custom function name.
   * @param {number} time - Seconds since ATTACK was entered, scaled by `animDef.speed`.
   *   NOT `this.animationTime` — that is the monotonic lifetime and made `progress`
   *   permanently 1. See the constructor's D-88 note.
   */
  _animateAttack(time, animDef) {
    if (!animDef) return;
    const duration = animDef.duration || 0.3;
    const progress = Math.min(1, time / duration);

    switch (animDef.functionName) {
      case 'lungeAttack':
        lungeAttack(this.group, progress);
        break;
      case 'slamAttack':
        slamAttack(this.group, progress);
        break;
      case 'chargeAttack':
        chargeAttack(this.group, progress);
        break;
    }
  }

  /**
   * Dispatch hurt animation.
   * @param {number} time - Seconds since HURT was entered, scaled by `animDef.speed`.
   *   See `_animateAttack` and the constructor's D-88 note.
   */
  _animateHurt(time, animDef) {
    if (!animDef) return;
    const duration = animDef.duration || 0.25;
    const progress = Math.min(1, time / duration);
    hurtReaction(this.group, progress);
  }

  /**
   * Dispatch death animation based on custom function name.
   */
  _animateDeath(deltaTime) {
    const animDef = this.mob.definition.animations && this.mob.definition.animations.dead;
    if (!animDef) return;

    const duration = animDef.duration || 1.0;
    // Reset counter when death starts
    if (this._deathStartTime === undefined) {
      this._deathStartTime = this.animationTime;
    }
    const deathTime = this.animationTime - this._deathStartTime;
    const progress = Math.min(1, deathTime / duration);

    switch (animDef.functionName) {
      case 'collapseDeath':
        collapseDeath(this.group, progress);
        break;
      case 'crumbleDeath':
        crumbleDeath(this.group, progress);
        break;
      case 'dissolveDeath':
        dissolveDeath(this.group, progress);
        break;
    }
  }
}
