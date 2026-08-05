/**
 * Cuubz — `Game.init()` step 11, second half (PR 17)
 *
 * Host-side `ChunkStreamer` and the two client-side handlers it feeds — `CHUNK_DATA`
 * (streamed terrain) and `TIME_SYNC` (time of day). Split from `initPlayerSync.js` for
 * the 400-line ceiling; the seam is real, because this half is about chunks and the
 * other half is about players, and neither reads the other's locals.
 *
 * The edge-strip extraction is what stops false water side-faces at chunk boundaries on
 * a client, and the humidity map is what makes a client's vertex tinting match the
 * host's. Both are unchanged.
 */

import { ChunkCompressor, ChunkStreamer } from '../../multiplayer/ChunkStreamer.js';
import { ChunkResyncRequester } from '../../multiplayer/ChunkResync.js';
import { ChunkManager } from '../../engine/world/ChunkManager.js';
import { computeHumidityMap } from '../../engine/world/BiomeSystem.js';
import { Chunk } from '../../engine/world/ChunkData.js';

/**
 * @param {import('../Game.js').Game} game
 */
export function initChunkStreaming(game) {
  const state = game.state;
  const deps = game.deps;
  const log = deps.log;
  const chunkManager = state.chunkManager;
  const sm = deps.sessionManager;

  // ─── Initialize ChunkStreamer (host-side proactive chunk streaming) ───
  let chunkStreamer = null;
  // D-27: the `typeof ChunkStreamer !== 'undefined' &&` half is gone (module import);
  // `sm && sm.hostingSessionId` is the real guard — only the host streams chunks.
  if (sm && sm.hostingSessionId) {
    chunkStreamer = new ChunkStreamer({
      chunkGrid: chunkManager,
      options: {
        loadRadius: 6,
        unloadRadius: 8,
        streamInterval: 500,  // Tick every 500ms for faster streaming
        maxChunksPerTick: 32, // Stream up to 32 chunks per tick
        compressData: true,
      },
    });

    // Register host player position — use actual playerId so server can route messages
    const hostPlayerId = sm.client.playerId || 'host';
    const p = state.player.position;
    chunkStreamer.updatePlayerPosition(hostPlayerId, { x: p.x, y: p.y, z: p.z });

    // Remote player positions are refreshed from PlayerSyncManager in the render loop.

    // When chunks are streamed, send them via the game session relay
    // Don't include targetPlayers — let server broadcast to all non-host players
    chunkStreamer.onChunkStreamed = (payload) => {
      if (sm.client && sm.client.isGameSessionConnected) {
        const cx = payload.chunkX;
        const cz = payload.chunkZ;

        // Extract 1-deep edge strips from neighbor chunks for correct
        // water face culling at chunk boundaries on the client side.
        // Each edge strip is 16 × 256 = 4096 bytes, RLE-compressed.
        const neighborEdges = {};
        const edgeConfigs = [
          { dir: 'positiveX', dx: 1, dz: 0, edgeX: 0, edgeZ: null, stripIdx: (z, y) => z * 256 + y },
          { dir: 'negativeX', dx: -1, dz: 0, edgeX: 15, edgeZ: null, stripIdx: (z, y) => z * 256 + y },
          { dir: 'positiveZ', dx: 0, dz: 1, edgeX: null, edgeZ: 0, stripIdx: (x, y) => x * 256 + y },
          { dir: 'negativeZ', dx: 0, dz: -1, edgeX: null, edgeZ: 15, stripIdx: (x, y) => x * 256 + y },
        ];

        for (const ec of edgeConfigs) {
          const neighbor = chunkManager.getChunkData(cx + ec.dx, cz + ec.dz);
          if (neighbor && neighbor.blocks) {
            const strip = new Uint8Array(16 * 256);
            if (ec.edgeX !== null) {
              for (let z = 0; z < 16; z++) {
                for (let y = 0; y < 256; y++) {
                  strip[ec.stripIdx(z, y)] = neighbor.blocks[ec.edgeX + z * 16 + y * 256];
                }
              }
            } else {
              for (let x = 0; x < 16; x++) {
                for (let y = 0; y < 256; y++) {
                  strip[ec.stripIdx(x, y)] = neighbor.blocks[x + ec.edgeZ * 16 + y * 256];
                }
              }
            }
            // Convert to regular Array for JSON serialization (WebSocket uses JSON.stringify)
            neighborEdges[ec.dir] = Array.from(ChunkCompressor.compress(strip).data);
          }
        }

        // Get humidityMap from the chunk — needed for vertex color tinting on clients
        const chunkData = chunkManager.getChunkData(cx, cz);
        let humidityMap;
        if (chunkData && chunkData.humidityMap) {
          humidityMap = Array.from(chunkData.humidityMap);
        } else if (typeof computeHumidityMap === 'function') {
          // Fallback: compute humidityMap for the chunk (e.g., if loaded from cache)
          humidityMap = Array.from(computeHumidityMap(chunkManager.worldSeed, cx, cz, chunkManager.genParams));
        } else {
          humidityMap = undefined;
        }

        const msg = {
          type: 'CHUNK_DATA',
          chunkX: cx,
          chunkZ: cz,
          data: payload.data,
          compressed: payload.compressed,
          dirty: payload.dirty,
          neighborEdges: Object.keys(neighborEdges).length > 0 ? neighborEdges : undefined,
          humidityMap: humidityMap,
          // Only send to players who need this chunk (prevents unnecessary re-streaming
          // to players who already have it, which was causing excessive mesh rebuilds)
          targetPlayers: payload.players,
        };
        sm.client._gameSessionConn?.send(msg);
      }
    };

    chunkStreamer.onChunkLoaded = (info) => {
      log(`[ChunkStreamer] Chunk loaded: ${info.key}`);
    };

    // ─── A client asking for chunks it never got (D-116) ───
    //
    // The host records a chunk as delivered when it *queues* the payload, so anything lost
    // between there and the client's `memoryCache` was lost for good. This is the reply
    // path: clear the delivered mark and let the ordinary queue re-send on the next tick.
    sm.client.onGame('CHUNK_REQUEST', (data) => {
      if (!data || !data.playerId || !Array.isArray(data.chunks)) return;
      const accepted = chunkStreamer.requestChunks(data.playerId, data.chunks);
      if (accepted > 0) {
        console.log(`[CHUNK_STREAM] Re-send requested by ${data.playerId.substring(0, 8)}: ${accepted} chunk(s)`);
      }
    });

    chunkStreamer.start();
    log('[Cuubz] ChunkStreamer initialized for host-side proactive chunk streaming');
  }
  state.chunkStreamer = chunkStreamer;

  // ─── Client-side CHUNK_DATA handling (receive streamed chunks from host) ───
  if (sm && sm.currentSessionId && !sm.hostingSessionId) {
    sm.client.onGame('CHUNK_DATA', (data) => {
      try {
        if (!data || data.chunkX === undefined || data.chunkZ === undefined) return;
        if (!data.data) return;
        // Must be a valid Array (JSON-deserialized from WebSocket)
        if (!Array.isArray(data.data)) return;

        const cx = data.chunkX;
        const cz = data.chunkZ;
        const key = ChunkManager.key(cx, cz);

        // Decompress if needed — data arrives as a regular Array (JSON serialized via WebSocket)
        const rawArr = data.data;
        const blockData = data.compressed
          ? ChunkCompressor.decompress({ method: 'rle', data: new Uint8Array(rawArr), originalLength: 16 * 16 * 256 })
          : new Uint8Array(rawArr);

        if (!blockData || blockData.length === 0) return;

        // If chunk is already loaded, apply as dirty update (only if data changed)
        const existing = chunkManager.memoryCache.get(key);
        if (existing) {
          // Compare blocks to avoid unnecessary mesh rebuilds — only update if changed
          let changed = false;
          for (let i = 0; i < Math.min(blockData.length, existing.blocks.length); i++) {
            if (existing.blocks[i] !== blockData[i]) {
              existing.blocks[i] = blockData[i];
              changed = true;
            }
          }
          if (changed) {
            existing.dirty = true;
            existing.changed = true; // Trigger mesh rebuild only if data changed
            log(`[Cuubz] Applied streamed chunk update: ${key} (${blockData.length} blocks)`);
          }
          // Update humidityMap if provided (even if block data didn't change)
          if (data.humidityMap) {
            existing.humidityMap = new Float32Array(data.humidityMap);
          } else if (typeof computeHumidityMap === 'function' && !existing.humidityMap) {
            existing.humidityMap = computeHumidityMap(chunkManager.worldSeed, cx, cz, chunkManager.genParams);
          }
        } else {
          // Chunk not loaded — create it from host data
          const newChunk = new Chunk(cx, cz);
          for (let i = 0; i < Math.min(blockData.length, newChunk.blocks.length); i++) {
            newChunk.blocks[i] = blockData[i];
          }
          newChunk.dirty = false; // Host data is authoritative
          newChunk.changed = true; // Trigger mesh rebuild

          // Store humidity map for vertex color tinting
          if (data.humidityMap) {
            newChunk.humidityMap = new Float32Array(data.humidityMap);
          } else if (typeof computeHumidityMap === 'function') {
            newChunk.humidityMap = computeHumidityMap(chunkManager.worldSeed, cx, cz, chunkManager.genParams);
          }

          // Store virtual neighbor edge strips (if provided by host)
          // These prevent false water side faces at chunk boundaries
          // Edge data arrives as regular Arrays (JSON serialized)
          if (data.neighborEdges) {
            const edgeDirs = ['positiveX', 'negativeX', 'positiveZ', 'negativeZ'];
            for (const dir of edgeDirs) {
              if (data.neighborEdges[dir]) {
                const edgeArr = Array.isArray(data.neighborEdges[dir])
                  ? data.neighborEdges[dir]
                  : Array.from(data.neighborEdges[dir]);
                const decompressed = ChunkCompressor.decompress({
                  method: 'rle',
                  data: new Uint8Array(edgeArr),
                  originalLength: 16 * 256
                });
                newChunk.neighborEdges[dir] = decompressed;
              }
            }
          }

          chunkManager.memoryCache.set(key, newChunk);
          log(`[Cuubz] Received streamed chunk: ${key} (${blockData.length} blocks)`);
        }
      } catch (err) {
        console.error('[Cuubz] Error processing CHUNK_DATA:', err.message);
      }
    });
    log('[Cuubz] CHUNK_DATA handler registered for receiving streamed chunks');

    // ─── Ask the host for the chunks we can see and do not have (D-116) ───
    //
    // Without this the client's world is whatever survived the host's one-shot send. See
    // `ChunkResync.js` for the four ways a chunk goes missing and never comes back.
    const resync = state.chunkResync = new ChunkResyncRequester();
    state.chunkResyncTimerId = setInterval(() => {
      try {
        if (!sm.client || !sm.client.isGameSessionConnected) return;
        if (!state.player || !chunkManager) return;

        const keys = resync.collect(
          state.player.position,
          chunkManager.renderDistance,
          chunkManager.memoryCache
        );
        if (keys.length === 0) return;

        sm.client._gameSessionConn?.send({ type: 'CHUNK_REQUEST', chunks: keys });
        log(`[Cuubz] Requested ${keys.length} missing chunk(s) from host`);
      } catch (err) {
        console.error('[Cuubz] Chunk resync error:', err.message);
      }
    }, resync.options.interval);
    log('[Cuubz] Chunk resync requester started');
  }

  // ─── Client-side TIME_SYNC handling (receive time-of-day from host) ───
  if (sm && sm.currentSessionId && !sm.hostingSessionId) {
    sm.client.onGame('TIME_SYNC', (data) => {
      try {
        if (!data || data.timeOfDay === undefined) return;
        if (state.skybox) {
          state.skybox.timeOfDay = ((data.timeOfDay % 24) + 24) % 24;
          state.skybox.timePaused = !!data.timePaused;
        }
      } catch (err) {
        console.error('[Cuubz] Error processing TIME_SYNC:', err.message);
      }
    });
    log('[Cuubz] TIME_SYNC handler registered for time-of-day sync from host');
  }
}
