/**
 * Cuubz — Spawn Manager
 * Per-player spawn points stored per world. Default: world center if no bed set.
 */

class SpawnManager {
  constructor() {
    // Map: "worldId" → { "playerId" → { x, y, z } }
    this.spawnPoints = new Map();
    
    // Default spawn position (world center)
    this.defaultSpawn = { x: 0, y: 20, z: 0 };
  }

  /**
   * Set a player's spawn point in a world
   */
  setSpawn(worldId, playerId, position) {
    if (!this.spawnPoints.has(worldId)) {
      this.spawnPoints.set(worldId, new Map());
    }
    
    const worldSpawns = this.spawnPoints.get(worldId);
    worldSpawns.set(playerId, { ...position });
  }

  /**
   * Get a player's spawn point in a world (or default)
   */
  getSpawn(worldId, playerId) {
    const worldSpawns = this.spawnPoints.get(worldId);
    
    if (worldSpawns && worldSpawns.has(playerId)) {
      return worldSpawns.get(playerId);
    }
    
    return this.defaultSpawn;
  }

  /**
   * Set default spawn for a world (e.g., on world creation)
   */
  setDefaultSpawn(worldId, position) {
    this.defaultSpawn = { ...position };
  }

  /**
   * Clear all spawns for a world (on world deletion)
   */
  clearWorld(worldId) {
    this.spawnPoints.delete(worldId);
  }

  /**
   * Get all spawn points for a world
   */
  getWorldSpawns(worldId) {
    const worldSpawns = this.spawnPoints.get(worldId);
    if (!worldSpawns) return {};
    
    const spawns = {};
    for (const [playerId, pos] of worldSpawns) {
      spawns[playerId] = pos;
    }
    return spawns;
  }

  /**
   * Serialize all spawn data
   */
  serialize() {
    const data = {};
    
    for (const [worldId, worldSpawns] of this.spawnPoints) {
      data[worldId] = {};
      for (const [playerId, pos] of worldSpawns) {
        data[worldId][playerId] = pos;
      }
    }
    
    data._default = this.defaultSpawn;
    return data;
  }

  /**
   * Deserialize spawn data
   */
  deserialize(data) {
    if (data._default) {
      this.defaultSpawn = data._default;
    }
    
    for (const [worldId, players] of Object.entries(data)) {
      if (worldId === '_default') continue;
      
      const worldSpawns = new Map();
      for (const [playerId, pos] of Object.entries(players)) {
        worldSpawns.set(playerId, pos);
      }
      this.spawnPoints.set(worldId, worldSpawns);
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = SpawnManager;

}