/**
 * Cuubz — Quest Marker Entity
 * Glowing post/beacon in world at quest target locations.
 * Visible from distance with particle effect. Interact to receive quest update/dialogue.
 */

// ============================================================
// Constants
// ============================================================

const MARKER_HEIGHT = 2.0;         // Total height in blocks
const MARKER_WIDTH = 0.3;          // Post width in blocks
const INTERACTION_RANGE = 3.0;     // Blocks — player must be within this to interact
const VISIBILITY_RADIUS = 64.0;    // Blocks — marker visible from this distance
const GLOW_PULSE_SPEED = 2.0;      // Radians per second for glow animation
const PARTICLE_COUNT = 8;          // Number of particles orbiting the marker

// Marker colors by quest type (hex)
const MARKER_COLORS = {
  collect:   0x4CAF50,  // Green — gathering quests
  kill:      0xF44336,  // Red — combat quests
  explore:   0x2196F3,  // Blue — exploration quests
  craft:     0xFF9800,  // Orange — crafting quests
  deliver:   0x9C27B0,  // Purple — delivery quests
  boss:      0xFFD700,  // Gold — boss quests
};

// Default marker color for unknown quest types
const DEFAULT_MARKER_COLOR = 0xFFFFFF;

// ============================================================
// QuestMarker Class
// ============================================================

class QuestMarker {
  /**
   * Create a quest marker at a given position.
   * @param {string} questId — The quest this marker belongs to
   * @param {Object} options — Configuration
   * @param {number} options.x — World X coordinate
   * @param {number} options.y — World Y coordinate
   * @param {number} options.z — World Z coordinate
   * @param {string} options.questType — Quest type for color selection
   * @param {string} options.biome — Biome where marker is placed
   * @param {boolean} options.active — Whether the marker is active (glowing)
   */
  constructor(questId, options = {}) {
    this.questId = questId;
    this.position = {
      x: options.x || 0,
      y: options.y || 0,
      z: options.z || 0,
    };
    this.questType = options.questType || 'collect';
    this.biome = options.biome || 'plains';
    this.active = options.active !== undefined ? options.active : true;

    // Visual state
    this.glowIntensity = 1.0;       // 0.0–1.0 glow intensity
    this.pulsePhase = 0.0;          // Animation phase for pulsing glow
    this.visible = true;            // Whether marker is rendered on screen
    this.inInteractionRange = false;// Whether player can interact

    // Three.js references (set by renderer integration)
    this.mesh = null;               // Main post mesh
    this.glowMesh = null;           // Outer glow sphere
    this.particles = [];            // Orbiting particle meshes
    this.labelSprite = null;        // Text label above marker

    // Interaction state
    this.interacted = false;        // Whether player has interacted with this marker
    this.questUpdateData = null;    // Data returned on interaction
  }

  /**
   * Get the display color for this marker based on quest type.
   * @returns {number} Hex color value
   */
  getDisplayColor() {
    return MARKER_COLORS[this.questType] || DEFAULT_MARKER_COLOR;
  }

  /**
   * Calculate squared distance from a position to this marker.
   * @param {Object} pos — { x, y, z } position to measure from
   * @returns {number} Squared distance (avoids sqrt for performance)
   */
  squaredDistanceFrom(pos) {
    const dx = pos.x - this.position.x;
    const dy = pos.y - this.position.y;
    const dz = pos.z - this.position.z;
    return dx * dx + dy * dy + dz * dz;
  }

  /**
   * Calculate distance from a position to this marker.
   * @param {Object} pos — { x, y, z } position to measure from
   * @returns {number} Distance in blocks
   */
  distanceFrom(pos) {
    return Math.sqrt(this.squaredDistanceFrom(pos));
  }

  /**
   * Check if a position is within interaction range.
   * @param {Object} pos — { x, y, z } player position
   * @returns {boolean} True if within INTERACTION_RANGE blocks
   */
  isInInteractionRange(pos) {
    return this.squaredDistanceFrom(pos) <= INTERACTION_RANGE * INTERACTION_RANGE;
  }

  /**
   * Check if a position is within visibility range.
   * @param {Object} pos — { x, y, z } camera/player position
   * @returns {boolean} True if within VISIBILITY_RADIUS blocks
   */
  isInVisibilityRange(pos) {
    return this.squaredDistanceFrom(pos) <= VISIBILITY_RADIUS * VISIBILITY_RADIUS;
  }

