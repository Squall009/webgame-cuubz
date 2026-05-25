/**
 * Cuubz — Biome Effects System
 * Runtime visual effects: lava flow animation, toxic slime bubbling, corrupt fog.
 * Updated each frame in the game loop via update(delta).
 */

const { BLOCK_TYPES } = require('../world/chunkData');

/**
 * Lava flow animation configuration
 */
const LAVA_ANIMATION = {
  speed: 0.5,          // UV scroll speed (texels per second)
  colorBase: 0xff6600, // Base lava color (orange-red)
  colorBright: 0xffaa00, // Bright spots (yellow-orange)
  bubbleFrequency: 2.0, // Bubbles appear every ~0.5s per pool
};

/**
 * Toxic slime bubbling animation configuration
 */
const TOXIC_SLIME_ANIMATION = {
  speed: 0.3,          // UV scroll speed (slower than lava)
  colorBase: 0x9933cc, // Base purple color
  colorBright: 0xcc66ff, // Bright bubble spots
  bubbleFrequency: 1.5, // Bubbles appear every ~0.67s per pool
};

/**
 * Corrupt biome fog configuration
 */
const CORRUPT_FOG = {
  colorDay: 0x4a2060,   // Purple-tinted fog during day
  colorNight: 0x1a0830, // Dark purple fog at night
  densityBase: 0.015,   // Base fog density (slightly thicker than normal)
  densityCorruptZone: 0.03, // Extra dense near corrupt biome features
  pulseSpeed: 0.2,      // Fog pulses slowly for eerie effect
  pulseAmplitude: 0.005, // How much density varies during pulse
};

/**
 * Particle effect data for lava bubbles and toxic slime pops
 */
class ParticleEffect {
  constructor(x, y, z, color, lifetime) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.color = color;
    this.lifetime = lifetime; // seconds
    this.age = 0;
    this.active = true;
    this.velocity = 0.5 + Math.random() * 0.5; // rise speed
    this.size = 0.1 + Math.random() * 0.1; // particle size in block units
  }

  update(delta) {
    this.age += delta;
    this.y += this.velocity * delta; // Rise upward
    
    if (this.age >= this.lifetime) {
      this.active = false;
    }
  }

  getAlpha() {
    // Fade in quickly, fade out slowly
    const fadeIn = Math.min(this.age / 0.2, 1);
    const fadeOut = Math.max(1 - (this.age - this.lifetime * 0.5) / (this.lifetime * 0.5), 0);
    return fadeIn * fadeOut;
  }

  getScale() {
    // Grow then shrink
    if (this.age < this.lifetime * 0.3) {
      return this.size * (this.age / (this.lifetime * 0.3));
    }
    return this.size * Math.max(1 - (this.age - this.lifetime * 0.3) / (this.lifetime * 0.7), 0);
  }
}

/**
 * Biome Effects Manager
 * Handles all runtime visual effects per biome type.
 * Testable without Three.js via Node.js mode.
 */
class BiomeEffects {
  constructor() {
    this.time = 0;
    
    // UV animation offsets (updated each frame)
    this.lavaOffset = 0;      // UV offset for lava texture animation
    this.toxicOffset = 0;     // UV offset for toxic slime texture animation
    
    // Particle systems
    this.particles = [];
    this.bubbleTimers = {
      lava: 0,
      toxicSlime: 0,
    };
    
    // Fog state
    this.fogColor = null;
    this.fogDensity = CORRUPT_FOG.densityBase;
    this.fogPulsePhase = 0;
    
    // Active biome tracking
    this.currentBiome = 'plains';
    this.inCorruptZone = false;
    
    // Three.js references (set at runtime)
    this.scene = null;
    this.renderer = null;
    this.enabled = true;
  }

  /**
   * Update all effects for this frame
   * @param {number} delta - Time since last frame in seconds
   */
  update(delta) {
    if (!this.enabled) return;
    
    this.time += delta;
    
    // Update UV animation offsets
    this.lavaOffset = (this.time * LAVA_ANIMATION.speed) % 1.0;
    this.toxicOffset = (this.time * TOXIC_SLIME_ANIMATION.speed) % 1.0;
    
    // Update fog pulse
    this.fogPulsePhase += delta * CORRUPT_FOG.pulseSpeed;
    const pulseValue = Math.sin(this.fogPulsePhase);
    this.fogDensity = CORRUPT_FOG.densityBase + 
                      pulseValue * CORRUPT_FOG.pulseAmplitude;
    
    // Apply corrupt zone density boost
    if (this.inCorruptZone) {
      this.fogDensity += CORRUPT_FOG.densityCorruptZone;
    }
    
    // Update particles
    for (const particle of this.particles) {
      particle.update(delta);
    }
    this.particles = this.particles.filter(p => p.active);
    
    // Spawn new bubble particles periodically
    this.bubbleTimers.lava += delta;
    this.bubbleTimers.toxicSlime += delta;
  }

