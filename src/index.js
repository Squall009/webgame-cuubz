/**
 * Cuubz — bootstrap entry (PR 9, emptied by PR 18)
 *
 * `index.html` loads exactly one script and this is it. Before PR 9 it loaded 65 classic
 * `<script src>` tags whose only contract was "declared earlier wins the global scope";
 * that mechanism, and the eight silent collisions it produced, is what `refactor.md` §2
 * is about.
 *
 * This file does three things:
 *
 *   1. installs the e2e test bridge (see `./testBridge.js`),
 *   2. keeps the four remaining unwired modules in the graph — **D-25**, see below,
 *   3. calls `start()` when the DOM is ready.
 *
 * §4.1 wants this file under 50 lines of real bootstrap "once Phase 3 has emptied
 * `main.js`". PR 18 deleted `src/main.js` and the real bootstrap is now four lines: the
 * import of `start` and the `readyState` branch. The line count above 50 is section 2 and
 * the comment that explains why section 2 exists — **do not delete either to make the
 * number**. PR 20 took D-25's ten down to four; the remaining four are reassigned, with
 * their reasons, in section 2. The box does not close in PR 20.
 */

// ─── 1. Test bridge ─────────────────────────────────────────────────────────
// Must be evaluated before the bootstrap so `window.__cuubz` exists as soon as the page
// has any script at all. It has no effect on the game.
import './testBridge.js';

// ─── 2. Modules that were script-tagged but are never referenced ────────────
//
// Twelve of the 65 files `index.html` used to load are not reached from the application
// at all. As classic scripts they were still fetched, parsed and evaluated on every page
// load; as ES modules they would simply vanish from the build — which would be a
// behaviour change smuggled into a PR that claims to be mechanical, and would quietly
// drop 6,000-odd lines out of reach of `npm run build` and of PR 11's `no-undef`.
//
// So they stay in the graph, explicitly, with this comment as the record. That is **D-25**
// in `BUGS.md`, and PR 20 is where each one is answered.
//
// ─── PR 20's answer: six deleted, one reassigned, five deferred ─────────────
//
// DELETED — six modules, 2,696 lines, each a duplicate, unreachable, or provably broken as
// written (evidence per module is in `BUGS.md`'s D-25 outcome): `engine/audio/AmbientAudio.js`
// (1,128), `engine/audio/SFX.js` (604), `engine/renderer/PerformanceOptimizer.js` (514),
// `game/mobs/ai/pathfinding.js` (238), `ui/hud/Crosshair.js` (107) and
// `engine/world/SpawnManager.js` (105). Their import lines and their tests went with them.
//
// The five gameplay modules below are **deferred, not deleted**, and are owned by **PR 34**:
//
//   game/systems/SurvivalSystem.js   (reached via mobIntegration's DAMAGE_SOURCES)
//   game/systems/DamageSystem.js     (reached via SurvivalSystem)
//   game/systems/QuestSystem.js      ─┐
//   game/entities/QuestMarker.js      ├─ side-effect imports below
//   game/entities/Boss.js            ─┘
//
// Why they are not in the delete list: deleting a *duplicate* or a *provably broken*
// module is triage — the evidence is in the file and the answer does not depend on what
// the game is supposed to be. Deleting five feature subsystems carrying ~1,000 passing
// test assertions between them is a product decision: it answers "are quests, bosses,
// environmental damage and survival meters part of Cuubz?", which is not a question this
// PR's evidence can settle, and the tests are the only reason anyone would ever be able
// to wire them up cheaply. PR 34 exists to answer it deliberately.
import './game/entities/Boss.js';
// CharacterManager.js and WorldManager.js were listed here as unreferenced modules kept in
// the graph pending the PR 14 reconcile. PR 14 ruled Option A: the bootstrap imports both
// by name now, so they are reached the ordinary way and their side-effect imports are gone.
import './game/entities/QuestMarker.js';
import './game/systems/QuestSystem.js';
// Noise.js is **reassigned to PR 23 with D-60** — not wired, not deleted. `BiomeSystem.js`
// carries a verbatim second copy of this module's Perlin implementation (twice over, in
// fact: once at module level and once again inside its IIFE), and collapsing those onto
// this file is what finally gives it a live consumer. Deleting it in PR 20 would delete
// `test/test_noise.js`'s 38 assertions and then PR 23 would have to put the module back.
import './engine/world/Noise.js';

// ─── 3. The application ─────────────────────────────────────────────────────
// `src/main.js` was an IIFE that ran on evaluation, exactly as it did as the last
// `<script>` tag in `index.html`. PR 18 dismantled the last of it: `start()` is that
// file's `init()`, and the module-scoped state it ran on is `src/core/Bootstrap.js`.
import { start } from './core/Bootstrap.js';

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start);
} else {
  start();
}
