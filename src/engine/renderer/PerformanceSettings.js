/**
 * Cuubz — Performance Settings
 *
 * Manages graphics/performance options:
 *   - Render distance
 *   - Shadow quality
 *   - Texture resolution
 *   - Advanced shading toggle
 *
 * Persists to localStorage under key 'cuubz:settings'.
 * Applies changes in real-time to the live engine.
 */

// Native texture resolution (source textures are this size).
// High = native, Medium = half, Low = quarter.
// Change this if source textures change resolution.
export const NATIVE_TILE_SIZE = 128;

export class PerformanceSettings {
  constructor() {
    this._defaults = {
      renderDistance: 6,
      shadowQuality: 'medium',
      textureResolution: 'high',
      advancedShading: true,
    };
    this.settings = { ...this._defaults };
  }

  // ── Persistence ──────────────────────────────────────────────

  load() {
    try {
      const raw = localStorage.getItem('cuubz:settings');
      if (raw) {
        const parsed = JSON.parse(raw);
        // Merge with defaults — unknown keys are ignored, missing keys get defaults
        for (const key of Object.keys(this._defaults)) {
          if (parsed[key] !== undefined) {
            this.settings[key] = parsed[key];
          }
        }
      }
    } catch (e) {
      console.warn('[PerformanceSettings] Failed to load settings:', e.message);
    }
    return this.settings;
  }

  save() {
    try {
      localStorage.setItem('cuubz:settings', JSON.stringify(this.settings));
    } catch (e) {
      console.warn('[PerformanceSettings] Failed to save settings:', e.message);
    }
  }

  // ── Accessors ────────────────────────────────────────────────

  /** Return a shallow copy of all settings (no args) or a single setting by key */
  get(key) {
    if (key === undefined) {
      return { ...this.settings };
    }
    return this.settings[key];
  }

  /** Return a shallow copy of all settings (explicit) */
  getAll() {
    return { ...this.settings };
  }

  /** Set a single setting, auto-save, return full settings object */
  set(key, value) {
    if (this._defaults[key] === undefined) {
      console.warn(`[PerformanceSettings] Unknown setting: ${key}`);
      return this.settings;
    }
    this.settings[key] = value;
    this.save();
    return this.settings;
  }

  // ── Apply to live engine ─────────────────────────────────────

  /**
   * Push current settings into the running engine.
   * @param {VoxelRenderer} renderer
   * @param {ChunkManager} chunkManager
   */
  apply(renderer, chunkManager) {
    const s = this.settings;

    // 1. Render distance (cheap)
    if (chunkManager) {
      chunkManager.setRenderDistance(s.renderDistance);
    }

    // 2. Shadow quality (cheap — just recreate render target)
    if (renderer) {
      renderer.setShadowQuality(s.shadowQuality);
    }

    // 3 & 4. Texture resolution + advanced shading (expensive — rebuild atlas + materials)
    // These are handled by the caller if they detect a change.
    // We expose them via get() so the caller can check.
  }

  /**
   * Get the tile size for a texture resolution setting.
   * High = native, Medium = half, Low = quarter.
   * @param {string} resolution - 'low', 'medium', or 'high'
   * @returns {number} tile size in pixels
   */
  static getTileSize(resolution) {
    switch (resolution) {
      case 'low':    return Math.floor(NATIVE_TILE_SIZE / 4);
      case 'medium': return Math.floor(NATIVE_TILE_SIZE / 2);
      case 'high':
      default:       return NATIVE_TILE_SIZE;
    }
  }
}
