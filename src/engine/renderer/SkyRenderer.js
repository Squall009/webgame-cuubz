/**
 * Cuubz — Skybox & Day/Night Cycle
 * Gradient sky based on time of day, sun/moon positioning, clouds.
 * Ambient light changes affecting visibility (fog density).
 * Night indicator for HUD integration.
 *
 * This file owns the state and the per-frame bridge from "what time is it" to "what does
 * the scene look like". The rest of the class lives in sibling files and is attached to
 * `Skybox.prototype` at the bottom:
 *
 *   ../../game/data/DayNightCurves.js    the palette + the 19 pure functions (a real module)
 *   ../../game/systems/TimeOfDaySystem.js the clock and its 15 accessors
 *   ./SkyGeometry.js                      every THREE object: build, drift, teardown
 *
 * ─── WHY PROTOTYPE MIXINS AND NOT COMPOSITION (decision 44) ─────────────────
 *
 * `Skybox` was one 1,007-line class. Its field partition is unusually clean — the 316 lines
 * of pure functions touch no `this` at all, and the fifteen accessors touch only
 * `timeOfDay` — so `DayNightCurves.js` really is a plain module. But `timeOfDay` itself
 * cannot move: `src/core/init/initChunkStreaming.js:223` ASSIGNS `skybox.timeOfDay` from
 * the multiplayer time sync, and `NetworkStep.js` and `PauseMenu.js` read it. It is a
 * public own property, not private state behind an accessor. So the accessors moved and the
 * object did not; `TimeOfDaySystem.js` explains that call site by call site.
 *
 * Exactly two methods spanned the seam, and both are still here: `_updateSkyState` — the
 * whole bridge, the one place that reads the clock and writes to `THREE` objects — and
 * `update`, whose two halves (advance the clock / drive the clouds) were split apart, the
 * second half becoming `SkyGeometry.js`'s `_updateClouds`. That name is not new: the doc
 * comment on `_createClouds` has always claimed the clouds were "Managed by
 * _updateClouds()". Until this PR they were not.
 *
 * ─── EXPORT SURFACE: UNCHANGED ──────────────────────────────────────────────
 *
 * Every constant, every pure function and `smoothstep` are still exported from THIS path
 * under their original names — `test/test_skybox.js` destructures twenty-five of them off
 * this module and `test/test_globalCollisions.js` asserts the `smoothstep` re-export. The
 * five new `*_HOUR` constants D-67 introduced are exported too.
 */

import * as THREE from 'three';
import { smoothstep } from '../../util/MathUtils.js';
import { SkyGeometryMethods } from './SkyGeometry.js';
import { TimeOfDayMethods } from '../../game/systems/TimeOfDaySystem.js';
// D-82: these four lines are split this way because `test/helpers/esmRequire.js` — a
// require hook that regex-rewrote ESM into CommonJS — could only read single-line named
// imports. **PR 31 deleted that hook**; Vitest loads real ES modules, so the split is now
// a formatting choice with no constraint behind it and one long import would work. It is
// left as it is because reflowing it changes nothing and risks a typo in 24 names.
import { AMBIENT_LIGHT, DAWN_END, DAWN_END_HOUR, DAWN_START, DAWN_START_HOUR, DEFAULT_CYCLE_DURATION } from '../../game/data/DayNightCurves.js';
import { DUSK_END, DUSK_END_HOUR, DUSK_LABEL_END_HOUR, DUSK_START, DUSK_START_HOUR, FOG_DENSITY_DAY } from '../../game/data/DayNightCurves.js';
import { FOG_DENSITY_NIGHT, SKY_COLORS, SUN_COLORS, formatGameTime, fractionToHours, hexToRGB } from '../../game/data/DayNightCurves.js';
import { getAmbientIntensityForTime, getFogDensityForTime, getMoonAngleForTime, getMoonElevation } from '../../game/data/DayNightCurves.js';
import { getMoonIntensity, getSkyColorForTime, getSkyPhase, getSunAngleForTime, getSunColorForTime } from '../../game/data/DayNightCurves.js';
import { getSunElevation, getSunIntensity, getTimeOfDayLabel, hoursToFraction, isDaytime, lerp, lerpColor } from '../../game/data/DayNightCurves.js';

