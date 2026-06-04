/**
 * Cuubz — Biome Effects System
 * 
 * Applies visual effects based on current biome:
 * - Fog color/density transitions per biome
 * - Sky color adjustments (renderer.setClearColor)
 * - Particle systems (lava bubbles, toxic particles, snowflakes)
 * - Integrated with Three.js scene via init(scene, renderer)
 */

class BiomeEffects {
  constructor() {
    this.currentBiome = 'plains';
    this.targetFogColor = new THREE.Color(0xc4d8e8);
    this.targetSkyColor = new THREE.Color(0x87ceeb);
    this.targetFogNear = 50;
    this.targetFogFar = 300;
    
    // Actual values (smoothly interpolated toward targets)
    this.currentFogColor = new THREE.Color(0xc4d8e8);
    this.currentSkyColor = new THREE.Color(0x87ceeb);
    this.currentFogNear = 50;
    this.currentFogFar = 300;
    
    // Scene references (set by init)
    this.scene = null;
    this.renderer = null;
    
    // Player/camera tracking for particles
    this.playerPos = { x: 0, y: 0, z: 0 };
    this.cameraPos = { x: 0, y: 0, z: 0 };
    
    // Particle systems per biome type
    this.particles = [];
    
    // Animation state
    this.lerpSpeed = 2.0; // How fast fog/sky transitions (higher = faster)
    this.lastUpdate = performance.now();
    
    // Biome-specific configuration
    this.biomeConfigs = {
      ocean:     { fogColor: 0x8bb5d4, skyColor: 0x7fb3d3, fogNear: 40,  fogFar: 280 },
      plains:    { fogColor: 0xc4d8e8, skyColor: 0x87ceeb, fogNear: 50,  fogFar: 300 },
      forest:    { fogColor: 0x6b8f5e, skyColor: 0x5a8c6a, fogNear: 40,  fogFar: 250 },
      desert:    { fogColor: 0xd4b97a, skyColor: 0xf4a460, fogNear: 60,  fogFar: 350 },
      tundra:    { fogColor: 0xc8dce8, skyColor: 0xb0c4de, fogNear: 45,  fogFar: 270 },
      mountains: { fogColor: 0x9a9a9a, skyColor: 0xa0b0c0, fogNear: 35,  fogFar: 220 },
      lava:      { fogColor: 0x4a1a0a, skyColor: 0x8b2500, fogNear: 30,  fogFar: 180 },
      corrupt:   { fogColor: 0x2a3a2a, skyColor: 0x3a2a4a, fogNear: 25,  fogFar: 160 }
    };
    
    // Particle pool (reusable objects)
    this.particlePool = [];
  }
  
  /**
   * Initialize with Three.js scene and renderer.
   */
  init(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    
    // Apply initial fog/sky
    if (this.scene && THREE.FogExp2) {
      const fog = new THREE.FogExp2(0x87ceeb, 0.005);
      this.scene.fog = fog;
    }
    
    if (this.renderer) {
      this.renderer.setClearColor(0x87ceeb);
    }
    
    console.log('[BiomeEffects] Initialized with scene and renderer');
  }
  
  /**
   * Set the current biome by ID string. Triggers visual transition.
   */
  setBiome(biomeId) {
    if (biomeId === this.currentBiome) return; // No change
    
    const config = this.biomeConfigs[biomeId];
    if (!config) {
      console.warn(`[BiomeEffects] Unknown biome: ${biomeId}, using plains defaults`);
      return;
    }
    
    this.currentBiome = biomeId;
    this.targetFogColor.setHex(config.fogColor);
    this.targetSkyColor.setHex(config.skyColor);
    this.targetFogNear = config.fogNear;
    this.targetFogFar = config.fogFar;
  }
  
  /**
   * Track player position for particle spawning near the player.
   */
  setPlayerPosition(x, y, z) {
    this.playerPos.x = x;
    this.playerPos.y = y;
    this.playerPos.z = z;
  }
  
  /**
   * Track camera position for billboarding particles toward the view direction.
   */
  setCameraPosition(camPos) {
    if (camPos && camPos.x !== undefined) {
      this.cameraPos.x = camPos.x;
      this.cameraPos.y = camPos.y;
      this.cameraPos.z = camPos.z;
    } else if (typeof camPos === 'number') {
      // Fallback: just x coordinate passed directly
      this.cameraPos.x = camPos;
    }
  }
  
  /**
   * Spawn lava bubble particles at the given position.
   */
  spawnLavaBubbles(x, y, z) {
    if (!this.scene || !THREE) return;
    
    const particle = this._getOrCreateParticle();
    particle.position.set(
      x + (Math.random() - 0.5) * 2,
      y + Math.random(),
      z + (Math.random() - 0.5) * 2
    );
    particle.userData.type = 'lava_bubble';
    particle.userData.life = 1.0; // seconds
    particle.userData.maxLife = 1.0;
    particle.userData.velocity = { x: 0, y: 1 + Math.random() * 1.5, z: 0 };
    
    if (!particle.parent) {
      this.scene.add(particle);
    }
    this.particles.push(particle);
  }
  
  /**
   * Spawn toxic/corrupt bubble particles at the given position.
   */
  spawnToxicBubbles(x, y, z) {
    if (!this.scene || !THREE) return;
    
    const particle = this._getOrCreateParticle();
    particle.position.set(
      x + (Math.random() - 0.5) * 3,
      y + Math.random(),
      z + (Math.random() - 0.5) * 3
    );
    particle.userData.type = 'toxic_bubble';
    particle.userData.life = 2.0; // seconds — toxic floats longer
    particle.userData.maxLife = 2.0;
    particle.userData.velocity = { x: (Math.random() - 0.5) * 0.3, y: 0.5 + Math.random(), z: (Math.random() - 0.5) * 0.3 };
    
    if (!particle.parent) {
      this.scene.add(particle);
    }
    this.particles.push(particle);
  }
  
