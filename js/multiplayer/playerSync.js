/**
 * Cuubz — Player Synchronization Module
 *
 * Renders remote players as colored voxel characters with smooth interpolation,
 * name tags above heads, and health bars in survival mode.
 *
 * Architecture:
 *   Host broadcasts player state → relay server → all clients receive updates
 *   Each client maintains RemotePlayer instances for every other player in the session.
 *   Positions are interpolated between received updates for smooth movement.
 *
 * Testable in Node.js (no browser dependencies). Three.js mesh creation is
 * gated behind `typeof THREE !== 'undefined'` checks.
 */

'use strict';

// ─── Constants ──────────────────────────────────────────────────────

const INTERPOLATION_CONFIG = {
  positionLerp: 0.15,       // Lerp factor per frame (higher = snappier, lower = smoother)
  rotationLerp: 0.12,       // Slightly slower for camera rotation to avoid jitter
  tickInterval: 16,         // ms per interpolation tick (~60fps target)
  staleThreshold: 5000,     // ms before a player is considered stale/disconnected
  pingBufferSize: 10,       // Keep last N ping samples for latency estimation
};

const REMOTE_PLAYER_STATES = {
  INACTIVE: 'inactive',     // Not connected / not loaded
  LOADING: 'loading',       // Mesh being created
  ACTIVE: 'active',         // Fully rendered and updating
  STALE: 'stale',           // No updates received recently
};

const DEFAULT_REMOTE_PLAYER = {
  width: 0.8,               // Same as local player
  height: 1.8,
  headHeight: 0.5,          // Head block height for rendering
  bodyColor: '#888888',     // Default fallback color
  nameTagOffset: 0.6,       // Blocks above head for name tag
  healthBarWidth: 1.2,      // Block units for health bar width
  healthBarHeight: 0.1,     // Block units for health bar height
};

// ─── Ping Tracker ──────────────────────────────────────────────────

/**
 * Tracks ping/latency samples for a remote player connection.
 * Pure utility — no browser dependencies.
 */
class PingTracker {
  constructor(maxSamples) {
    this._samples = [];
    this._maxSamples = maxSamples || INTERPOLATION_CONFIG.pingBufferSize;
  }

  /**
   * Record a new ping sample in ms.
   */
  recordSample(pingMs) {
    if (pingMs < 0) return;
    this._samples.push(pingMs);
    if (this._samples.length > this._maxSamples) {
      this._samples.shift();
    }
  }

  /**
   * Get average ping in ms, or null if no samples.
   */
  getAverage() {
    if (this._samples.length === 0) return null;
    const sum = this._samples.reduce((a, b) => a + b, 0);
    return sum / this._samples.length;
  }

  /**
   * Get minimum ping in ms, or null if no samples.
   */
  getMinimum() {
    if (this._samples.length === 0) return null;
    return Math.min(...this._samples);
  }

  /**
   * Get maximum ping in ms, or null if no samples.
   */
  getMaximun() {
    if (this._samples.length === 0) return null;
    return Math.max(...this._samples);
  }

  /**
   * Get the number of recorded samples.
   */
  get count() {
    return this._samples.length;
  }

  /**
   * Reset all samples.
   */
  reset() {
    this._samples = [];
  }

  /**
   * Serialize for persistence/debugging.
   */
  toJSON() {
    return {
      samples: [...this._samples],
      average: this.getAverage(),
      minimum: this.getMinimum(),
    };
  }
}

// ─── Remote Player State ──────────────────────────────────────────

/**
 * Represents a remote player's state with interpolation support.
 * All positions in world coordinates (block units).
 */
class RemotePlayerState {
  constructor(playerId, name, color) {
    this.playerId = playerId;
    this.name = name || 'Player';
    this.color = color || DEFAULT_REMOTE_PLAYER.bodyColor;

    // Current (interpolated) position for rendering
    this.position = { x: 0, y: 20, z: 0 };
    this.yaw = 0;
    this.pitch = 0;

    // Last received authoritative state from server
    this.authoritativePosition = { x: 0, y: 20, z: 0 };
    this.authoritativeYaw = 0;
    this.authoritativePitch = 0;

    // Survival mode data
    this.health = 100;
    this.maxHealth = 100;
    this.selectedBlock = 0;

    // Timestamps
    this.lastUpdate = Date.now();
    this.spawnTime = Date.now();

    // State
    this.state = REMOTE_PLAYER_STATES.LOADING;
    this.connected = true;

    // Ping tracking
    this.pingTracker = new PingTracker();

    // Mesh references (set by PlayerSync when Three.js available)
    this.mesh = null;
    this.nameTag = null;
    this.healthBar = null;
  }