// ============================================================
// Exports — Pure utilities for testing, class for browser use
// ============================================================
// The definitions moved to `src/game/data/DayNightCurves.js`, which sits BELOW this file in
// the import graph so the three sky files can read it without a cycle (D-28). They are
// re-exported here under their original names so no importer or test changed.
// `smoothstep` is re-exported for compatibility with the CommonJS surface this file had
// before PR 9 (test_globalCollisions.js asserts skybox re-exports the canonical one).
export { smoothstep };
export { DEFAULT_CYCLE_DURATION, FOG_DENSITY_DAY, FOG_DENSITY_NIGHT, SKY_COLORS, SUN_COLORS, AMBIENT_LIGHT };
export { DAWN_START, DAWN_END, DUSK_START, DUSK_END };
export { DAWN_START_HOUR, DAWN_END_HOUR, DUSK_START_HOUR, DUSK_END_HOUR, DUSK_LABEL_END_HOUR };
export { lerp, hexToRGB, lerpColor, hoursToFraction, fractionToHours };
export { getSkyColorForTime, isDaytime, getSkyPhase, getFogDensityForTime, getAmbientIntensityForTime };
export { getSunAngleForTime, getMoonAngleForTime, getSunElevation, getMoonElevation };
export { getSunColorForTime, getSunIntensity, getMoonIntensity, getTimeOfDayLabel, formatGameTime };

// ============================================================
// Skybox Class — Three.js Integration
// ============================================================

export class Skybox {
  constructor(renderer, options = {}) {
    this.renderer = renderer;

    // Time of day: 0-24 hours
    this.timeOfDay = options.startTime !== undefined ? options.startTime : 12; // Default noon

    // Cycle duration in seconds (default: 5 minutes)
    this.cycleDuration = options.cycleDuration || DEFAULT_CYCLE_DURATION;

    // Speed derived from cycle duration: hours per second = 24 / cycleDuration
    this.speed = 24 / this.cycleDuration;

    // Sun and moon objects
    this.sunLight = null;
    this.moonLight = null;
    this.ambientLight = null;
    this.cloudLayer = null;

    // The ONE geometry + material every cloud cube shares, built in
    // SkyGeometry._createClouds and freed in dispose(). They used to be rebuilt on every
    // _updateClouds call and never disposed — a per-frame THREE leak (PR 23).
    this._cloudGeo = null;
    this._cloudMat = null;

    // Cloud system configuration
    this.cloudMinAltitude = 160; // Minimum cloud altitude (above terrain)
    this.cloudMaxAltitude = 220; // Maximum cloud altitude
    this.cloudSpreadRadius = 250; // How far clouds spread from player
    this.cloudWrapDistance = 180; // Wrap clouds when they drift this far
    this.cloudCount = 0;
    this.cloudTargetCount = 20 + Math.floor(Math.random() * 8); // 20-27 clouds

    // Sky dome
    this.skyDome = null;

    // Night indicator element reference (for HUD)
    this.nightIndicatorEl = null;

    // Previous phase for transition detection
    this._previousPhase = getSkyPhase(this.timeOfDay);

    // Callbacks
    this.onPhaseChange = null; // Called when sky phase changes: (newPhase, oldPhase) => void

    // Time pause control
    this.timePaused = false;
  }

