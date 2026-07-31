/**
 * Cuubz — the day/night curves (PR 23)
 *
 * Split out of `src/engine/renderer/SkyRenderer.js`: the palette constants and the
 * nineteen pure functions of `hour` that everything sky-related is computed from.
 *
 * **A real module, not a prototype mixin.** FIELDS CROSSING THIS BOUNDARY: 0 — not one
 * function below contains the token `this`. That is the case decision 44 says a real module
 * is the right shape, and it is why this file can be exercised without a renderer, a
 * `THREE` or a DOM, which is what `test/test_skybox.js` does with all nineteen. It is also
 * a leaf — it imports nothing but `smoothstep`, so the three sky files that read it cannot
 * form a cycle (D-28). Every name is re-exported from
 * `src/engine/renderer/SkyRenderer.js` under its original identifier, so `test_skybox.js`
 * and `test_globalCollisions.js` are unchanged.
 *
 * ─── D-67 — DAWN AND DUSK WERE DEFINED THREE TIMES AND DISAGREED ────────────
 *
 * `SkyRenderer.js` carried three schedules for the same four moments:
 *
 *   getSkyPhase()             integer hours — dawn 5–7, day 7–17, sunset 17–19, dusk 19–20
 *   getFogDensityForTime()    day fractions — DAWN_START 0.20 (4:48), DAWN_END 0.30 (7:12),
 *   getAmbientIntensityForTime()              DUSK_START 0.70 (16:48), DUSK_END 0.80 (19:12)
 *   getSkyColorForTime()      a third set of hour-based smoothsteps at 5, 6, 7, 17, 18, 19
 *
 * Measured: at hour 7.1 the phase label read 'day' and the sky had finished its dawn blend
 * while ambient and fog were still short of their day values; at hour 4.9 the label read
 * 'night' but the fog had already started thinning. `getStateSummary()` returns all three
 * together, so a debug overlay showed them contradicting each other.
 *
 * DECISION 46: **the sky-colour schedule wins — dawn 5 h → 7 h, dusk/sunset 17 h → 19 h.**
 * The sky is what the player actually sees, so the fog, the ambient light and the phase
 * label follow it rather than the other way round. `getSkyPhase()`'s hours already matched
 * it exactly, so only the four fraction constants moved, by at most twelve in-game minutes.
 *
 * There is now ONE set of boundaries, below, and all four consumers read it. The fractions
 * are written as `HOUR / 24` rather than as `0.2083…` so the two representations cannot
 * drift apart again, and so that `hoursToFraction(5) === DAWN_START` is exact — the
 * boundary assertions in `test_skybox.js` depend on that exactness.
 *
 * `getSkyPhase()`'s extra `dusk` label from 19 to 20 is kept: label granularity inside the
 * night, not a fifth boundary anything else has to agree with.
 */

import { smoothstep } from '../../util/MathUtils.js';

// ============================================================
// Constants & Configuration
// ============================================================

/** Full day/night cycle duration in seconds (default: 5 minutes) */
export const DEFAULT_CYCLE_DURATION = 300;

/** Fog density at full daylight (FogExp2 with squared distance) */
export const FOG_DENSITY_DAY = 0.001;

/** Fog density at full night (thicker for reduced visibility) */
export const FOG_DENSITY_NIGHT = 0.003;

// ─── The one day/night schedule (D-67, decision 46) ──────────────────────────
//
// Change these and the phase label, the fog curve, the ambient curve, the sky gradient
// and the HUD label all move together. That is the whole point of the row.

/** Dawn begins — night ends, the sky starts lifting off midnight blue. */
export const DAWN_START_HOUR = 5;
/** Dawn ends — full day begins. */
export const DAWN_END_HOUR = 7;
/** Dusk begins — full day ends, the sky starts falling towards sunset orange. */
export const DUSK_START_HOUR = 17;
/** Dusk ends — night begins. */
export const DUSK_END_HOUR = 19;
/** The HUD keeps calling the first hour of night 'dusk'. Label granularity only. */
export const DUSK_LABEL_END_HOUR = 20;

