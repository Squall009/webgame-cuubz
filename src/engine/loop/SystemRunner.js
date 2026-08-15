/**
 * Cuubz — the frame spine (PR 18)
 *
 * `src/main.js:407–833`, split into six ordered steps. This file is the order and
 * nothing else: it holds no state, makes no decisions, and every line of logic it used
 * to contain is in `./steps/`.
 *
 * ─── THE ORDER IS THE BEHAVIOUR ─────────────────────────────────────────────
 *
 *   1. `inputStep`    407–437  clears the keyboard/touch edges, builds `inputState`
 *   2. `playerStep`   439–485  physics → **sendMove** → touch look → HUD bits
 *   3. `viewStep`     489–519  camera → sky → shadows → blockInteraction → hand
 *   4. `combatStep`   521–575  mob raycast, then `mouse.update()` clears the clicks
 *   5. `networkStep`  577–650  playerSync, chunkStreamer, TIME_SYNC, block sends
 *   6. `worldStep`    652–833  drops → PBR → biome → **render()** → tooltip → mobs
 *   7. `questStep`    (S1)      quest polling → hazards → vitals → seals → boss
 *
 * Step 7 is new and is last on purpose. Everything in it reads what the six above
 * produced this frame — the inventory block-breaking just filled, the position physics
 * just moved, the hits combat just registered — and running it earlier would make every
 * one of those readings a frame stale. `worldStep` was not extended because the draw
 * sits in its middle deliberately, and appending gameplay after `renderer.render()` puts
 * it on the far side of the present.
 *
 * Four of these couplings are load-bearing and are restated in the file that owns them:
 * `sendMove` is inside step 2 rather than step 5 (it must see the pre-look rotation the
 * frame already sent); `mouse.update()` is at the *end* of step 4 because steps 3 and 4
 * both read the just-clicked flags; the draw is in the *middle* of step 6; and `camPos`
 * is allocated in step 3 and read in step 6.
 *
 * `RenderLoop` owns everything outside this range — the rAF handle, the early-outs, the
 * delta, the cooldown decay, the debug overlay and `frameCount++`.
 */

import { inputStep } from './steps/InputStep.js';
import { playerStep } from './steps/PlayerStep.js';
import { viewStep } from './steps/ViewStep.js';
import { combatStep } from './steps/CombatStep.js';
import { networkStep } from './steps/NetworkStep.js';
import { worldStep } from './steps/WorldStep.js';
import { questStep } from './steps/QuestStep.js';

/**
 * Run one frame's systems, in the order `main.js` ran them.
 * @param {import('../../core/GameState.js').GameState} state
 */
export function runSystems(state) {
  const inputState = inputStep(state);
  playerStep(state, inputState);
  viewStep(state);
  combatStep(state);
  networkStep(state);
  worldStep(state);
  questStep(state);
}
