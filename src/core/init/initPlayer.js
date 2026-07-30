/**
 * Cuubz — `Game.init()` step 8 (PR 17)
 *
 * The spawn search, the `Player`, the saved-spawn restore, the multiplayer `joinGame`,
 * the biome effects and the pointer-lock mouse-look handler.
 *
 * **This step cannot move above step 7.** The spawn search reads
 * `chunkManager.memoryCache`, which step 7's `checkRegion(0, 0)` is what fills —
 * `refactor.md` §8.4 and `BUGS.md` D-36.
 *
 * **`joinGame()` is called here, and four of its handlers are registered two steps
 * later.** That is a race the current code gets away with because the socket has not
 * delivered by then. It was preserved deliberately by PR 17 rather than "fixed": moving
 * the call below the registrations changes behaviour in the one path with no automated
 * coverage at all (`BUGS.md` **D-48**). See `refactor.md` §8.4's outcome.
 */

import { Player } from '../../game/entities/Player.js';
import { BiomeEffects } from '../../engine/renderer/BiomeEffects.js';
import { ChunkManager } from '../../engine/world/ChunkManager.js';
import { BLOCK_BY_ID, BLOCK_TYPES } from '../../engine/world/BlockRegistry.js';
import { MAX_Y, MIN_Y, SEA_LEVEL } from '../../engine/world/ChunkData.js';

/**
 * Search the loaded chunks for the best spawn column.
 *
 * Split out of the step body only so this file's two halves are separately readable;
 * the scoring, the search radius and the headroom check are unchanged.
 *
 * @returns {{x: number, y: number, z: number}} `y` is `-1` when nothing was found.
 */
function findSpawn(chunkManager) {
  let bestSpawnX = 0, bestSpawnZ = 0, bestSpawnY = -1, bestScore = -Infinity;

  // Calculate spawn — search loaded chunks for solid surface with headroom above.
  // Strategy: prefer GRASS/DIRT/SAND near sea level, fall back to any solid block if needed.
  function getBlockAt(chunk, lx, ly, lz) {
    return chunk.getBlock(lx, ly, lz);
  }

  // Surface blocks — prefer these for spawn (natural terrain topside)
  const SURFACE_BLOCKS = new Set([BLOCK_TYPES.GRASS, BLOCK_TYPES.DIRT, BLOCK_TYPES.SAND]);

  // Search only the center 8×8 area (around origin) for spawn.
  // Avoids spawning on edge of the 32×32 pre-generated region where terrain features tend to cluster.
  const spawnSearchRadius = 4; // 8x8 centered on chunk (0,0)

  for (const [key, chunk] of chunkManager.memoryCache) {
    if (!chunk || !chunk.blocks) continue;
    const { cx, cz } = ChunkManager.parseKey(key);

    // Only search within center spawnSearchRadius chunks from origin
    if (Math.abs(cx) > spawnSearchRadius || Math.abs(cz) > spawnSearchRadius) continue;

    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        for (let y = Math.min(MAX_Y - 1, 150); y >= MIN_Y; y--) {
          const block = getBlockAt(chunk, lx, y, lz);
          if (!BLOCK_BY_ID[block] || BLOCK_BY_ID[block].category !== 'solid') continue;

          // Prefer surface blocks above sea level
          const isSurface = SURFACE_BLOCKS.has(block);
          const aboveSea = y > SEA_LEVEL;

          // Check column clear (headroom for player — 2 blocks above feet)
          let colClear = true;
          for (let cy = y + 1; cy <= y + 3; cy++) {
            const cBlock = getBlockAt(chunk, lx, cy, lz);
            if (cBlock !== BLOCK_TYPES.AIR && cBlock !== BLOCK_TYPES.WATER) { colClear = false; break; }
          }
          if (!colClear) continue;

          // Score: elevation primary + surface bonus + above-sea bonus
          const worldX = cx * 16 + lx;
          const worldZ = cz * 16 + lz;
          let score = y * 100;           // Elevation is the primary factor (×100 to dominate bonuses)
          if (isSurface) score += 500;    // Surface block bonus
          if (aboveSea) score += 1000;     // Above-sea bonus

          if (score > bestScore) {
            bestSpawnX = worldX;
            bestSpawnZ = worldZ;
            bestSpawnY = y;
            bestScore = score;
          }
        }
      }
    }
  }

  return { x: bestSpawnX, y: bestSpawnY, z: bestSpawnZ };
}

/**
 * @param {import('../Game.js').Game} game
 */