  /**
   * Update authoritative state from server broadcast.
   * Triggers interpolation to smoothly transition to new position.
   */
  updateFromServer(data) {
    const now = Date.now();

    if (data.position) {
      this.authoritativePosition.x = data.position.x;
      this.authoritativePosition.y = data.position.y;
      this.authoritativePosition.z = data.position.z;
    }
    if (data.yaw !== undefined) {
      this.authoritativeYaw = data.yaw;
    }
    if (data.pitch !== undefined) {
      this.authoritativePitch = data.pitch;
    }
    if (data.health !== undefined) {
      this.health = Math.max(0, Math.min(this.maxHealth, data.health));
    }
    if (data.selectedBlock !== undefined) {
      this.selectedBlock = data.selectedBlock;
    }
    if (data.name) {
      this.name = data.name;
    }
    if (data.color) {
      this.color = data.color;
    }

    // Track ping if latency provided
    if (data.latency !== undefined) {
      this.pingTracker.recordSample(data.latency);
    }

    this.lastUpdate = now;
    this.connected = true;
    // Transition from LOADING → ACTIVE on first server data
    if (this.state === REMOTE_PLAYER_STATES.LOADING || this.state === REMOTE_PLAYER_STATES.STALE) {
      this.state = REMOTE_PLAYER_STATES.ACTIVE;
    }
  }

  /**
   * Interpolate current render position toward authoritative target.
   * Call every frame for smooth movement.
   */
  interpolate(lerpFactor) {
    const lf = lerpFactor !== undefined ? lerpFactor : INTERPOLATION_CONFIG.positionLerp;

    // Lerp position
    this.position.x += (this.authoritativePosition.x - this.position.x) * lf;
    this.position.y += (this.authoritativePosition.y - this.position.y) * lf;
    this.position.z += (this.authoritativePosition.z - this.position.z) * lf;

    // Lerp rotation with separate factor
    const rl = INTERPOLATION_CONFIG.rotationLerp;
    this.yaw += (this.authoritativeYaw - this.yaw) * rl;
    this.pitch += (this.authoritativePitch - this.pitch) * rl;

    // Check staleness
    const elapsed = Date.now() - this.lastUpdate;
    if (elapsed > INTERPOLATION_CONFIG.staleThreshold && this.state === REMOTE_PLAYER_STATES.ACTIVE) {
      this.state = REMOTE_PLAYER_STATES.STALE;
    }
  }

  /**
   * Get the health percentage (0.0 to 1.0).
   */
  getHealthPercent() {
    return this.health / this.maxHealth;
  }

  /**
   * Get head position for name tag rendering.
   */
  getHeadPosition() {
    const offset = DEFAULT_REMOTE_PLAYER.nameTagOffset;
    return {
      x: this.position.x,
      y: this.position.y + DEFAULT_REMOTE_PLAYER.height + offset,
      z: this.position.z,
    };
  }

  /**
   * Check if player is too stale to render.
   */
  isStale() {
    return this.state === REMOTE_PLAYER_STATES.STALE;
  }

  /**
   * Mark player as disconnected.
   */
  disconnect() {
    this.connected = false;
    this.state = REMOTE_PLAYER_STATES.INACTIVE;
  }

  /**
   * Serialize for persistence/debugging.
   */
  toJSON() {
    return {
      playerId: this.playerId,
      name: this.name,
      color: this.color,
      renderPosition: { ...this.position },
      authoritativePosition: { ...this.authoritativePosition },
      yaw: this.yaw,
      pitch: this.pitch,
      health: this.health,
      maxHealth: this.maxHealth,
      state: this.state,
      connected: this.connected,
      lastUpdate: this.lastUpdate,
      ping: this.pingTracker.toJSON(),
    };
  }

  /**
   * Deserialize from saved data.
   */
  static fromJSON(data) {
    const player = new RemotePlayerState(data.playerId, data.name || 'Player', data.color || '#888888');
    // Support both old format (position) and new format (renderPosition/authoritativePosition)
    if (data.authoritativePosition) {
      player.authoritativePosition = { ...data.authoritativePosition };
    } else if (data.position) {
      player.authoritativePosition = { ...data.position };
    }
    if (data.renderPosition) {
      player.position = { ...data.renderPosition };
    } else if (data.position) {
      player.position = { ...data.position };
    }
    player.yaw = data.yaw || 0;
    player.pitch = data.pitch || 0;
    player.health = data.health || 100;
    player.maxHealth = data.maxHealth || 100;
    player.state = data.state || REMOTE_PLAYER_STATES.ACTIVE;
    player.connected = data.connected !== false;
    player.lastUpdate = data.lastUpdate || Date.now();
    player.spawnTime = data.spawnTime || Date.now();
    return player;
  }
}

