/**
 * Cuubz — Skybox & Day/Night Cycle
 * Gradient sky based on time of day, sun/moon positioning, clouds.
 * Ambient light changes affecting visibility (fog density).
 * Night indicator for HUD integration.
 */

// ============================================================
// Constants & Configuration
// ============================================================

/** Full day/night cycle duration in seconds (default: 5 minutes) */
const DEFAULT_CYCLE_DURATION = 300;

/** Fog density at full daylight */
const FOG_DENSITY_DAY = 0.008;

/** Fog density at full night (thicker for reduced visibility) */
const FOG_DENSITY_NIGHT = 0.025;

/** Smoothstep transition ranges for dawn/dusk (fraction of cycle: 0-1) */
const DAWN_START = 0.20, DAWN_END = 0.30;   // ~6:00 - 7:20 in game hours
const DUSK_START = 0.70, DUSK_END = 0.80;    // ~16:40 - 19:00 in game hours

/** Sky color palette — hex values for each phase */
const SKY_COLORS = {
  midnight:   0x0a0a2e,
  dawn:       0xff8c5a,
  sunrise:    0xff6b35,
  day:        0x87CEEB,
  sunset:     0xff6b35,
  dusk:       0x4a2060,
  night:      0x0a0a2e,
};

/** Sun color temperatures by time of day */
const SUN_COLORS = {
  noon:   0xfff5e0,
  sunrise: 0xffaa33,
  sunset:  0xff6622,
};

/** Ambient light intensity range */
const AMBIENT_LIGHT = {
  dayIntensity:  0.45,
  nightIntensity: 0.08,
};

// ============================================================
// Pure Utility Functions (testable without Three.js)
// ============================================================

/**
 * Smoothstep interpolation for smooth transitions.
 */
function smoothstep(t) {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
}

/**
 * Linear interpolation between two numbers.
 */
function lerp(a, b, t) {
  return a + (b - a) * Math.max(0, Math.min(1, t));
}

/**
 * Convert hex color to RGB object.
 */
function hexToRGB(hex) {
  return {
    r: ((hex >> 16) & 255) / 255,
    g: ((hex >> 8) & 255) / 255,
    b: (hex & 255) / 255,
  };
}

/**
 * Lerp between two hex colors.
 */