  /**
   * Update marker state based on player position and time delta.
   * Handles visibility, interaction range, and glow animation.
   * @param {Object} playerPos — { x, y, z } current player position
   * @param {number} deltaTime — Time elapsed since last update in seconds
   */
  update(playerPos, deltaTime) {
    if (!playerPos || deltaTime <= 0) return;

    // Update visibility based on distance
    this.visible = this.isInVisibilityRange(playerPos);

    // Update interaction range
    this.inInteractionRange = !this.interacted && this.active && this.isInInteractionRange(playerPos);

    // Update glow pulse animation
    if (this.active) {
      this.pulsePhase += GLOW_PULSE_SPEED * deltaTime;
      // Sinusoidal pulse: 0.5 to 1.0 intensity
      this.glowIntensity = 0.5 + 0.5 * Math.sin(this.pulsePhase);
    } else {
      this.glowIntensity = 0.0;
    }

    // Update particle positions (orbit around marker)
    this._updateParticles(deltaTime);
  }

  /**
   * Update orbiting particle positions.
   * @param {number} deltaTime — Time elapsed since last update
   */
  _updateParticles(deltaTime) {
    if (!this.mesh) return;
    const orbitRadius = MARKER_HEIGHT * 0.6;
    const orbitSpeed = 1.5; // Radians per second

    for (let i = 0; i < this.particles.length; i++) {
      const particle = this.particles[i];
      if (!particle) continue;

      // Each particle has a unique offset phase
      const phaseOffset = (i / PARTICLE_COUNT) * Math.PI * 2;
      const angle = this.pulsePhase * orbitSpeed + phaseOffset;

      // Vertical oscillation
      const yOffset = Math.sin(angle * 2 + i) * MARKER_HEIGHT * 0.3;

      particle.position.set(
        this.position.x + Math.cos(angle) * orbitRadius,
        this.position.y + MARKER_HEIGHT * 0.5 + yOffset,
        this.position.z + Math.sin(angle) * orbitRadius
      );

      // Particle opacity based on glow intensity
      if (particle.material && particle.material.opacity !== undefined) {
        particle.material.opacity = this.glowIntensity * 0.7;
      }
    }
  }

  /**
   * Handle player interaction with the marker.
   * Returns quest update data for UI display.
   * @param {Object} questSystem — QuestSystem instance for progress lookup
   * @returns {Object|null} Interaction data or null if already interacted
   */
  interact(questSystem) {
    if (this.interacted || !this.active) return null;

    this.interacted = true;

    const questData = questSystem ? questSystem.getQuest(this.questId) : null;
    const progress = questSystem ? questSystem.getProgress(this.questId) : null;

    this.questUpdateData = {
      questId: this.questId,
      name: questData ? questData.name : 'Unknown Quest',
      description: questData ? questData.description : '',
      type: this.questType,
      progress: progress || {},
      markerPosition: { ...this.position },
    };

    return this.questUpdateData;
  }

  /**
   * Reset the marker to its initial state (for new game session).
   */
  reset() {
    this.interacted = false;
    this.questUpdateData = null;
    this.glowIntensity = 1.0;
    this.pulsePhase = 0.0;
    this.visible = true;
    this.inInteractionRange = false;
  }

  /**
   * Toggle marker active state (e.g., after quest completion).
   * @param {boolean} isActive — Whether the marker should be active
   */
  setActive(isActive) {
    this.active = !!isActive;
    if (!this.active) {
      this.glowIntensity = 0.0;
      this.inInteractionRange = false;
    }
  }