  /**
   * Set the current biome for fog color selection
   */
  setBiome(biomeId) {
    this.currentBiome = biomeId;
    
    if (biomeId === 'corrupt') {
      this.inCorruptZone = true;
    } else {
      this.inCorruptZone = false;
    }
  }

  /**
   * Set day/night fraction for fog color interpolation
   * @param {number} timeOfDay - 0-24 hour value
   */
  setDayNightFraction(timeOfDay) {
    if (this.currentBiome !== 'corrupt') return;
    
    // Determine if it's night or day
    const isNight = timeOfDay < 6 || timeOfDay > 18;
    
    if (typeof THREE !== 'undefined') {
      const targetColor = isNight ? CORRUPT_FOG.colorNight : CORRUPT_FOG.colorDay;
      this.fogColor = new THREE.Color(targetColor);
      
      // Apply to scene fog if available
      if (this.scene && this.scene.fog) {
        this.scene.fog.color.copy(this.fogColor);
        this.scene.fog.density = this.fogDensity;
      }
    }
  }

  /**
   * Get the current lava UV offset for texture animation
   */
  getLavaUvOffset() {
    return this.lavaOffset;
  }

  /**
   * Get the current toxic slime UV offset for texture animation
   */
  getToxicSlimeUvOffset() {
    return this.toxicOffset;
  }

  /**
   * Get the current fog density value
   */
  getFogDensity() {
    return this.fogDensity;
  }

  /**
   * Get the current fog color (as hex number, works in Node.js)
   */
  getFogColorHex() {
    if (this.currentBiome !== 'corrupt') return null;
    
    // Return approximate color based on time
    const isNight = this.time % 300 < 60 || this.time % 300 > 240; // Rough day/night cycle
    return isNight ? CORRUPT_FOG.colorNight : CORRUPT_FOG.colorDay;
  }

  /**
   * Spawn lava bubble particles at a pool location
   * @param {number} x - World X coordinate of lava pool center
   * @param {number} y - World Y coordinate (surface level)
   * @param {number} z - World Z coordinate
   */
  spawnLavaBubbles(x, y, z) {
    const count = 1 + Math.floor(Math.random() * 2); // 1-2 bubbles per spawn
    for (let i = 0; i < count; i++) {
      const px = x + (Math.random() - 0.5) * 3;
      const py = y;
      const pz = z + (Math.random() - 0.5) * 3;
      const lifetime = 1.0 + Math.random() * 1.0; // 1-2 seconds
      
      this.particles.push(new ParticleEffect(
        px, py, pz,
        LAVA_ANIMATION.colorBright,
        lifetime
      ));
    }
  }

  /**
   * Spawn toxic slime bubble particles at a pool location
   */
  spawnToxicBubbles(x, y, z) {
    const count = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < count; i++) {
      const px = x + (Math.random() - 0.5) * 3;
      const py = y;
      const pz = z + (Math.random() - 0.5) * 3;
      const lifetime = 1.2 + Math.random() * 0.8; // 1-2 seconds
      
      this.particles.push(new ParticleEffect(
        px, py, pz,
        TOXIC_SLIME_ANIMATION.colorBright,
        lifetime
      ));
    }
  }

  /**
   * Get active particles (for rendering)
   */
  getActiveParticles() {
    return this.particles.filter(p => p.active);
  }

  /**
   * Get state summary for debugging/HUD integration
   */
  getStateSummary() {
    return {
      time: Math.round(this.time * 10) / 10,
      biome: this.currentBiome,
      inCorruptZone: this.inCorruptZone,
      lavaOffset: Math.round(this.lavaOffset * 1000) / 1000,
      toxicOffset: Math.round(this.toxicOffset * 1000) / 1000,
      fogDensity: Math.round(this.fogDensity * 10000) / 10000,
      particleCount: this.particles.length,
      activeParticles: this.getActiveParticles().length,
    };
  }

  /**
   * Initialize Three.js scene integration
   */
  init(scene, renderer) {
    if (typeof THREE === 'undefined') return false;
    
    this.scene = scene;
    this.renderer = renderer;
    return true;
  }

  /**
   * Dispose of all resources
   */
  dispose() {
    this.particles = [];
    this.scene = null;
    this.renderer = null;
    this.enabled = false;
  }
}

module.exports = { BiomeEffects, ParticleEffect, LAVA_ANIMATION, TOXIC_SLIME_ANIMATION, CORRUPT_FOG };