function lerpColor(hexA, hexB, t) {
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
function hoursToFraction(hours) {
  return ((hours % 24) + 24) % 24 / 24;
}

/**
 * Convert normalized cycle fraction (0-1) to game hours (0-24).
 */
function fractionToHours(fraction) {
  return ((fraction % 1) + 1) % 1 * 24;
}

/**
 * Calculate sky color for a given time of day (0-24 hours).
 * Returns hex color value.
 */
function getSkyColorForTime(hour) {
  hour = ((hour % 24) + 24) % 24;

  if (hour >= 5 && hour < 6) {
    // Pre-dawn: midnight/dark → dawn pink
    const t = smoothstep((hour - 5) / 1);
    return lerpColor(SKY_COLORS.midnight, SKY_COLORS.dawn, t);
  } else if (hour >= 6 && hour < 7) {
    // Sunrise: dawn pink → sunrise orange
    const t = smoothstep((hour - 6) / 1);
    return lerpColor(SKY_COLORS.dawn, SKY_COLORS.sunrise, t);
  } else if (hour >= 7 && hour < 8) {
    // Dawn: sunrise orange → day blue
    const t = smoothstep((hour - 7) / 1);
    return lerpColor(SKY_COLORS.sunrise, SKY_COLORS.day, t);
  } else if (hour >= 8 && hour < 17) {
    // Full day: blue sky with slight variation at noon
    return SKY_COLORS.day;
  } else if (hour >= 17 && hour < 18) {
    // Early sunset: day blue → sunset orange
    const t = smoothstep((hour - 17) / 1);
    return lerpColor(SKY_COLORS.day, SKY_COLORS.sunset, t);
  } else if (hour >= 18 && hour < 19) {
    // Sunset: sunset orange → dusk purple
    const t = smoothstep((hour - 18) / 1);
    return lerpColor(SKY_COLORS.sunset, SKY_COLORS.dusk, t);
  } else if (hour >= 19 && hour < 20) {
    // Dusk: dusk purple → night dark
    const t = smoothstep((hour - 19) / 1);
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
function isDaytime(hour) {
  hour = ((hour % 24) + 24) % 24;
  return hour >= 7 && hour < 19;
}

/**
 * Determine the current sky phase name.
 * Returns: 'night', 'dawn', 'day', 'sunset', 'dusk'
 */
function getSkyPhase(hour) {
  hour = ((hour % 24) + 24) % 24;
  if (hour >= 0 && hour < 5) return 'night';
  if (hour >= 5 && hour < 7) return 'dawn';
  if (hour >= 7 && hour < 17) return 'day';
  if (hour >= 17 && hour < 19) return 'sunset';
  if (hour >= 19 && hour < 20) return 'dusk';
  return 'night';
}

/**
 * Calculate fog density based on time of day.
 * Thicker at night for reduced visibility, thinner during day.
 */
function getFogDensityForTime(hour) {
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
function getAmbientIntensityForTime(hour) {
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
function getSunAngleForTime(hour) {
  // Sun arc: -PI/2 at midnight, 0 at sunrise/sunset, PI/2 at noon
  const frac = hoursToFraction(hour);
  // Map 0-1 to sun position: below horizon at night, arc during day
  return (frac * Math.PI * 2) - Math.PI / 2;
}

/**
 * Calculate moon angle in radians based on game hours.
 * Moon is opposite the sun (rises at sunset, sets at sunrise).
 */
function getMoonAngleForTime(hour) {
  const sunAngle = getSunAngleForTime(hour);
  return sunAngle + Math.PI; // Opposite of sun
}

/**
 * Calculate sun elevation (positive = above horizon, negative = below).
 */
function getSunElevation(hour) {
  return Math.sin(getSunAngleForTime(hour));
}

/**
 * Calculate moon elevation.
 */
function getMoonElevation(hour) {
  return Math.sin(getMoonAngleForTime(hour));
}

/**
 * Get sun light color hex based on time of day.
 * Warmer at sunrise/sunset, cooler at noon.
 */
function getSunColorForTime(hour) {
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
function getSunIntensity(hour) {
  const elevation = getSunElevation(hour);
  // Smooth transition at horizon using smoothstep
  const aboveHorizon = smoothstep(Math.max(0, elevation * 3)); // Sharper horizon cutoff
  return Math.max(0, aboveHorizon) * 1.2;
}

/**
 * Calculate moon intensity based on elevation and sun interference.
 */
function getMoonIntensity(hour) {
  const moonElev = getMoonElevation(hour);
  const sunElev = getSunElevation(hour);

  // Moon only visible when above horizon
  if (moonElev <= 0) return 0;

  // Sun brightens sky, washing out moon light
  const sunInterference = Math.max(0, sunElev);
  const moonBase = smoothstep(moonElev * 2);

  return Math.max(0, moonBase * 0.4 * (1 - sunInterference));
}

/**
 * Get the time period label for HUD display.
 */
function getTimeOfDayLabel(hour) {
  hour = ((hour % 24) + 24) % 24;
  if (hour >= 5 && hour < 7) return 'Dawn';
  if (hour >= 7 && hour < 12) return 'Morning';
  if (hour >= 12 && hour < 14) return 'Noon';
  if (hour >= 14 && hour < 17) return 'Afternoon';
  if (hour >= 17 && hour < 19) return 'Sunset';
  if (hour >= 19 && hour < 20) return 'Dusk';
  return 'Night';
}

/**
 * Format game hours to readable time string (HH:MM).
 */
function formatGameTime(hour) {
  const h = Math.floor(((hour % 24) + 24) % 24);
  const m = Math.floor((((hour % 24) + 24) % 24 - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ============================================================
// Skybox Class — Three.js Integration
// ============================================================

class Skybox {
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

    // Sky dome
    this.skyDome = null;

    // Night indicator element reference (for HUD)
    this.nightIndicatorEl = null;

    // Previous phase for transition detection
    this._previousPhase = getSkyPhase(this.timeOfDay);

    // Callbacks
    this.onPhaseChange = null; // Called when sky phase changes: (newPhase, oldPhase) => void
  }

  /**
   * Set the cycle duration and recalculate speed.
   */
  setCycleDuration(seconds) {
    this.cycleDuration = Math.max(60, seconds); // Minimum 1 minute
    this.speed = 24 / this.cycleDuration;
  }

  /**
   * Get current cycle duration in seconds.
   */
  getCycleDuration() {
    return this.cycleDuration;
  }

  /**
   * Initialize Three.js sky elements
   */
  init() {
    if (typeof THREE === 'undefined' || !this.renderer.scene) return;

    const scene = this.renderer.scene;

    // Sun — directional light
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1);
    scene.add(this.sunLight);

    // Moon — dimmer blue-ish directional light
    this.moonLight = new THREE.DirectionalLight(0x8888cc, 0.3);
    scene.add(this.moonLight);

    // Ambient light — fills in shadows, varies with time of day
    this.ambientLight = new THREE.AmbientLight(0xffffff, AMBIENT_LIGHT.dayIntensity);
    scene.add(this.ambientLight);

    // Cloud layer — billboard approximation
    this._createClouds();

    // Initial sky state
    this._updateSkyState();
  }

  /**
   * Create cloud billboard layer
   */
  _createClouds() {
    if (typeof THREE === 'undefined') return;

    const cloudGroup = new THREE.Group();

    // Simple flat planes as clouds
    const cloudGeometry = new THREE.PlaneGeometry(20, 20);
    const cloudMaterial = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.4,
      side: THREE.DoubleSide,
    });

    // Place several cloud planes at varying heights and positions
    for (let i = 0; i < 20; i++) {
      const cloud = new THREE.Mesh(cloudGeometry, cloudMaterial.clone());
      cloud.position.set(
        (Math.random() - 0.5) * 300,
        60 + Math.random() * 20,
        (Math.random() - 0.5) * 300
      );
      cloud.rotation.x = -Math.PI / 2;
      cloudGroup.add(cloud);
    }

    if (this.renderer.scene) {
      this.renderer.scene.add(cloudGroup);
    }

    this.cloudLayer = cloudGroup;
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

    // Ambient light intensity
    if (this.ambientLight) {
      this.ambientLight.intensity = getAmbientIntensityForTime(this.timeOfDay);
    }

    // Sky color + fog
    this._updateSkyColor();

    // Cloud visibility — clouds dim at night
    if (this.cloudLayer) {
      const isDay = isDaytime(this.timeOfDay);
      const cloudOpacity = isDay ? 0.4 : 0.1;
      this.cloudLayer.children.forEach(child => {
        if (child.material) {
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
   * Update sky based on time of day
   */
  update(deltaTime) {
    // Advance time: speed is hours/second, deltaTime is seconds
    this.timeOfDay += this.speed * deltaTime;
    if (this.timeOfDay >= 24) this.timeOfDay -= 24;

    this._updateSkyState();
  }

  /**
   * Update sky gradient based on time of day
   */
  _updateSkyColor() {
    if (!this.renderer || !this.renderer.scene) return;

    const skyColorHex = getSkyColorForTime(this.timeOfDay);
    const skyColor = new THREE.Color(skyColorHex);

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
   * Get current time of day in hours.
   */
  getTime() {
    return this.timeOfDay;
  }

  /**
   * Set time of day (for testing/debugging).
   */
  setTime(hour) {
    this.timeOfDay = ((hour % 24) + 24) % 24;
    this._updateSkyState();
  }

  /**
   * Get isDay flag.
   */
  isDay() {
    return isDaytime(this.timeOfDay);
  }

  /**
   * Get current sky phase name.
   */
  getPhase() {
    return getSkyPhase(this.timeOfDay);
  }

  /**
   * Get time of day label for HUD display.
   */
  getTimeLabel() {
    return getTimeOfDayLabel(this.timeOfDay);
  }

  /**
   * Format current game time as HH:MM string.
   */
  getFormattedTime() {
    return formatGameTime(this.timeOfDay);
  }

  /**
   * Get normalized time fraction (0-1) for ambient audio integration.
   */
  getTimeFraction() {
    return hoursToFraction(this.timeOfDay);
  }

  /**
   * Get current fog density for debugging.
   */
  getFogDensity() {
    return getFogDensityForTime(this.timeOfDay);
  }

  /**
   * Get current ambient light intensity.
   */
  getAmbientIntensity() {
    return getAmbientIntensityForTime(this.timeOfDay);
  }

  /**
   * Get state summary for debugging/HUD integration.
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
  }

  /**
   * Dispose of Three.js resources.
   */
  dispose() {
    if (this.sunLight && this.renderer.scene) {
      this.renderer.scene.remove(this.sunLight);
    }
    if (this.moonLight && this.renderer.scene) {
      this.renderer.scene.remove(this.moonLight);
    }
    if (this.ambientLight && this.renderer.scene) {
      this.renderer.scene.remove(this.ambientLight);
    }
    if (this.cloudLayer && this.renderer.scene) {
      this.renderer.scene.remove(this.cloudLayer);
    }
    this.sunLight = null;
    this.moonLight = null;
    this.ambientLight = null;
    this.cloudLayer = null;
  }
}

// ============================================================
// Exports — Pure utilities for testing, class for browser use
// ============================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = Skybox;
  module.exports.smoothstep = smoothstep;
  module.exports.lerp = lerp;
  module.exports.lerpColor = lerpColor;
  module.exports.hexToRGB = hexToRGB;
  module.exports.hoursToFraction = hoursToFraction;
  module.exports.fractionToHours = fractionToHours;
  module.exports.getSkyColorForTime = getSkyColorForTime;
  module.exports.isDaytime = isDaytime;
  module.exports.getSkyPhase = getSkyPhase;
  module.exports.getFogDensityForTime = getFogDensityForTime;
  module.exports.getAmbientIntensityForTime = getAmbientIntensityForTime;
  module.exports.getSunAngleForTime = getSunAngleForTime;
  module.exports.getMoonAngleForTime = getMoonAngleForTime;
  module.exports.getSunElevation = getSunElevation;
  module.exports.getMoonElevation = getMoonElevation;
  module.exports.getSunColorForTime = getSunColorForTime;
  module.exports.getSunIntensity = getSunIntensity;
  module.exports.getMoonIntensity = getMoonIntensity;
  module.exports.getTimeOfDayLabel = getTimeOfDayLabel;
  module.exports.formatGameTime = formatGameTime;
  module.exports.DEFAULT_CYCLE_DURATION = DEFAULT_CYCLE_DURATION;
  module.exports.FOG_DENSITY_DAY = FOG_DENSITY_DAY;
  module.exports.FOG_DENSITY_NIGHT = FOG_DENSITY_NIGHT;
  module.exports.AMBIENT_LIGHT = AMBIENT_LIGHT;
  module.exports.SKY_COLORS = SKY_COLORS;

}