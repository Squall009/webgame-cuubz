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
 *   2. keeps the ONE remaining unwired module in the graph — **D-25**, see below,
 *   3. calls `start()` when the DOM is ready.
 *
 * §4.1 wants this file under 50 lines of real bootstrap "once Phase 3 has emptied
 * `main.js`". PR 18 deleted `src/main.js` and the real bootstrap is now four lines: the
 * import of `start` and the `readyState` branch. The line count above 50 is section 2 and
 * the comment that explains why section 2 exists — **do not delete either to make the
 * number**. PR 20 took D-25's ten down to four; PR 34 deleted the five gameplay modules
 * outright (decision below), which leaves ONE. The "< 50 lines" checkbox stays open by
 * decision 41: it is not a target to chase.
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
// ─── PR 34's answer to the five deferred gameplay modules: ALL FIVE DELETED ──
//
// `game/systems/SurvivalSystem.js` (1,159), `game/systems/DamageSystem.js` (627),
// `game/systems/QuestSystem.js` (262), `game/entities/QuestMarker.js` (605) and
// `game/entities/Boss.js` (1,135) are gone, with their ~1,000 test assertions. PR 20 held
// them back because "are quests, bosses, environmental damage and survival meters part of
// Cuubz?" is a product question its evidence could not settle. PR 34's evidence settles it
// the other way:
//
//   • Not one of the five has ever executed outside `test/`. None is constructed anywhere
//     in `src/`; the only edge in was `mobIntegration.js`'s `DAMAGE_SOURCES` import, and
//     that table's real home has been `game/data/DamageSources.js` since PR 9 / D-26.
//     They are not disabled features — they are code that has never run.
//   • Wiring any of them is a feature project, not a refactor step. `Boss.js` has no
//     rendering at all (no THREE import, no mesh, no boss HUD element), so wiring it means
//     writing a boss renderer from scratch. `SurvivalSystem.generateHUDHTML()` emitted a
//     self-contained `#survival-hud` overlay while `ui/templates/hud.js`'s five
//     `.meter-fill` elements are hard-coded `width:100%` and nothing in `src/` writes to
//     them — two incompatible HUD designs, and choosing one is a UI decision. The quest
//     layer had four incompatible `questProgress` shapes across `WorldManager`, `Host.js`,
//     `QuestSystem` and `{}`, and zero production callers of `setQuestProgress` /
//     `advanceQuest`. `DamageSystem.update()` hard-returned without `linkSurvivalSystem()`,
//     so it could not even be wired on its own.
//   • Their tests defended defects. `DamageSystem`'s `LAVA_ID = 15` / `TOXIC_SLIME_ID = 17`
//     were pre-renumbering ids against a registry where lava is 47 and toxic slime 188
//     (D-64) — and the test asserted the wrong mapping. `Boss.phaseTransitionTimer` was
//     never initialised, so a deserialized boss was NaN-frozen and unkillable, and nothing
//     caught it.
//   • Deleting is the reversible option: everything is in git and at the pushed
//     `pre-refactor-baseline` tag, and a feature PR can restore any of it *with a design*.
//     Keeping them meant every future change carried them in its blast radius — the exact
//     complaint that put them on D-25.
//
// It is the same line decision 42 drew when it deleted six sibling modules.
//
// CharacterManager.js and WorldManager.js were listed here as unreferenced modules kept in
// the graph pending the PR 14 reconcile. PR 14 ruled Option A: the bootstrap imports both
// by name now, so they are reached the ordinary way and their side-effect imports are gone.
//
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