// ─── Voxel Character Mesh Builder (Node.js Testable) ──────────────

/**
 * Build a voxel character representation as an array of block placements.
 * Returns a structured description that can be used by Three.js to create
 * the actual mesh, or tested directly in Node.js.
 *
 * Each entry: { x, y, z, color } relative to player base position.
 */
function buildVoxelCharacter(color) {
  const c = color || '#888888';
  // Parse hex to slightly darker/lighter variants for detail
  const darker = shadeColor(c, -20);
  const lighter = shadeColor(c, 20);

  // Player character: 3 blocks tall (feet, body, head)
  // Width: ~1 block centered at x=0
  const blocks = [];

  // Feet layer (y=0) — two legs
  blocks.push({ x: -0.2, y: 0, z: 0, color: darker });
  blocks.push({ x: 0.2, y: 0, z: 0, color: darker });

  // Body layer (y=0.5 to y=1.2) — torso + arms
  blocks.push({ x: 0, y: 0.7, z: 0, color: c });        // Torso
  blocks.push({ x: -0.5, y: 0.7, z: 0, color: lighter }); // Left arm
  blocks.push({ x: 0.5, y: 0.7, z: 0, color: lighter });  // Right arm

  // Head layer (y=1.6) — head block
  blocks.push({ x: 0, y: 1.6, z: 0, color: lighter });

  return blocks;
}

/**
 * Shade a hex color by a percentage amount (-100 to +100).
 */
function shadeColor(hex, percent) {
  const num = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.max(0, (num >> 16) + percent));
  const g = Math.min(255, Math.max(0, ((num >> 8) & 0x00FF) + percent));
  const b = Math.min(255, Math.max(0, (num & 0x0000FF) + percent));
  return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// ─── Player Sync Manager ──────────────────────────────────────────

/**
 * Manages all remote players in the current session.
 * Handles adding/removing players, processing state updates from the server,
 * and providing interpolated positions for rendering.
 */
class PlayerSyncManager {
  constructor(config) {
    this._players = new Map(); // playerId → RemotePlayerState
    this._config = { ...INTERPOLATION_CONFIG, ...(config || {}) };
    this._gameMode = 'survival'; // 'creative' or 'survival'
    this._threeLoaded = typeof THREE !== 'undefined';

    // Callbacks
    this.onPlayerAdded = null;
    this.onPlayerRemoved = null;
    this.onPlayerUpdated = null;
    this.onError = null;
  }

  /**
   * Add a new remote player to the session.
   */
  addPlayer(playerId, data) {
    if (this._players.has(playerId)) {
      // Update existing player instead
      const existing = this._players.get(playerId);
      existing.updateFromServer(data || {});
      if (this.onPlayerUpdated) {
        this.onPlayerUpdated(playerId, existing);
      }
      return existing;
    }

    const name = data ? (data.name || `Player ${playerId}`) : `Player ${playerId}`;
    const color = data ? (data.color || '#888888') : '#888888';
    const state = new RemotePlayerState(playerId, name, color);

    if (data) {
      state.updateFromServer(data);
    }

    state.state = REMOTE_PLAYER_STATES.ACTIVE;
    this._players.set(playerId, state);

    // Create mesh if Three.js available
    if (this._threeLoaded && data) {
      this._createMesh(state);
    }

    if (this.onPlayerAdded) {
      this.onPlayerAdded(playerId, state);
    }

    return state;
  }

  /**
   * Remove a remote player from the session.
   */
  removePlayer(playerId) {
    const player = this._players.get(playerId);
    if (!player) return null;

    player.disconnect();
    this._disposeMesh(player);
    this._players.delete(playerId);

    if (this.onPlayerRemoved) {
      this.onPlayerRemoved(playerId, player);
    }

    return player;
  }

  /**
   * Process a state update from the relay server.
   */
  processServerUpdate(playerId, data) {
    const player = this._players.get(playerId);
    if (!player) {
      // Unknown player — auto-add
      return this.addPlayer(playerId, data);
    }

    player.updateFromServer(data);

    if (this.onPlayerUpdated) {
      this.onPlayerUpdated(playerId, player);
    }

    return player;
  }