// Smoothstep transition ranges for dawn/dusk (fraction of cycle: 0-1).
//
// One `export const` per line. The originals were two comma-separated declarators —
// `export const DAWN_START = 0.20, DAWN_END = 0.30;` — and `test/helpers/esmRequire.js`
// only ever collected the FIRST name on such a line, so `DAWN_END` and `DUSK_END` were
// silently `undefined` on the CommonJS side of every Node test. Nothing imported them, so
// nothing noticed; the boundary assertions added for D-67 do import them.
//
// D-82: **PR 31 deleted that hook.** Vitest loads real ES modules, which export every
// declarator on a line, so the one-per-line split is no longer required for correctness.
// It stays because the defect it prevented was invisible for months and one name per line
// is how it stays that way — but it is now a convention, not a constraint.
export const DAWN_START = DAWN_START_HOUR / 24; // 05:00
export const DAWN_END = DAWN_END_HOUR / 24;     // 07:00
export const DUSK_START = DUSK_START_HOUR / 24; // 17:00
export const DUSK_END = DUSK_END_HOUR / 24;     // 19:00

/** Sky color palette — hex values for each phase */
export const SKY_COLORS = {
  midnight:   0x0a0a2e,
  dawn:       0xff8c5a,
  sunrise:    0xff6b35,
  day:        0x87CEEB,
  sunset:     0xff6b35,
  dusk:       0x4a2060,
  night:      0x0a0a2e,
};

/** Sun color temperatures by time of day */
export const SUN_COLORS = {
  noon:   0xfff5e0,
  sunrise: 0xffaa33,
  sunset:  0xff6622,
};

/** Ambient light intensity range */
export const AMBIENT_LIGHT = {
  dayIntensity:  0.45,
  nightIntensity: 0.25,
};

// ============================================================
// Pure Utility Functions (testable without Three.js)
// ============================================================

// `smoothstep` now lives in js/util/mathUtils.js — it used to be declared here AND in
// js/audio/ambient.js, which silently collided in the shared global scope (refactor.md §2.1).
/**
 * Linear interpolation between two numbers.
 */
export function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

/**
 * Convert hex color to RGB object.
 */
export function hexToRGB(hex) {
  return {
    r: ((hex >> 16) & 255) / 255,
    g: ((hex >> 8) & 255) / 255,
    b: (hex & 255) / 255,
  };
}

/**
 * Lerp between two hex colors.
 */
export function lerpColor(hexA, hexB, t) {
  const a = hexToRGB(hexA);
  const b = hexToRGB(hexB);
  const r = Math.round(lerp(a.r, b.r, t) * 255);
  const g = Math.round(lerp(a.g, b.g, t) * 255);
  const bl = Math.round(lerp(a.b, b.b, t) * 255);
  return (r << 16) | (g << 8) | bl;
}

/**
 * Convert game hours (0-24) to normalized cycle fraction (0-1).
 */
export function hoursToFraction(hours) {
  return ((hours % 24) + 24) % 24 / 24;
}

/**
 * Convert normalized cycle fraction (0-1) to game hours (0-24).
 */
export function fractionToHours(fraction) {
  return ((fraction % 1) + 1) % 1 * 24;
}

/**
 * Calculate sky color for a given time of day (0-24 hours).
 * Returns hex color value.
 *
 * The four schedule boundaries are the shared constants (D-67). The intermediate hours —
 * 6 and 18, where the blend changes which pair of colours it is interpolating, and 8 and
 * 20, where the last blend of each transition finishes — are internal to a band. Nothing
 * outside this function has an opinion about them.
 */