export async function initPlayer(game) {
  const state = game.state;
  const deps = game.deps;
  const log = deps.log;
  const renderer = state.renderer;
  const chunkManager = state.chunkManager;
  const currentWorld = state.currentWorld;
  const selected = state.currentCharacter;

  // Wait briefly for initial chunks to populate memoryCache, then calculate spawn position
  await new Promise(resolve => setTimeout(resolve, 200));

  // Determine spawn position
  let bestSpawnX = 0, bestSpawnZ = 0, bestSpawnY = -1;

  // ─── Client-side: skip spawn search, use default position ───
  // Clients have no chunks at spawn time — host's chunks will stream in.
  // The player will fall to terrain when chunks arrive.
  if (game.isJoiningClient) {
    bestSpawnX = 0;
    bestSpawnZ = 0;
    bestSpawnY = SEA_LEVEL + 2; // Spawn above sea level, will fall to terrain
    console.log(`[Cuubz] Client spawn: X=${bestSpawnX + 0.5} Y=${bestSpawnY} Z=${bestSpawnZ + 0.5} (no chunks yet, will fall to terrain)`);
  } else {
    ({ x: bestSpawnX, y: bestSpawnY, z: bestSpawnZ } = findSpawn(chunkManager));
  }

  const spawnHeight = state.spawnHeight = bestSpawnY >= 0 ? bestSpawnY + 1.625 + 2 : SEA_LEVEL + 2;

  // Initialize Player at terrain level
  game.loadingStatus.textContent = 'Creating player...';
  if (game.loadingProgress) game.loadingProgress.style.width = '90%';

  const player = state.player = new Player();

  // Check if character has a saved position for this world
  const savedSpawn = (selected.spawnPoints && selected.spawnPoints[currentWorld.id]) || null;
  if (savedSpawn) {
    // Restore last saved position
    player.position.x = savedSpawn.x;
    player.position.y = savedSpawn.y;
    player.position.z = savedSpawn.z;
    log(`[Cuubz] Restored saved position: ${savedSpawn.x.toFixed(1)}, ${savedSpawn.y.toFixed(1)}, ${savedSpawn.z.toFixed(1)}`);
  } else {
    // No saved position — use calculated terrain spawn
    player.position.x = bestSpawnX + 0.5; // Center in chunk column
    player.position.y = spawnHeight;
    player.position.z = bestSpawnZ + 0.5;
  }
  player.pitch = -Math.PI / 8; // Sync with initial camera pitch

  player.linkWorld(deps.worldManager);

  // ─── Multiplayer: Send JOIN to game session ───
  // Must be after spawn search so we send the actual spawn position.
  // The WELCOME / PLAYER_JOINED / PLAYER_MOVE / PLAYER_LEFT handlers this reply lands on
  // are registered in step 11, *after* this call. Preserved deliberately — see the header.
  const sm = deps.sessionManager;
  if (sm && sm.client) {
    const charData = deps.characterManager ? deps.characterManager.getSelectedCharacter() : null;
    const spawnPos = { x: player.position.x, y: player.position.y, z: player.position.z };
    sm.client.joinGame(
      charData ? { name: charData.name, color: charData.color } : { name: 'Player', color: '#ffffff' },
      spawnPos,
      { yaw: 0, pitch: 0 }
    );
    if (sm.client._pendingGameJoin) {
      console.log('[JOIN] joinGame QUEUED — game session not connected yet, will send when ready');
    } else {
      console.log(`[JOIN] joinGame SENT immediately to game session at ${JSON.stringify(spawnPos)}`);
    }
  }

  // Initialize Biome Effects System (wire up visual effects per biome)
  const biomeEffects = state.biomeEffects = new BiomeEffects();
  if (renderer.scene && renderer.renderer) {
    biomeEffects.init(renderer.scene, renderer.renderer);
  } else {
    // If Three.js not ready yet, initialize on next frame when available
    setTimeout(() => {
      if (renderer.scene && renderer.renderer) {
        biomeEffects.init(renderer.scene, renderer.renderer);
      }
    }, 100);
  }

  // Handle mouse movement for camera rotation (pointer lock) — must be after player exists.
  // D-50: hoisted out of the `addEventListener` call so the same reference can be handed
  // to `removeEventListener`; an inline arrow removes nothing.
  const onCameraLook = (e) => {
    if (document.pointerLockElement === state.canvas) {
      player.yaw -= e.movementX * state.sensitivity;
      player.pitch -= e.movementY * state.sensitivity;
      // Clamp pitch to avoid flipping at gimbal lock limits
      player.pitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, player.pitch));
    }
  };
  document.addEventListener('mousemove', onCameraLook);
  state.addTeardown(() => document.removeEventListener('mousemove', onCameraLook));

  // Initialize Game Engine
  game.loadingStatus.textContent = 'Starting game loop...';
  if (game.loadingProgress) game.loadingProgress.style.width = '90%';

  // `game` IS the CuubzGame now (decision 34) — the `new CuubzGame()` that stood here
  // constructed the second object. `game.player` is the same object as `state.player`
  // and neither is ever reassigned; `setMode()` uses it to push creative-mode physics
  // onto the player.
  game.player = player;
  game.setMode(game.requestedMode || 'survival');

  // D-37, fixed in PR 14: this read `characterManager.storage` while the class it ran
  // against named the field `this.persistence`. `savePlayerState()` writes through this
  // handle rather than reaching into the manager for a second one.
  state.persistence = deps.characterManager ? deps.characterManager.storage : null;
}
