/**
 * Cuubz — Time of day (PR 23)
 *
 * Split out of `src/engine/renderer/SkyRenderer.js`. The clock and the fifteen accessors
 * that answer "what time is it, and what does that imply?" — every one of them a lookup
 * into `DayNightCurves.js` keyed on `this.timeOfDay`.
 *
 * FIELDS CROSSING THIS BOUNDARY: 3 — `timeOfDay`, `cycleDuration`, `speed`. Thirteen of the
 * fifteen methods touch only the first.
 *
 * ─── A PROTOTYPE MIXIN, NOT A CLASS — AND WHY ───────────────────────────────
 *
 * `refactor.md` §4.1 names this file under `src/game/systems/`, and the field partition
 * looks clean enough for a real `TimeOfDaySystem` class that `Skybox` would own. It is not,
 * and the reason is outside this file:
 *
 *   `src/core/init/initChunkStreaming.js:223`  ASSIGNS `state.skybox.timeOfDay = …`
 *   `src/engine/loop/steps/NetworkStep.js:75`  READS  `state.skybox.timeOfDay`
 *   `src/ui/overlays/PauseMenu.js:362`         READS  `state.skybox.timeOfDay`
 *
 * `timeOfDay` is not private state with an accessor in front of it; it is a plain own
 * property that the multiplayer time-sync writes through from outside. Moving it onto a
 * collaborator means either rewriting those three call sites plus the twenty-odd reads
 * inside `_updateSkyState`/`update`/`_updateSkyColor`/`_updateNightIndicator` that stay in
 * `SkyRenderer.js`, or installing a getter/setter pair on `Skybox` to forward them — a
 * second way to reach the same field, which is how the class of defect `refactor.md` §2 is
 * about gets started. Decision 44 exists for exactly this: the methods move, the object
 * does not. `this` is still the `Skybox` instance in every body below, and `skybox.getTime()`,
 * `skybox.getPhase()`, `skybox.timeOfDay` and `skybox.getStateSummary()` are all unchanged.
 *
 * `getSunColor` and `getSunDirection` are here rather than in `SkyRenderer.js` despite
 * returning `THREE` objects: they read `this.timeOfDay` and nothing else, which is the test
 * this file's membership is decided by. `src/game/systems/` already imports `three` in
 * `BlockInteractionSystem.js` and `DroppedItemsSystem.js`, so the dependency is not new.
 *
 * IMPORT DIRECTION: imported BY `SkyRenderer.js`; imports only `three` and the leaf curve
 * module. No cycle (D-28).
 */

import * as THREE from 'three';
// D-82: split across two lines because `test/helpers/esmRequire.js` could only read
// single-line named imports. **PR 31 deleted that hook** — Vitest loads real ES modules —
// so this is now a formatting choice, not a constraint. Left as-is; see SkyRenderer.js.
import { formatGameTime, getAmbientIntensityForTime, getFogDensityForTime, getMoonIntensity, getSkyPhase } from '../data/DayNightCurves.js';
import { getSunAngleForTime, getSunColorForTime, getSunIntensity, getTimeOfDayLabel, hoursToFraction, isDaytime } from '../data/DayNightCurves.js';

export const TimeOfDayMethods = {
  /**
   * Set the cycle duration and recalculate speed.
   */
  setCycleDuration(seconds) {
    this.cycleDuration = Math.max(60, seconds); // Minimum 1 minute
    this.speed = 24 / this.cycleDuration;
  },

  /**
   * Get current cycle duration in seconds.
   */
  getCycleDuration() {
    return this.cycleDuration;
  },

  /**
   * Get current time of day in hours.
   */
  getTime() {
    return this.timeOfDay;
  },

  /**
   * Set time of day (for testing/debugging).
   */
  setTime(hour) {
    this.timeOfDay = ((hour % 24) + 24) % 24;
    this._updateSkyState();
  },

  /**
   * Get isDay flag.
   */
  isDay() {
    return isDaytime(this.timeOfDay);
  },

  /**
   * Get current sky phase name.
   */
  getPhase() {
    return getSkyPhase(this.timeOfDay);
  },

  /**
   * Get time of day label for HUD display.
   */
  getTimeLabel() {
    return getTimeOfDayLabel(this.timeOfDay);
  },

  /**
   * Format current game time as HH:MM string.
   */
  getFormattedTime() {
    return formatGameTime(this.timeOfDay);
  },

  /**
   * Get normalized time fraction (0-1) for ambient audio integration.
   */
  getTimeFraction() {
    return hoursToFraction(this.timeOfDay);
  },

  /**
   * Get current fog density for debugging.
   */
  getFogDensity() {
    return getFogDensityForTime(this.timeOfDay);
  },

  /**
   * Get current ambient light intensity (between AMBIENT_LIGHT.nightIntensity and
   * AMBIENT_LIGHT.dayIntensity, on the one D-67 schedule).
   */
  getAmbientIntensity() {
    return getAmbientIntensityForTime(this.timeOfDay);
  },

  /**
   * Get current sun intensity (0 when below horizon).
   */
  getSunIntensity() {
    return getSunIntensity(this.timeOfDay);
  },

  /**
   * Get current sun color as a THREE.Color.
   */
  getSunColor() {
    const hex = getSunColorForTime(this.timeOfDay);
    return new THREE.Color(hex);
  },

  /**
   * Get current sun direction as a normalized THREE.Vector3.
   */
  getSunDirection() {
    const sunAngle = getSunAngleForTime(this.timeOfDay);
    const sunX = Math.cos(sunAngle);
    const sunY = Math.sin(sunAngle);
    const dir = new THREE.Vector3(sunX, Math.max(sunY, -0.1), 0.5).normalize();
    return dir;
  },

  /**
   * Get state summary for debugging/HUD integration.
   *
   * D-67: `phase`, `fogDensity` and `ambientIntensity` all come off the one schedule now.
   * Before this PR a debug overlay reading this object could show 'day' next to a fog
   * density still short of its day value.
   */
  getStateSummary() {
    return {
      timeOfDay: this.timeOfDay,
      phase: this.getPhase(),
      isDay: this.isDay(),
      timeLabel: this.getTimeLabel(),
      formattedTime: this.getFormattedTime(),
      cycleDuration: this.cycleDuration,
      speed: this.speed,
      fogDensity: this.getFogDensity(),
      ambientIntensity: this.getAmbientIntensity(),
      sunIntensity: getSunIntensity(this.timeOfDay),
      moonIntensity: getMoonIntensity(this.timeOfDay),
    };
  },
};