export function getSkyColorForTime(hour) {
  hour = ((hour % 24) + 24) % 24;

  if (hour >= DAWN_START_HOUR && hour < 6) {
    // Pre-dawn: midnight/dark → dawn pink
    const t = smoothstep((hour - DAWN_START_HOUR) / 1);
    return lerpColor(SKY_COLORS.midnight, SKY_COLORS.dawn, t);
  } else if (hour >= 6 && hour < DAWN_END_HOUR) {
    // Sunrise: dawn pink → sunrise orange
    const t = smoothstep((hour - 6) / 1);
    return lerpColor(SKY_COLORS.dawn, SKY_COLORS.sunrise, t);
  } else if (hour >= DAWN_END_HOUR && hour < 8) {
    // Dawn: sunrise orange → day blue
    const t = smoothstep((hour - DAWN_END_HOUR) / 1);
    return lerpColor(SKY_COLORS.sunrise, SKY_COLORS.day, t);
  } else if (hour >= 8 && hour < DUSK_START_HOUR) {
    // Full day: blue sky with slight variation at noon
    return SKY_COLORS.day;
  } else if (hour >= DUSK_START_HOUR && hour < 18) {
    // Early sunset: day blue → sunset orange
    const t = smoothstep((hour - DUSK_START_HOUR) / 1);
    return lerpColor(SKY_COLORS.day, SKY_COLORS.sunset, t);
  } else if (hour >= 18 && hour < DUSK_END_HOUR) {
    // Sunset: sunset orange → dusk purple
    const t = smoothstep((hour - 18) / 1);
    return lerpColor(SKY_COLORS.sunset, SKY_COLORS.dusk, t);
  } else if (hour >= DUSK_END_HOUR && hour < DUSK_LABEL_END_HOUR) {
    // Dusk: dusk purple → night dark
    const t = smoothstep((hour - DUSK_END_HOUR) / 1);
    return lerpColor(SKY_COLORS.dusk, SKY_COLORS.night, t);
  } else {
    // Night: dark blue/black
    return SKY_COLORS.night;
  }
}

/**
 * Determine if it's daytime based on game hours.
 * Daytime: 7:00 - 19:00 (with transitions at edges).
 */
export function isDaytime(hour) {
  hour = ((hour % 24) + 24) % 24;
  return hour >= DAWN_END_HOUR && hour < DUSK_END_HOUR;
}

/**
 * Determine the current sky phase name.
 * Returns: 'night', 'dawn', 'day', 'sunset', 'dusk'
 */
export function getSkyPhase(hour) {
  hour = ((hour % 24) + 24) % 24;
  if (hour < DAWN_START_HOUR) return 'night';
  if (hour < DAWN_END_HOUR) return 'dawn';
  if (hour < DUSK_START_HOUR) return 'day';
  if (hour < DUSK_END_HOUR) return 'sunset';
  if (hour < DUSK_LABEL_END_HOUR) return 'dusk';
  return 'night';
}

/**
 * Calculate fog density based on time of day.
 * Thicker at night for reduced visibility, thinner during day.
 */
export function getFogDensityForTime(hour) {
  const frac = hoursToFraction(hour);

  // Night: thick fog
  if (frac < DAWN_START || frac >= DUSK_END) {
    return FOG_DENSITY_NIGHT;
  }

  // Dawn transition: night → day (thick → thin)
  if (frac >= DAWN_START && frac < DAWN_END) {
    const t = smoothstep((frac - DAWN_START) / (DAWN_END - DAWN_START));
    return lerp(FOG_DENSITY_NIGHT, FOG_DENSITY_DAY, t);
  }

  // Day: thin fog
  if (frac >= DAWN_END && frac < DUSK_START) {
    return FOG_DENSITY_DAY;
  }

  // Dusk transition: day → night (thin → thick)
  const t = smoothstep((frac - DUSK_START) / (DUSK_END - DUSK_START));
  return lerp(FOG_DENSITY_DAY, FOG_DENSITY_NIGHT, t);
}

/**
 * Calculate ambient light intensity based on time of day.
 */
export function getAmbientIntensityForTime(hour) {
  const frac = hoursToFraction(hour);

  // Night: low ambient
  if (frac < DAWN_START || frac >= DUSK_END) {
    return AMBIENT_LIGHT.nightIntensity;
  }

  // Dawn transition: night → day
  if (frac >= DAWN_START && frac < DAWN_END) {
    const t = smoothstep((frac - DAWN_START) / (DAWN_END - DAWN_START));
    return lerp(AMBIENT_LIGHT.nightIntensity, AMBIENT_LIGHT.dayIntensity, t);
  }

  // Day: full ambient
  if (frac >= DAWN_END && frac < DUSK_START) {
    return AMBIENT_LIGHT.dayIntensity;
  }

  // Dusk transition: day → night
  const t = smoothstep((frac - DUSK_START) / (DUSK_END - DUSK_START));
  return lerp(AMBIENT_LIGHT.dayIntensity, AMBIENT_LIGHT.nightIntensity, t);
}

