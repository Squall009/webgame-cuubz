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
 *   2. keeps the ten unwired modules in the graph — **D-25, PR 20's**, see below,
 *   3. calls `start()` when the DOM is ready.
 *
 * §4.1 wants this file under 50 lines of real bootstrap "once Phase 3 has emptied
 * `main.js`". PR 18 deleted `src/main.js` and the real bootstrap is now four lines: the
 * import of `start` and the `readyState` branch. The line count above 50 is section 2 and
 * the comment that explains why section 2 exists — **do not delete either to make the
 * number**; when PR 20 wires or deletes those ten modules, the box closes on its own.
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
// So they stay in the graph, explicitly, with this comment as the record. They are not
// dead code that PR 9 gets to delete: several are unwired *features* (the entire audio
// subsystem, survival damage, quests, boss fights), which is logged as **D-25** in
// `BUGS.md` and owned by PR 20. When each is wired to a real system or deleted, its
// line here goes with it.
import './engine/audio/AmbientAudio.js';   // 1,170 lines — never instantiated
import './engine/audio/SFX.js';            //   621 lines — never instantiated
import './engine/renderer/PerformanceOptimizer.js';
import './engine/world/Noise.js';          // the main-thread copy; the worker has its own
import './engine/world/SpawnManager.js';
import './game/entities/Boss.js';
// CharacterManager.js and WorldManager.js were listed here as unreferenced modules kept in
// the graph pending the PR 14 reconcile. PR 14 ruled Option A: the bootstrap imports both
// by name now, so they are reached the ordinary way and their side-effect imports are gone.
import './game/entities/QuestMarker.js';
import './game/mobs/ai/pathfinding.js';
import './game/systems/QuestSystem.js';
import './ui/hud/Crosshair.js';

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
