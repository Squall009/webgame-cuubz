/**
 * Cuubz — render-loop step 6: the world and the draw (PR 18)
 *
 * `src/main.js:652–833`, verbatim. Dropped items, the scroll-wheel hotbar cycle, the
 * hotbar repaint, the out-of-world rescue, the PBR shadow/lighting upload, biome
 * effects — then **`state.renderer.render()`** — then the hover tooltip raycast, the
 * render-chunk update and the mob system.
 *
 * ─── THE DRAW IS IN THE MIDDLE OF THIS STEP, DELIBERATELY ───────────────────
 *
 * `renderer.render()` sits at main.js:754, and the tooltip raycast and
 * `chunkManager.updateRenderChunks()` run **after** it. That is the frame the game has
 * always drawn: the tooltip reads the meshes the current frame just rendered, and the
 * chunk rebuild/unload deliberately takes the tail of the frame budget rather than
 * delaying the present. Do not tidy the draw to the end of the step.
 *
 * `state.camPos` is the fresh `THREE.Vector3` `ViewStep` allocated this frame
 * (main.js:494 read at main.js:717); see `ViewStep.js` for why it is a declared
 * `GameState` field rather than a recompute.
 */

import * as THREE from 'three';
import { reportStepError } from '../reportStepError.js';
import { BiomeSystem } from '../../world/BiomeSystem.js';
import { BLOCK_TYPES } from '../../world/BlockRegistry.js';
import { MIN_Y } from '../../world/ChunkData.js';

/**
 * @param {import('../../../core/GameState.js').GameState} state
 */
