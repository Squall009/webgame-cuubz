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
import { hurtReaction } from './animTypes/hurtAnim.js';
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
      this.previousState = this.currentState;
      this.currentState = state;
      this.transitionProgress = 0;

      // Snapshot current transforms for blend
      this.snapshotTransforms = this._captureTransforms();
    }

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
    const time = this.animationTime * speed;

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
        this._animateAttack(time, animDef);
        break;
      case AI_STATES.HURT:
        this._animateHurt(time, animDef);
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