  /**
   * Update loop — called every frame with delta time in seconds.
   * Handles fog/sky interpolation and particle animation.
   */
  update(deltaTime) {
    if (!this.scene || !this.renderer) return;
    
    // Lerp fog color toward target
    this._lerpColor(this.currentFogColor, this.targetFogColor, deltaTime);
    this._lerpColor(this.currentSkyColor, this.targetSkyColor, deltaTime);
    
    // Smoothly transition fog density range
    const nearDiff = this.targetFogNear - this.currentFogNear;
    const farDiff = this.targetFogFar - this.currentFogFar;
    if (Math.abs(nearDiff) > 0.5) this.currentFogNear += nearDiff * this.lerpSpeed * deltaTime;
    if (Math.abs(farDiff) > 0.5) this.currentFogFar += farDiff * this.lerpSpeed * deltaTime;
    
    // Apply fog to scene using FogExp2 for smooth falloff
    const density = 1 / (this.currentFogNear + (this.currentFogFar - this.currentFogNear));
    if (!this.scene.fog || !(this.scene.fog instanceof THREE.FogExp2)) {
      this.scene.fog = new THREE.FogExp2(this.currentFogColor.getHex(), density);
    } else {
      this.scene.fog.color.copy(this.currentFogColor);
      // Recalculate density based on near/far range
      this.scene.fog.density = Math.max(0.001, 1 / (this.currentFogFar - this.currentFogNear) * Math.log(5));
    }
    
    // Apply sky color to renderer background
    this.renderer.setClearColor(this.currentSkyColor);
    
    // Update particles
    this._updateParticles(deltaTime);
  }
  
  /**
   * Linearly interpolate a THREE.Color toward target.
   */
  _lerpColor(current, target, dt) {
    const speed = this.lerpSpeed * dt;
    current.r += (target.r - current.r) * Math.min(1, speed);
    current.g += (target.g - current.g) * Math.min(1, speed);
    current.b += (target.b - current.b) * Math.min(1, speed);
  }
  
  /**
   * Get a reusable particle sprite from pool or create new one.
   */
  _getOrCreateParticle() {
    if (this.particlePool.length > 0) {
      return this.particlePool.pop();
    }
    
    // Create simple point-sprite particle using Points geometry
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array([0, 0, 0]);
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    
    // Simple colored material — no texture needed for particles
    const mat = new THREE.PointsMaterial({
      size: 0.15,
      color: 0xff4400, // Default lava orange, set per-type below
      transparent: true,
      opacity: 0.8,
      depthWrite: false
    });
    
    const points = new THREE.Points(geo, mat);
    return points;
  }
  
  /**
   * Update all active particles: position, life, visibility.
   */
  _updateParticles(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      const ud = p.userData;
      
      // Decrease life
      ud.life -= dt;
      
      if (ud.life <= 0) {
        // Remove expired particle
        if (p.parent) p.parent.remove(p);
        this.particles.splice(i, 1);
        this.particlePool.push(p);
        continue;
      }
      
      // Apply velocity
      const pos = p.position;
      pos.x += ud.velocity.x * dt;
      pos.y += ud.velocity.y * dt;
      pos.z += ud.velocity.z * dt;
      
      // Fade out based on remaining life
      const lifeRatio = ud.life / ud.maxLife;
      if (p.material) {
        p.material.opacity = Math.min(0.8, lifeRatio);
        
        // Color by type
        if (ud.type === 'lava_bubble') {
          // Orange/red glow that fades to dark red
          const r = 1.0;
          const g = 0.2 + 0.3 * lifeRatio;
          const b = 0.05 * lifeRatio;
          p.material.color.setRGB(r, g, b);
        } else if (ud.type === 'toxic_bubble') {
          // Purple/green toxic color
          const r = 0.2 + 0.3 * lifeRatio;
          const g = 0.6 * lifeRatio;
          const b = 0.4 + 0.3 * lifeRatio;
          p.material.color.setRGB(r, g, b);
        }
        
        // Scale by life — particles shrink as they die
        p.material.size = 0.15 + 0.1 * lifeRatio;
      }
      
      // Remove if too far from player (optimization)
      const dx = pos.x - this.playerPos.x;
      const dy = pos.y - this.playerPos.y;
      const dz = pos.z - this.playerPos.z;
      const distSq = dx*dx + dy*dy + dz*dz;
      if (distSq > 100 * 100) { // 100 blocks away — cull it
        if (p.parent) p.parent.remove(p);
        this.particles.splice(i, 1);
        this.particlePool.push(p);
      }
    }
    
    // Cap active particles to prevent performance issues
    while (this.particles.length > 200) {
      const oldest = this.particles.shift();
      if (oldest.parent) oldest.parent.remove(oldest);
      this.particlePool.push(oldest);
    }
  }
  
  /**
   * Cleanup: remove all particles and release resources.
   */
  dispose() {
    for (const p of [...this.particles, ...this.particlePool]) {
      if (p.parent) p.parent.remove(p);
      if (p.geometry) p.geometry.dispose();
      if (p.material) p.material.dispose();
    }
    this.particles = [];
    this.particlePool = [];
  }
}

if (typeof module !== 'undefined') module.exports = { BiomeEffects };