  /**
   * Update sky state based on current time of day.
   * Called after setTime() or during init.
   */
  _updateSkyState() {
    // Sun position and intensity
    if (this.sunLight) {
      const sunAngle = getSunAngleForTime(this.timeOfDay);
      const sunX = Math.cos(sunAngle) * 100;
      const sunY = Math.sin(sunAngle) * 100;
      this.sunLight.position.set(sunX, Math.max(sunY, -10), 50);

      const intensity = getSunIntensity(this.timeOfDay);
      this.sunLight.intensity = intensity;

      // Sun color warmth
      const sunColorHex = getSunColorForTime(this.timeOfDay);
      this.sunLight.color.setHex(sunColorHex);
    }

    // Moon position and intensity
    if (this.moonLight) {
      const moonAngle = getMoonAngleForTime(this.timeOfDay);
      const moonX = Math.cos(moonAngle) * 100;
      const moonY = Math.sin(moonAngle) * 100;
      this.moonLight.position.set(moonX, Math.max(moonY, -10), -50);

      this.moonLight.intensity = getMoonIntensity(this.timeOfDay);
    }

    // Sun sprite — position matches sun light, only visible above horizon
    if (this.sunSprite) {
      const sunAngle = getSunAngleForTime(this.timeOfDay);
      const sunX = Math.cos(sunAngle) * 100;
      const sunY = Math.sin(sunAngle) * 100;
      this.sunSprite.position.set(sunX, sunY, 50);
      // Fade out when below horizon
      const elevation = getSunElevation(this.timeOfDay);
      this.sunSprite.material.opacity = Math.max(0, smoothstep(elevation * 3));
    }

    // Moon sprite — position matches moon light, only visible above horizon
    if (this.moonSprite) {
      const moonAngle = getMoonAngleForTime(this.timeOfDay);
      const moonX = Math.cos(moonAngle) * 100;
      const moonY = Math.sin(moonAngle) * 100;
      this.moonSprite.position.set(moonX, moonY, -50);
      // Fade out when below horizon or when sun is too bright
      const moonElev = getMoonElevation(this.timeOfDay);
      const sunElev = getSunElevation(this.timeOfDay);
      const sunInterference = Math.max(0, sunElev);
      const moonBase = smoothstep(Math.max(0, moonElev * 2));
      this.moonSprite.material.opacity = Math.max(0, moonBase * (1 - sunInterference));
    }

    // Ambient light intensity
    if (this.ambientLight) {
      this.ambientLight.intensity = getAmbientIntensityForTime(this.timeOfDay);
    }

    // Sky color + fog
    this._updateSkyColor();

    // Cloud visibility — clouds dim at night
    if (this.cloudLayer) {
      const isDay = isDaytime(this.timeOfDay);
      const cloudOpacity = isDay ? 0.75 : 0.15;
      // Cloud layer children are Groups (clusters), traverse to find meshes
      this.cloudLayer.traverse((child) => {
        if (child.isMesh && child.material) {
          child.material.opacity = cloudOpacity;
        }
      });
    }

    // Night indicator update
    this._updateNightIndicator();

    // Phase change detection
    const currentPhase = getSkyPhase(this.timeOfDay);
    if (currentPhase !== this._previousPhase) {
      const oldPhase = this._previousPhase;
      this._previousPhase = currentPhase;
      if (this.onPhaseChange) {
        this.onPhaseChange(currentPhase, oldPhase);
      }
    }
  }

  /**
   * Update sky based on time of day.
   * Advances the clock, updates lighting/colors, drifts clouds.
   * @param {number} deltaTime — Seconds since last frame
   * @param {THREE.Vector3} [playerPos] — Optional player position for following clouds/sky
   */
  update(deltaTime, playerPos) {
    // Advance time: speed is hours/second, deltaTime is seconds
    if (!this.timePaused) {
      this.timeOfDay += this.speed * deltaTime;
      if (this.timeOfDay >= 24) this.timeOfDay -= 24;
    }

    this._updateSkyState();

    // Drift, wrap and respawn the cloud pool, then follow the player. The second half of
    // what this method used to do inline; it lives in SkyGeometry.js with the code that
    // creates the clouds it is recycling.
    this._updateClouds(deltaTime, playerPos);
  }

  /**
   * Update sky gradient based on time of day.
   * Stores the raw base color so BiomeEffects can blend on top.
   */
  _updateSkyColor() {
    if (!this.renderer || !this.renderer.scene) return;

    const skyColorHex = getSkyColorForTime(this.timeOfDay);
    const skyColor = new THREE.Color(skyColorHex);

    // Store raw base color for biome blending
    this._baseSkyColor = skyColor.clone();

    this.renderer.scene.background = skyColor;

    // Update fog with time-based density and color
    if (this.renderer.scene.fog) {
      this.renderer.scene.fog.color = skyColor;
      this.renderer.scene.fog.density = getFogDensityForTime(this.timeOfDay);
    }
  }