export function worldStep(state) {
  // Update dropped items (floating drops with pickup)
  if (state.droppedItems && state.droppedItems.drops.length > 0) {
    state.droppedItems.update(state.game.delta, state.player.position, state.inventory);
  }

  // Scroll wheel for hotbar cycling — D-55, the sole surviving path.
  //
  // `initHud.js` also registered a `document`-level `wheel` listener that called
  // `cycleSelection()`. A wheel event over the canvas bubbles to `document`, so both fired
  // and the hotbar advanced two slots per notch. PR 20 deleted that listener and kept this
  // one; the `inventoryOpen` guard below is the one thing the deleted listener had that
  // this path did not, and without it scrolling with the inventory open cycled the hotbar
  // behind it. `scrollDelta` must still be cleared when the guard fires, or a scroll made
  // with the inventory open would be replayed the frame it closes.
  if (state.mouse.scrollDelta !== 0) {
    if (!state.inventoryOpen) {
      state.inventory.cycleSelection(state.mouse.scrollDelta > 0 ? 1 : -1);
    }
    state.mouse.scrollDelta = 0;
  }

  // Update hotbar UI periodically
  if (state.frameCount % 5 === 0) {
    state.updateHotbarUI();
  }

  // Emergency rescue: only teleport if player falls completely out of the world.
  // The old threshold was spawnHeight-10 which fired whenever you entered
  // a cave or deep hole (e.g. spawnHeight=34 → fires at Y=24, above bedrock).
  // Now only fires at MIN_Y-5 — the player must be genuinely below bedrock.
  if (state.player.position.y < MIN_Y - 5) {
    state.player.position.y = state.spawnHeight;
    state.player.velocity.y = 0;
  }

  // Update PBR materials with shadow data + day/night lighting
  const pbrFactory = state.renderer.getPBRFactory();
  if (pbrFactory) {
    const shadowData = state.renderer.getShadowData();
    if (shadowData) {
      pbrFactory.updateShadowData(shadowData.map, shadowData.matrix);
    } else {
      // Log the first five frames with no shadow data, then stay quiet.
      state.shadowMissingCount++;
      if (state.shadowMissingCount <= 5) {
        console.warn('[Shadow] getShadowData returned null (frame', state.frameCount, ')');
      }
    }

    // Update PBR lighting uniforms from skybox (sun direction, color, intensity, ambient)
    if (state.skybox) {
      state.skybox.updatePBRFactory(pbrFactory);
    }
  } else {
    state.noPbrCount++;
    if (state.noPbrCount <= 3) {
      console.warn('[Shadow] No PBR factory available');
    }
  }

  // Update Biome Effects (particles only — sky/fog handled by day/night cycle)
  if (state.biomeEffects && state.chunkManager) {
    // Determine current biome using biomeSystem at player position
    const wx = Math.floor(state.player.position.x);
    const wz = Math.floor(state.player.position.z);
    let biomeData = null;
    try {
      // The world's generator version decides whether the Corrupt and Lava masks are
      // sampled at all (§3.1). Passing it is what keeps the fog the player sees and the
      // terrain the worker built in agreement — a v1 world must never report `corrupt`.
      biomeData = BiomeSystem.getBiomeAtWorldPos(
        wx, wz, state.chunkManager.worldSeed, state.chunkManager.genParams?.worldgenVersion
      );
    } catch { /* Fallback to default. D-89: bindless, because this is an EXPECTED
           condition (an unloaded column) and not a swallowed failure. */ }

    if (biomeData) {
      state.biomeEffects.setBiome(biomeData.id);

      // Set player/camera positions for particle spawning & billboarding
      state.biomeEffects.setPlayerPosition(state.player.position.x, state.player.position.y, state.player.position.z);
      state.biomeEffects.setCameraPosition(state.camPos);

      // D-59: a `biomeData.id === 'lava'` branch calling `spawnLavaBubbles` and a
      // `=== 'corrupt'` branch calling `spawnToxicBubbles` used to sit here. Both were
      // unreachable. `BiomeSystem.getBiomeAtWorldPos` derives its id from `NAME_TO_ID`,
      // whose ten entries are the only ten biome names the module defines:
      //
      //   deep_ocean ocean beach plains forest badlands tundra desert mountains frozen_peaks
      //
      // Neither `lava` nor `corrupt` is among them, and the `toLowerCase()` fallback can
      // only ever see one of those same ten names, so neither method was ever called.
      // Verified against `src/engine/world/BiomeSystem.js` before deleting.
      //
      // This is the second artefact of the same biome-name drift — D-39 was world previews
      // advertising "Lava" and "Corrupt" as biomes that do not exist, fixed in PR 14 by
      // regenerating the preview list from `BiomeSystem`. This was the render loop's copy
      // of that same wrong list. `spawnLavaBubbles` / `spawnToxicBubbles` stay on
      // `BiomeEffects` — they are that class's API and are out of PR 20's scope.
    }

    // Update animation timers & particles
    // Pass skybox base color so biome tint blends with day/night cycle
    state.biomeEffects.update(state.game.delta, state.skybox ? state.skybox._baseSkyColor : null, state.skybox ? state.skybox.getFogDensity() : undefined);

    // Update the sky dome shader with the final blended sky color.
    // The sky dome (gradient sphere) was hardcoded to blue and never
    // received day/night or biome color updates — this fixes that.
    const finalSky = state.biomeEffects.getFinalSkyColor();
    if (finalSky) {
      // Create gradient: top slightly darker than horizon
      const topColor = finalSky.clone();
      topColor.r = Math.max(0, topColor.r * 0.6);
      topColor.g = Math.max(0, topColor.g * 0.6);
      topColor.b = Math.max(0, topColor.b * 0.85);
      state.renderer.updateSkyColors(finalSky, topColor);
    }
  }

  // Render scene
  state.renderer.render();

  // DEBUG: Hover raycasting — show block ID at crosshair center
  const tooltip = document.getElementById('block-tooltip');
  const tooltipId = document.getElementById('tooltip-block-id');
  const tooltipName = document.getElementById('tooltip-block-name');
  if (state.renderer.camera && state.renderer.chunkGroup) {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), state.renderer.camera);
    raycaster.far = 7; // Same as block interaction range

    const intersects = raycaster.intersectObjects(state.renderer.chunkGroup.children, true);
    if (intersects.length > 0) {
      const hit = intersects[0];
      const obj = hit.object;
      if (obj.userData && obj.userData.chunkKey && obj.userData.blockIdToName) {
        // Calculate block position from intersection point.
        // Mesh position is the chunk origin in world space.
        // IMPORTANT: hit.point sits on the surface, so floor() can land
        // in the air block above. We check both the hit position and
        // one block below to find the actual solid block.
        const meshPos = obj.position;

        const localX = Math.floor(hit.point.x - meshPos.x);
        const localY = Math.floor(hit.point.y - meshPos.y);
        const localZ = Math.floor(hit.point.z - meshPos.z);

        // Clamp to chunk bounds (X/Z: 0-15, Y: -32 to 64)
        if (localX >= 0 && localX < 16 && localZ >= 0 && localZ < 16 && localY >= -32 && localY <= 64) {
          try {
            // First check the exact hit position
            let blockId = obj.userData.chunkData.getBlock(localX, localY, localZ);

            // If that's air/cave_air, check one block below (hit point is on surface boundary)
            if ((blockId === BLOCK_TYPES.AIR || blockId === BLOCK_TYPES.CAVE_AIR) && localY > -32) {
              blockId = obj.userData.chunkData.getBlock(localX, localY - 1, localZ);
            }

            const blockName = obj.userData.blockIdToName[blockId] || 'unknown';

            tooltipId.textContent = `ID: ${blockId}`;
            tooltipName.textContent = blockName.replace(/_/g, ' ');
            tooltip.classList.remove('hidden');
          } catch {
            // Block out of range — hide tooltip. Expected, not swallowed; see above.
            tooltip.classList.add('hidden');
          }
        } else {
          tooltip.classList.add('hidden');
        }
      } else {
        tooltip.classList.add('hidden');
      }
    } else {
      tooltip.classList.add('hidden');
    }
  }

  // Update render chunks for player position (per-frame mesh rebuild + unload)
  if (state.chunkManager) {
    state.chunkManager.updateRenderChunks(state.player.position.x, state.player.position.z);
  }

  // ─── Update Mob System ──────────────────────
  if (state.mobIntegration) {
    try {
      // Pass a biome lookup function so each chunk spawns its own biome's mobs
      const getBiomeFn = (wx, wz) => {
        try {
          const bd = BiomeSystem.getBiomeAtWorldPos(
            wx, wz, state.chunkManager.worldSeed, state.chunkManager.genParams?.worldgenVersion
          );
          return bd ? bd.id : undefined;
        } catch { return undefined; } // an unloaded column, not a failure
      };
      state.mobIntegration.update(state.game.delta, state.chunkWorld, state.player.position, state.chunkManager.renderDistance || 6, getBiomeFn);
    } catch (e) {
      // **D-89 is this exact catch.** It logged only while `frameCount < 10`, so after the
      // tenth frame a throw was silent and mobs simply stopped updating for the rest of
      // the session — in the one subsystem D-77 had just put a renderer inside.
      reportStepError(state, 'Mob update', e);
    }
  }
}