  /**
   * Update all players' interpolated positions.
   * Call every frame.
   */
  update(deltaTime) {
    const dt = deltaTime || INTERPOLATION_CONFIG.tickInterval / 1000;

    for (const [id, player] of this._players) {
      if (!player.connected || player.state === REMOTE_PLAYER_STATES.INACTIVE) continue;

      // Interpolate toward authoritative position
      player.interpolate(this._config.positionLerp);

      // Update visual elements if Three.js available
      if (this._threeLoaded && player.mesh) {
        this._updateMeshPosition(player);
        this._updateNameTag(player);
        this._updateHealthBar(player);
      }
    }
  }

  /**
   * Get a remote player by ID.
   */
  getPlayer(playerId) {
    return this._players.get(playerId) || null;
  }

  /**
   * Get all active players as an array.
   */
  getActivePlayers() {
    const result = [];
    for (const [id, player] of this._players) {
      if (player.connected && player.state === REMOTE_PLAYER_STATES.ACTIVE) {
        result.push(player);
      }
    }
    return result;
  }

  /**
   * Get the count of connected players.
   */
  get playerCount() {
    let count = 0;
    for (const [, player] of this._players) {
      if (player.connected) count++;
    }
    return count;
  }

  /**
   * Set the game mode (affects health bar visibility).
   */
  setGameMode(mode) {
    this._gameMode = mode === 'creative' ? 'creative' : 'survival';
  }

  /**
   * Check if health bars should be shown.
   */
  showHealthBars() {
    return this._gameMode === 'survival';
  }

  /**
   * Remove all players (session end).
   */
  clearAll() {
    const removed = [];
    for (const [id, player] of this._players) {
      this._disposeMesh(player);
      removed.push(id);
    }
    this._players.clear();
    return removed;
  }

  /**
   * Get a summary of all players for debugging.
   */
  getStateSummary() {
    const summary = {
      totalPlayers: this._players.size,
      connectedCount: this.playerCount,
      gameMode: this._gameMode,
      threeLoaded: this._threeLoaded,
      players: {},
    };

    for (const [id, player] of this._players) {
      summary.players[id] = {
        name: player.name,
        state: player.state,
        connected: player.connected,
        position: { ...player.authoritativePosition },
        health: `${player.health}/${player.maxHealth}`,
        pingAvg: player.pingTracker.getAverage() !== null
          ? `${Math.round(player.pingTracker.getAverage())}ms`
          : 'N/A',
      };
    }

    return summary;
  }

  /**
   * Serialize all player states.
   */
  serialize() {
    const data = {};
    for (const [id, player] of this._players) {
      data[id] = player.toJSON();
    }
    return data;
  }

  // ─── Three.js Mesh Methods (browser-gated) ──────────────────────

  /**
   * Create the Three.js mesh for a remote player.
   */
  _createMesh(player) {
    if (typeof THREE === 'undefined') return;

    const blocks = buildVoxelCharacter(player.color);
    const group = new THREE.Group();

    // Create each block of the character
    for (const block of blocks) {
      const geometry = new THREE.BoxGeometry(0.4, 0.4, 0.4);
      const material = new THREE.MeshLambertMaterial({ color: block.color });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.set(block.x, block.y, block.z);
      group.add(mesh);
    }

    // Set initial position
    group.position.set(
      player.position.x,
      player.position.y,
      player.position.z
    );

    player.mesh = group;

    // Create name tag (CSS2D or sprite-based)
    this._createNameTag(player);

    // Create health bar for survival mode
    if (this.showHealthBars()) {
      this._createHealthBar(player);
    }
  }

  /**
   * Create a name tag above the player's head.
   */
  _createNameTag(player) {
    if (typeof THREE === 'undefined') return;

    // Use canvas texture for text rendering
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    this._renderNameTag(ctx, player.name, player.color, canvas.width, canvas.height);

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.LinearFilter;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(1.5, 0.375, 1);

    player.nameTag = sprite;
    player._nameCanvas = canvas;
    player._nameCtx = ctx;
  }

  /**
   * Render text onto the name tag canvas.
   */
  _renderNameTag(ctx, name, color, width, height) {
    ctx.clearRect(0, 0, width, height);

    // Background
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
    const padding = 8;
    const radius = 6;
    ctx.beginPath();
    ctx.roundRect(padding, padding, width - padding * 2, height - padding * 2, radius);
    ctx.fill();

    // Text
    ctx.fillStyle = color;
    ctx.font = 'bold 28px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, width / 2, height / 2);
  }

  /**
   * Create a health bar above the player.
   */
  _createHealthBar(player) {
    if (typeof THREE === 'undefined') return;

    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 16;
    const ctx = canvas.getContext('2d');

    const material = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(DEFAULT_REMOTE_PLAYER.healthBarWidth, DEFAULT_REMOTE_PLAYER.healthBarHeight, 1);

    player.healthBar = sprite;
    player._healthCanvas = canvas;
    player._healthCtx = ctx;
  }