  /**
   * Create the Three.js visual representation of this marker.
   * Must be called when THREE is available (browser context).
   * @param {THREE.Scene} scene — The Three.js scene to add to
   * @returns {Object} Created meshes for cleanup
   */
  createMesh(scene) {
    if (typeof THREE === 'undefined' || !scene) {
      return { mesh: null, glowMesh: null, particles: [] };
    }

    const color = this.getDisplayColor();
    const markerGroup = new THREE.Group();
    markerGroup.position.set(this.position.x, this.position.y, this.position.z);

    // 1. Main post — tall thin box with emissive glow
    const postGeometry = new THREE.BoxGeometry(MARKER_WIDTH, MARKER_HEIGHT, MARKER_WIDTH);
    const postMaterial = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.5,
      transparent: true,
      opacity: 0.9,
    });
    this.mesh = new THREE.Mesh(postGeometry, postMaterial);
    this.mesh.position.y = MARKER_HEIGHT / 2;
    markerGroup.add(this.mesh);

    // 2. Glow sphere — slightly larger transparent sphere around top
    const glowGeometry = new THREE.SphereGeometry(MARKER_WIDTH * 2, 8, 8);
    const glowMaterial = new THREE.MeshBasicMaterial({
      color: color,
      transparent: true,
      opacity: 0.3,
    });
    this.glowMesh = new THREE.Mesh(glowGeometry, glowMaterial);
    this.glowMesh.position.y = MARKER_HEIGHT * 0.8;
    markerGroup.add(this.glowMesh);

    // 3. Beacon light — point light at top
    const beaconLight = new THREE.PointLight(color, 1.0, VISIBILITY_RADIUS * 0.5);
    beaconLight.position.y = MARKER_HEIGHT + 0.5;
    markerGroup.add(beaconLight);

    // 4. Orbiting particles
    const particleGeometry = new THREE.SphereGeometry(0.08, 4, 4);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const particleMaterial = new THREE.MeshBasicMaterial({
        color: color,
        transparent: true,
        opacity: 0.7,
      });
      const particle = new THREE.Mesh(particleGeometry, particleMaterial);
      this.particles.push(particle);
      markerGroup.add(particle);
    }

    scene.add(markerGroup);
    return { mesh: this.mesh, glowMesh: this.glowMesh, particles: this.particles };
  }

  /**
   * Update the visual appearance of the marker each frame.
   * @param {number} deltaTime — Time elapsed since last frame
   */
  updateVisuals(deltaTime) {
    if (!this.mesh || typeof THREE === 'undefined') return;

    // Pulse emissive intensity
    if (this.mesh.material && this.mesh.material.emissiveIntensity !== undefined) {
      this.mesh.material.emissiveIntensity = 0.3 + this.glowIntensity * 0.7;
    }

    // Pulse glow sphere scale and opacity
    if (this.glowMesh) {
      const pulseScale = 1.0 + this.glowIntensity * 0.3;
      this.glowMesh.scale.set(pulseScale, pulseScale, pulseScale);
      if (this.glowMesh.material && this.glowMesh.material.opacity !== undefined) {
        this.glowMesh.material.opacity = 0.15 + this.glowIntensity * 0.25;
      }
    }

    // Update particle positions and opacity
    this._updateParticles(deltaTime);

    // Toggle visibility based on distance
    if (this.mesh.parent) {
      this.mesh.parent.visible = this.visible && this.active;
    }
  }

  /**
   * Remove all Three.js meshes from the scene.
   */
  dispose(scene) {
    if (!scene || typeof THREE === 'undefined') return;

    // Remove all children of marker group (mesh, glow, particles, light)
    if (this.mesh && this.mesh.parent) {
      const children = [...this.mesh.parent.children];
      for (const child of children) {
        scene.remove(child);
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach(m => m.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
      scene.remove(this.mesh.parent);
      this.mesh.parent = null;
    }

    this.mesh = null;
    this.glowMesh = null;
    this.particles = [];
    this.labelSprite = null;
  }

  /**
   * Serialize marker state for persistence.
   * @returns {Object} Serializable marker data
   */
  serialize() {
    return {
      questId: this.questId,
      position: { ...this.position },
      questType: this.questType,
      biome: this.biome,
      active: this.active,
      interacted: this.interacted,
    };
  }

  /**
   * Deserialize marker state from persistence data.
   * @param {Object} data — Serialized marker data
   * @returns {QuestMarker} New QuestMarker instance
   */
  static deserialize(data) {
    if (!data || !data.questId || !data.position) return null;
    return new QuestMarker(data.questId, {
      x: data.position.x,
      y: data.position.y,
      z: data.position.z,
      questType: data.questType || 'collect',
      biome: data.biome || 'plains',
      active: data.active !== undefined ? data.active : true,
    });
  }
}

// ============================================================
// QuestMarkerManager — Manages all quest markers in the world
// ============================================================

class QuestMarkerManager {
  /**
   * Create a marker manager.
   * @param {Object} options — Configuration
   * @param {number} options.worldSeed — World seed for deterministic placement
   */
  constructor(options = {}) {
    this.markers = [];              // Array of QuestMarker instances
    this.activeMarkers = [];        // Only currently active markers
    this.worldSeed = options.worldSeed || 'default';
    this._questSystem = null;       // Set via setQuestSystem()
  }

  /**
   * Set the quest system reference for marker creation and interaction.
   * @param {Object} questSystem — QuestSystem instance
   */
  setQuestSystem(questSystem) {
    this._questSystem = questSystem;
  }

  /**
   * Create markers for all quests based on the world seed.
   * Uses QuestSystem.getMarkerPosition() for deterministic placement.
   * @returns {number} Number of markers created
   */
  createAllMarkers() {
    if (!this._questSystem) return 0;

    this.markers = [];
    const qr = typeof QUEST_REGISTRY !== 'undefined' ? QUEST_REGISTRY : [];

    for (const quest of qr) {
      const pos = this._questSystem.getMarkerPosition(quest.id, this.worldSeed);
      if (!pos) continue;

      const marker = new QuestMarker(quest.id, {
        x: pos.x,
        y: Math.max(pos.y, 0), // Ensure above bedrock
        z: pos.z,
        questType: quest.type,
        biome: pos.biome || quest.markerBiome || 'plains',
        active: true,
      });

      this.markers.push(marker);
    }

    this._updateActiveMarkers();
    return this.markers.length;
  }

  /**
   * Update the list of active markers based on quest progress.
   * Markers are active for all non-completed quests (locked, available, in-progress).
   * Only completed quests have their markers deactivated.
   */
  _updateActiveMarkers() {
    if (!this._questSystem) return;

    this.activeMarkers = this.markers.filter(m => {
      const progress = this._questSystem.getProgress(m.questId);
      // No progress data (locked/untracked) or not completed → active
      if (!progress) return true;
      return progress.state !== 'complete';
    });
  }

  /**
   * Update all markers based on player position.
   * @param {Object} playerPos — { x, y, z } player position
   * @param {number} deltaTime — Time delta in seconds
   */
  update(playerPos, deltaTime) {
    for (const marker of this.markers) {
      marker.update(playerPos, deltaTime);
    }
  }

  /**
   * Get markers within interaction range of player.
   * @param {Object} playerPos — { x, y, z } player position
   * @returns {Array<QuestMarker>} Markers the player can interact with
   */
  getInteractableMarkers(playerPos) {
    return this.markers.filter(m => m.inInteractionRange);
  }

  /**
   * Get the closest marker to a position.
   * @param {Object} pos — { x, y, z } position
   * @returns {QuestMarker|null} Closest marker or null
   */
  getClosestMarker(pos) {
    let closest = null;
    let minDistSq = Infinity;

    for (const marker of this.activeMarkers) {
      const distSq = marker.squaredDistanceFrom(pos);
      if (distSq < minDistSq) {
        minDistSq = distSq;
        closest = marker;
      }
    }

    return closest;
  }

  /**
   * Get all markers for a specific quest stage range.
   * @param {number} minStage — Minimum quest stage (inclusive)
   * @param {number} maxStage — Maximum quest stage (inclusive)
   * @returns {Array<QuestMarker>} Markers in the given stage range
   */
  getMarkersByStageRange(minStage, maxStage) {
    const qr = typeof QUEST_REGISTRY !== 'undefined' ? QUEST_REGISTRY : [];
    const stageIds = new Set(
      qr.filter(q => q.stage >= minStage && q.stage <= maxStage).map(q => q.id)
    );
    return this.markers.filter(m => stageIds.has(m.questId));
  }

  /**
   * Get markers by biome.
   * @param {string} biome — Biome name to filter by
   * @returns {Array<QuestMarker>} Markers in the specified biome
   */
  getMarkersByBiome(biome) {
    return this.markers.filter(m => m.biome === biome);
  }

  /**
   * Deactivate markers for completed quests.
   */
  deactivateCompleted() {
    if (!this._questSystem) return;

    for (const marker of this.markers) {
      const progress = this._questSystem.getProgress(marker.questId);
      if (progress && progress.completed) {
        marker.setActive(false);
      }
    }
    this._updateActiveMarkers();
  }

  /**
   * Create all marker meshes in a Three.js scene.
   * @param {THREE.Scene} scene — Scene to add markers to
   */
  createAllMeshes(scene) {
    for (const marker of this.markers) {
      marker.createMesh(scene);
    }
  }

  /**
   * Update all marker visuals each frame.
   * @param {number} deltaTime — Time delta in seconds
   */
  updateAllVisuals(deltaTime) {
    for (const marker of this.markers) {
      marker.updateVisuals(deltaTime);
    }
  }

  /**
   * Dispose all marker meshes from the scene.
   * @param {THREE.Scene} scene — Scene to remove markers from
   */
  disposeAll(scene) {
    for (const marker of this.markers) {
      marker.dispose(scene);
    }
  }

  /**
   * Serialize all marker states.
   * @returns {Array<Object>} Array of serialized marker data
   */
  serializeAll() {
    return this.markers.map(m => m.serialize());
  }

  /**
   * Deserialize and recreate markers from saved state.
   * @param {Array<Object>} data — Array of serialized marker data
   */
  deserializeAll(data) {
    if (!data || !Array.isArray(data)) return;
    this.markers = data.map(d => QuestMarker.deserialize(d)).filter(Boolean);
    this._updateActiveMarkers();
  }

  /**
   * Reset all markers to initial state.
   */
  resetAll() {
    for (const marker of this.markers) {
      marker.reset();
    }
  }
}

// ============================================================
// Module Exports
// ============================================================

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    MARKER_HEIGHT,
    MARKER_WIDTH,
    INTERACTION_RANGE,
    VISIBILITY_RADIUS,
    GLOW_PULSE_SPEED,
    PARTICLE_COUNT,
    MARKER_COLORS,
    DEFAULT_MARKER_COLOR,
    QuestMarker,
    QuestMarkerManager,
  };
}
