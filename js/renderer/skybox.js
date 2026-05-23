/**
 * Cuubz — Skybox & Day/Night Cycle
 * Gradient sky based on time of day, sun/moon positioning, clouds.
 */

class Skybox {
  constructor(renderer) {
    this.renderer = renderer;
    
    // Time of day: 0-24 hours
    this.timeOfDay = 12; // Start at noon
    
    // Day/night speed (hours per real second)
    this.speed = 0.01;
    
    // Sun and moon objects
    this.sunLight = null;
    this.moonLight = null;
    this.cloudLayer = null;
    
    // Sky dome
    this.skyDome = null;
  }

  /**
   * Initialize Three.js sky elements
   */
  init() {
    if (typeof THREE === 'undefined' || !this.renderer.scene) return;
    
    const scene = this.renderer.scene;
    
    // Sun — directional light
    this.sunLight = new THREE.DirectionalLight(0xffffff, 1);
    this.sunLight.position.set(50, 100, 50);
    scene.add(this.sunLight);
    
    // Moon — dimmer blue-ish directional light
    this.moonLight = new THREE.DirectionalLight(0x8888cc, 0.3);
    this.moonLight.position.set(-50, 100, -50);
    scene.add(this.moonLight);
    
    // Cloud layer — billboard approximation
    this._createClouds();
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
   * Update sky based on time of day
   */
  update(deltaTime) {
    // Advance time
    this.timeOfDay += this.speed * deltaTime * 60;
    if (this.timeOfDay >= 24) this.timeOfDay -= 24;
    
    // Calculate sun position (angle from horizon)
    const sunAngle = ((this.timeOfDay - 6) / 12) * Math.PI; // 6am = sunrise, 18pm = sunset
    
    if (this.sunLight) {
      const sunX = Math.cos(sunAngle) * 100;
      const sunY = Math.sin(sunAngle) * 100;
      this.sunLight.position.set(sunX, Math.max(sunY, -10), 50);
      
      // Sun intensity based on elevation
      const elevation = Math.sin(sunAngle);
      this.sunLight.intensity = Math.max(0, elevation) * 1.2;
    }
    
    if (this.moonLight) {
      const moonAngle = ((this.timeOfDay - 18) / 12) * Math.PI;
      const moonX = Math.cos(moonAngle) * 100;
      const moonY = Math.sin(moonAngle) * 100;
      this.moonLight.position.set(moonX, Math.max(moonY, -10), -50);
      
      const elevation = Math.sin(moonAngle);
      this.moonLight.intensity = Math.max(0, elevation) * 0.4;
    }
    
    // Update sky background color
    this._updateSkyColor();
  }

  /**
   * Update sky gradient based on time of day
   */
  _updateSkyColor() {
    if (!this.renderer.scene) return;
    
    const hour = this.timeOfDay;
    let skyColor;
    
    if (hour >= 6 && hour < 8) {
      // Sunrise — orange to blue transition
      const t = (hour - 6) / 2;
      skyColor = new THREE.Color().lerpColors(
        new THREE.Color(0xff6b35), new THREE.Color(0x87CEEB), t
      );
    } else if (hour >= 8 && hour < 17) {
      // Day — blue sky
      skyColor = new THREE.Color(0x87CEEB);
    } else if (hour >= 17 && hour < 19) {
      // Sunset — blue to orange transition
      const t = (hour - 17) / 2;
      skyColor = new THREE.Color().lerpColors(
        new THREE.Color(0x87CEEB), new THREE.Color(0xff6b35), t
      );
    } else if (hour >= 19 && hour < 21) {
      // Dusk — orange to dark blue
      const t = (hour - 19) / 2;
      skyColor = new THREE.Color().lerpColors(
        new THREE.Color(0xff6b35), new THREE.Color(0x0a0a2e), t
      );
    } else {
      // Night — dark blue/black
      skyColor = new THREE.Color(0x0a0a2e);
    }
    
    this.renderer.scene.background = skyColor;
    if (this.renderer.scene.fog) {
      this.renderer.scene.fog.color = skyColor;
    }
  }

  /**
   * Get current time of day
   */
  getTime() {
    return this.timeOfDay;
  }

  /**
   * Set time of day (for testing/debugging)
   */
  setTime(hour) {
    this.timeOfDay = hour % 24;
    this._updateSkyColor();
  }

  /**
   * Get isDay flag
   */
  isDay() {
    return this.timeOfDay >= 6 && this.timeOfDay < 19;
  }
}

module.exports = Skybox;