  /**
   * Update mesh position based on interpolated position.
   */
  _updateMeshPosition(player) {
    if (!player.mesh) return;

    player.mesh.position.set(
      player.position.x,
      player.position.y,
      player.position.z
    );

    // Rotate to face yaw direction
    player.mesh.rotation.y = player.yaw;

    // Update name tag position (above head)
    if (player.nameTag) {
      const headPos = player.getHeadPosition();
      player.nameTag.position.set(headPos.x, headPos.y, headPos.z);
    }

    // Update health bar position
    if (player.healthBar && this.showHealthBars()) {
      const hbY = player.position.y + DEFAULT_REMOTE_PLAYER.height + 0.3;
      player.healthBar.position.set(player.position.x, hbY, player.position.z);
    }
  }

  /**
   * Update the name tag (e.g., if name changed).
   */
  _updateNameTag(player) {
    if (!player.nameTag || !player._nameCtx) return;

    const canvas = player._nameCanvas;
    const ctx = player._nameCtx;
    this._renderNameTag(ctx, player.name, player.color, canvas.width, canvas.height);

    // Update texture
    if (player.nameTag.material.map) {
      player.nameTag.material.map.needsUpdate = true;
    }
  }

  /**
   * Update the health bar visual.
   */
  _updateHealthBar(player) {
    if (!player.healthBar || !player._healthCtx) return;

    const canvas = player._healthCanvas;
    const ctx = player._healthCtx;
    const percent = player.getHealthPercent();

    // Clear
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Background (dark red)
    ctx.fillStyle = 'rgba(80, 0, 0, 0.7)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Health fill
    const healthColor = percent > 0.5 ? '#44ff44' : percent > 0.25 ? '#ffaa00' : '#ff4444';
    ctx.fillStyle = healthColor;
    ctx.fillRect(1, 1, (canvas.width - 2) * percent, canvas.height - 2);
    ctx.fillStyle = 'rgba(80, 0, 0, 0.7)';
    ctx.fillRect((canvas.width - 2) * percent + 1, 1, (canvas.width - 2) * (1 - percent), canvas.height - 2);

    // Update texture
    if (player.healthBar.material.map) {
      player.healthBar.material.map.needsUpdate = true;
    }
  }

  /**
   * Dispose of a player's mesh resources.
   */
  _disposeMesh(player) {
    if (!player.mesh) return;

    // Remove from parent scene (if attached)
    if (player.mesh.parent) {
      player.mesh.parent.remove(player.mesh);
    }

    // Dispose geometries and materials
    player.mesh.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(m => m.dispose());
        } else {
          child.material.dispose();
        }
      }
    });

    // Dispose name tag
    if (player.nameTag && player.nameTag.material) {
      if (player.nameTag.material.map) player.nameTag.material.map.dispose();
      player.nameTag.material.dispose();
    }

    // Dispose health bar
    if (player.healthBar && player.healthBar.material) {
      if (player.healthBar.material.map) player.healthBar.material.map.dispose();
      player.healthBar.material.dispose();
    }

    player.mesh = null;
    player.nameTag = null;
    player.healthBar = null;
  }
}

// ─── Utility Functions ─────────────────────────────────────────────

/**
 * Calculate distance between two positions.
 */
function distanceBetween(pos1, pos2) {
  const dx = pos2.x - pos1.x;
  const dy = pos2.y - pos1.y;
  const dz = pos2.z - pos1.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Normalize an angle to (-PI, PI] range.
 */
function normalizeAngle(angle) {
  while (angle > Math.PI) angle -= 2 * Math.PI;
  while (angle < -Math.PI) angle += 2 * Math.PI;
  // Handle exact PI edge case: map +PI → +PI consistently
  if (angle === -Math.PI) angle = Math.PI;
  return angle;
}

/**
 * Check if a position is within render distance of another.
 */
function isInRenderDistance(pos1, pos2, maxDistance) {
  const dx = pos2.x - pos1.x;
  const dz = pos2.z - pos1.z;
  return (dx * dx + dz * dz) <= (maxDistance * maxDistance);
}

// ─── Exports ───────────────────────────────────────────────────────

module.exports = {
  // Constants
  INTERPOLATION_CONFIG,
  REMOTE_PLAYER_STATES,
  DEFAULT_REMOTE_PLAYER,

  // Classes
  PingTracker,
  RemotePlayerState,
  PlayerSyncManager,

  // Utilities
  buildVoxelCharacter,
  shadeColor,
  distanceBetween,
  normalizeAngle,
  isInRenderDistance,
};
