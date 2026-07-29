/**
 * Cuubz — Mob Renderer
 * Manages 3D model lifecycle: add/remove/update mob groups in the Three.js scene.
 * Applies per-mesh fog matching the PBR shader's FogExp2 formula.
 */

class MobRenderer {
  /**
   * @param {THREE.Scene} scene
   * @param {MobManager} mobManager
   */
  constructor(scene, mobManager) {
    this.scene = scene;
    this.mobManager = mobManager;
    /** @type {Map<string, {group:THREE.Group, animator:MobAnimator}>} */
    this.renderObjects = new Map();

    // Camera reference (set externally after construction)
    this.camera = null;
  }

  /**
   * Set the camera reference for distance-based fog calculation.
   * @param {THREE.Camera} camera
   */
  setCamera(camera) {
    this.camera = camera;
  }

  /**
   * Add a mob to the scene — builds its 3D model and starts animation.
   * @param {Mob} mob
   */
  addMob(mob) {
    if (typeof THREE === 'undefined') return;
    if (this.renderObjects.has(mob.id)) return;

    const group = MobModelBuilder.build(mob.definition);
    group.position.set(mob.position.x, mob.position.y, mob.position.z);
    group.rotation.y = mob.yaw;

    const animator = new MobAnimator(mob, group);

    this.scene.add(group);
    this.renderObjects.set(mob.id, { group, animator });
  }

  /**
   * Remove a mob from the scene and dispose its resources.
   * @param {string} mobId
   */
  removeMob(mobId) {
    const entry = this.renderObjects.get(mobId);
    if (!entry) return;

    this.scene.remove(entry.group);

    entry.group.traverse(child => {
      if (child.isMesh) {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    });

    this.renderObjects.delete(mobId);
  }

  /**
   * Update all mob render objects — sync positions, run animations, apply fog.
   * @param {number} deltaTime
   */
  update(deltaTime) {
    // Get fog parameters from scene
    let fogColor = null;
    let fogDensity = 0;
    if (this.scene && this.scene.fog) {
      fogColor = this.scene.fog.color;
      if (this.scene.fog.isFogExp2) {
        fogDensity = this.scene.fog.density;
      } else if (this.scene.fog.isFog) {
        // Convert linear fog near/far to equivalent exp2 density
        const far = this.scene.fog.far || 200;
        fogDensity = 2.0 / far;
      }
    }

    // Get camera position
    let camPos = null;
    if (this.camera) {
      camPos = this.camera.position;
    }

    for (const [mobId, entry] of this.renderObjects) {
      const mob = this.mobManager.getMob(mobId);
      if (!mob) {
        this.removeMob(mobId);
        continue;
      }

      // Sync position from data model
      entry.group.position.set(mob.position.x, mob.position.y, mob.position.z);
      entry.group.rotation.y = mob.yaw;

      // Run animations
      entry.animator.update(deltaTime);

      // ── Apply fog to all mesh materials ──
      if (fogColor && fogDensity > 0 && camPos) {
        // Distance from camera to mob center
        const dx = mob.position.x - camPos.x;
        const dy = (mob.position.y + 0.5) - camPos.y;
        const dz = mob.position.z - camPos.z;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        // Exact FogExp2 formula matching PBR shader:
        //   fogFactor = 1 - exp(-density * distance^2)
        const fogFactor = 1 - Math.exp(-fogDensity * dist * dist);
        const clampedFog = Math.max(0, Math.min(1, fogFactor));

        // Apply fog to all mesh children
        entry.group.traverse(child => {
          if (child.isMesh && child.material && child.material.color) {
            // Store original color on first frame
            if (!child.material._origColor) {
              child.material._origColor = child.material.color.clone();
            }
            // Restore original then blend toward fog
            if (clampedFog < 0.005) {
              child.material.color.copy(child.material._origColor);
            } else {
              const r = child.material._origColor.r * (1 - clampedFog) + fogColor.r * clampedFog;
              const g = child.material._origColor.g * (1 - clampedFog) + fogColor.g * clampedFog;
              const b = child.material._origColor.b * (1 - clampedFog) + fogColor.b * clampedFog;
              child.material.color.setRGB(r, g, b);
            }
          }
        });
      }
    }
  }

  /**
   * Remove all mobs from the scene (on world unload).
   */
  clear() {
    for (const [mobId] of this.renderObjects) {
      this.removeMob(mobId);
    }
    this.renderObjects.clear();
  }

  /**
   * Get the number of active render objects.
   * @returns {number}
   */
  get count() {
    return this.renderObjects.size;
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { MobRenderer };
}