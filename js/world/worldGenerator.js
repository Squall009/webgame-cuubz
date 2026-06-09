/**
 * Cuubz — World Generator (VoxelGen Overhaul)
 * Thin wrapper that dispatches chunk generation to Web Workers.
 * All heavy lifting happens in workerGeneration.js.
 */

class WorldGenerator {
  /**
   * @param {string|number} seed - World seed (string or number).
   * @param {Object} options - Generation parameters + callbacks.
   */
  constructor(seed, options = {}) {
    this.seed = typeof seed === 'string' ? seed : String(seed);
    this.workerPool = null;

    // Default generation parameters — matches voxelgen.html sliders.
    this.params = Object.assign({
      continentScale: 4000,
      contScale:      400,
      tempScale:      2000,
      humScale:       2000,
      erosScale:      280,
      detailScale:    40,
      octaves:        5,
      persistence:    0.5,
      lacunarity:     2.0,
      caveThresh:     0.10,
      caveScale:      50,
      riverScale:     1000,
      riverDensity:   30,
      riverDepth:     20
    }, options.params || {});

    // Callbacks for progress reporting.
    this.onChunkGenerated = options.onChunkGenerated || null; // (chunkX, chunkZ) => void
    this.onError = options.onError || console.error;

    // Generation state tracking.
    this._generating = false;
  }

  /**
   * Initialize the worker pool. Must be called before generateChunk().
   * @param {string} workerScriptPath - Path to workerGeneration.js (for fetch-based Blob URL).
   */
  async init(workerScriptPath = 'js/world/workerGeneration.js') {
    if (!this.workerPool) {
      try {
        console.log('[WorldGenerator] Initializing worker pool from:', workerScriptPath);
        this.workerPool = await createWorkerPool(workerScriptPath);
        console.log('[WorldGenerator] Worker pool initialized successfully with',
                    this.workerPool.workers.length, 'workers');
      } catch (e) {
        // Fallback: if fetch fails, we'll handle it in generateChunk via inline generation.
        console.warn('[WorldGenerator] Worker pool init failed — will use single-threaded inline fallback:', e.message);
      }
    }
  }

  /**
   * Generate a single chunk asynchronously via worker dispatch.
   * @param {number} cx - Chunk X coordinate.
   * @param {number} cz - Chunk Z coordinate.
   * @returns {Promise<Chunk>} Resolved Chunk object with blocks populated.
   */
  async generateChunk(cx, cz) {
    if (!this.workerPool) {
      console.warn('[WorldGenerator] Worker pool not initialized — falling back to inline generation.');
      // Inline fallback for when workers aren't available (e.g., CSP issues).
      return this._generateInline(cx, cz);
    }

    const genParams = Object.assign({}, this.params, {
      baseChunkX: cx,
      baseChunkZ: cz
    });

    try {
      const result = await this.workerPool.dispatch(cx, cz, this.seed, genParams);

      // Reconstruct Chunk from worker result.
      const chunk = new Chunk(cx, cz);
      chunk.blocks = new Uint8Array(result.chunkBytes);

      // Store biome data and surface map for feature placement later.
      chunk.biomeMap = result.biomeNames.map(entry => {
        const key = entry.name.toUpperCase().replace(/\s+/g, '_');
        let b = BIOME_DEFS[key] || BIOME_DEFS.PLAINS;
        if (entry.frozenWater) b = Object.assign({}, b, { frozenWater: true });
        return b;
      });

      chunk.surfaceMap = new Int32Array(result.surfaceMap);

      // Report progress.
      if (this.onChunkGenerated) this.onChunkGenerated(cx, cz);

      return chunk;
    } catch (e) {
      this.onError(`[WorldGenerator] Worker error for chunk [${cx},${cz}]:`, e);
      throw e;
    }
  }

  /**
   * Generate multiple chunks in parallel.
   * @param {Array<{cx, cz}>} chunks - List of chunk coordinates to generate.
   * @returns {Promise<Map<string, Chunk>>} Map keyed by "cx,cz" → Chunk.
   */
  async generateChunks(chunks) {
    const results = new Map();
    const promises = [];

    for (const { cx, cz } of chunks) {
      const key = `${cx},${cz}`;
      const p = this.generateChunk(cx, cz).then(chunk => {
        results.set(key, chunk);
      }).catch(e => {
        this.onError(`[WorldGenerator] Failed to generate ${key}:`, e);
      });
      promises.push(p);
    }

    await Promise.all(promises);
    return results;
  }

  /**
   * Get biome at a world position (main-thread lookup using shared perlin).
   */
  getBiomeAtWorldPos(wx, wz) {
    const p = createSharedPerlin(this.seed);
    const blended = sampleBiomeParams(p, wx, wz, this.params.continentScale, this.params.contScale,
                                      this.params.tempScale, this.params.humScale, this.params.erosScale);
    return blended.biome;
  }

  /**
   * Inline fallback — runs generation on main thread when workers fail.
   * Uses _voxelgenGenerateChunk exposed by workerGeneration.js script tag.
   */
  _generateInline(cx, cz) {
    // Check if the inline generation function is available (script loaded via <script> tag).
    const genFn = typeof window !== 'undefined' ? window._voxelgenGenerateChunk : null;

    if (!genFn) {
      throw new Error('[WorldGenerator] Workers unavailable and no inline fallback implemented.');
    }

    console.warn('[WorldGenerator] Using single-threaded inline generation for chunk', cx, cz);

    const genParams = Object.assign({}, this.params, {
      baseChunkX: cx,
      baseChunkZ: cz
    });

    try {
      const result = genFn(cx, cz, this.seed, genParams);

      // Reconstruct Chunk from result.
      const chunk = new Chunk(cx, cz);
      chunk.blocks = new Uint8Array(result.chunkBytes);

      // Store biome data and surface map for feature placement later.
      chunk.biomeMap = Array.isArray(result.biomeNames) ? result.biomeNames.map(entry => {
        const key = entry.name.toUpperCase().replace(/\s+/g, '_');
        let b = BIOME_DEFS[key] || BIOME_DEFS.PLAINS;
        if (entry.frozenWater) b = Object.assign({}, b, { frozenWater: true });
        return b;
      }) : [];

      chunk.surfaceMap = new Int32Array(result.surfaceMap);

      // Report progress.
      if (this.onChunkGenerated) this.onChunkGenerated(cx, cz);

      return chunk;
    } catch (e) {
      this.onError(`[WorldGenerator] Inline generation error for chunk [${cx},${cz}]:`, e);
      throw e;
    }
  }

  /**
   * Clean up workers. Call on game unload / world switch.
   */
  dispose() {
    if (this.workerPool) {
      this.workerPool.terminate();
      if (this.workerPool._blobUrl) URL.revokeObjectURL(this.workerPool._blobUrl);
      this.workerPool = null;
    }
  }
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = WorldGenerator;
}