/**
 * Calculate sun angle in radians based on game hours.
 * Sunrise at hour 6, peak at hour 12, sunset at hour 18.
 */
export function getSunAngleForTime(hour) {
  // Sun arc: -PI/2 at midnight, 0 at sunrise/sunset, PI/2 at noon
  const frac = hoursToFraction(hour);
  // Map 0-1 to sun position: below horizon at night, arc during day
  return (frac * Math.PI * 2) - Math.PI / 2;
}

/**
 * Calculate moon angle in radians based on game hours.
 * Moon is opposite the sun (rises at sunset, sets at sunrise).
 */
export function getMoonAngleForTime(hour) {
  const sunAngle = getSunAngleForTime(hour);
  return sunAngle + Math.PI; // Opposite of sun
}

/**
 * Calculate sun elevation (positive = above horizon, negative = below).
 */
export function getSunElevation(hour) {
  return Math.sin(getSunAngleForTime(hour));
}

/**
 * Calculate moon elevation.
 */
export function getMoonElevation(hour) {
  return Math.sin(getMoonAngleForTime(hour));
}

/**
 * Get sun light color hex based on time of day.
 * Warmer at sunrise/sunset, cooler at noon.
 */
export function getSunColorForTime(hour) {
  const elevation = getSunElevation(hour);

  if (elevation <= 0) {
    // Sun below horizon — no sun light
    return SUN_COLORS.noon;
  }

  // Lower sun = warmer color
  const warmth = Math.max(0, 1 - elevation); // 0 at peak, 1 at horizon

  if (warmth > 0.7) {
    return SUN_COLORS.sunset; // Very warm near horizon
  } else if (warmth > 0.3) {
    const t = (warmth - 0.3) / 0.4;
    return lerpColor(SUN_COLORS.noon, SUN_COLORS.sunset, t);
  }

  return SUN_COLORS.noon;
}

/**
 * Calculate sun intensity based on elevation (0 when below horizon).
 */
export function getSunIntensity(hour) {
  const elevation = getSunElevation(hour);
  // Smooth transition at horizon using smoothstep
  const aboveHorizon = smoothstep(Math.max(0, elevation * 3)); // Sharper horizon cutoff
  return Math.max(0, aboveHorizon) * 1.2;
}

/**
 * Calculate moon intensity based on elevation and sun interference.
 */
export function getMoonIntensity(hour) {
  const moonElev = getMoonElevation(hour);
  const sunElev = getSunElevation(hour);

  // Moon only visible when above horizon
  if (moonElev <= 0) return 0;

  // Sun brightens sky, washing out moon light
  const sunInterference = Math.max(0, sunElev);
  const moonBase = smoothstep(moonElev * 2);

  return Math.max(0, moonBase * 0.6 * (1 - sunInterference));
}

/**
 * Get the time period label for HUD display.
 *
 * 'Morning' / 'Noon' / 'Afternoon' subdivide the day band; the four outer boundaries are
 * the shared schedule constants, so this label can never disagree with `getSkyPhase`.
 */
export function getTimeOfDayLabel(hour) {
  hour = ((hour % 24) + 24) % 24;
  if (hour >= DAWN_START_HOUR && hour < DAWN_END_HOUR) return 'Dawn';
  if (hour >= DAWN_END_HOUR && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 14) return 'Noon';
  if (hour >= 14 && hour < DUSK_START_HOUR) return 'Afternoon';
  if (hour >= DUSK_START_HOUR && hour < DUSK_END_HOUR) return 'Sunset';
  if (hour >= DUSK_END_HOUR && hour < DUSK_LABEL_END_HOUR) return 'Dusk';
  return 'Night';
}

/**
 * Format game hours to readable time string (HH:MM).
 */
export function formatGameTime(hour) {
  const h = Math.floor(((hour % 24) + 24) % 24);
  const m = Math.floor((((hour % 24) + 24) % 24 - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