  /**
   * Update night indicator element in HUD.
   * If a DOM element reference is set, update its content.
   */
  _updateNightIndicator() {
    if (!this.nightIndicatorEl) return;

    const phase = getSkyPhase(this.timeOfDay);
    const timeStr = formatGameTime(this.timeOfDay);
    const label = getTimeOfDayLabel(this.timeOfDay);
    const isDay = isDaytime(this.timeOfDay);

    // Update indicator with icon, time, and label
    const icon = isDay ? '☀️' : '🌙';
    this.nightIndicatorEl.textContent = `${icon} ${timeStr} ${label}`;
    this.nightIndicatorEl.dataset.phase = phase;
    this.nightIndicatorEl.dataset.isNight = String(!isDay);
  }

  /**
   * Set the DOM element for night indicator (HUD integration).
   */
  setNightIndicatorElement(el) {
    this.nightIndicatorEl = el;
    this._updateNightIndicator();
  }

  /**
   * Update the PBR material factory's lighting uniforms to match the current time of day.
   * Call this each frame after skybox.update().
   * @param {PBRMaterialFactory} pbrFactory
   */
  updatePBRFactory(pbrFactory) {
    if (!pbrFactory) return;

    // Update sun direction
    const sunDir = this.getSunDirection();
    if (pbrFactory.updateSunDirection) {
      pbrFactory.updateSunDirection(sunDir);
    }

    // Update sun color
    const sunColor = this.getSunColor();
    if (pbrFactory.updateSunColor) {
      pbrFactory.updateSunColor(sunColor);
    }

    // Update sun intensity
    const sunIntensity = this.getSunIntensity();
    if (pbrFactory.updateSunIntensity) {
      pbrFactory.updateSunIntensity(sunIntensity);
    }

    // Update ambient intensity
    const ambientIntensity = this.getAmbientIntensity();
    if (pbrFactory.updateAmbientIntensity) {
      pbrFactory.updateAmbientIntensity(ambientIntensity);
    }

    // Update sky color for hemisphere lighting
    if (this._baseSkyColor && pbrFactory.updateSkyColor) {
      pbrFactory.updateSkyColor(this._baseSkyColor);
    }

    // Update fog color and density
    if (this._baseSkyColor && pbrFactory.updateFogColor) {
      pbrFactory.updateFogColor(this._baseSkyColor);
    }
    if (pbrFactory.updateFogDensity) {
      pbrFactory.updateFogDensity(this.getFogDensity());
    }
  }
}

// ============================================================
// PROTOTYPE MIXINS — the method groups, put back on the class
// ============================================================
//
// Order is irrelevant: no two of these objects define the same method name, and the guard
// below throws at module load if that ever stops being true. A silent overwrite is the one
// failure mode a mixin split has that a single class does not — two files defining
// `dispose` would leave whichever assigned last, with no error, which is the
// shared-global-scope collision class `refactor.md` §2 and `test_globalCollisions.js` exist
// for. `Object.assign` copies own enumerable properties: an object literal's methods are
// exactly that.
const MIXINS = [
  ['TimeOfDaySystem', TimeOfDayMethods],
  ['SkyGeometry', SkyGeometryMethods],
];

{
  const seen = new Map();
  for (const [file, methods] of MIXINS) {
    for (const name of Object.keys(methods)) {
      const prior = seen.get(name) ||
        (Object.prototype.hasOwnProperty.call(Skybox.prototype, name) ? 'the class body' : null);
      if (prior) {
        throw new Error(`[SkyRenderer] Mixin collision: '${name}' is defined by both ` +
          `${prior} and ${file}.js. Two files cannot own the same method.`);
      }
      seen.set(name, file + '.js');
    }
  }
}

Object.assign(Skybox.prototype, ...MIXINS.map(([, methods]) => methods));
