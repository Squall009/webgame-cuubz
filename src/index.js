/**
 * Cuubz — bootstrap (PR 9)
 *
 * `index.html` loads exactly one script and this is it. Before PR 9 it loaded 65
 * classic `<script src>` tags whose only contract was "declared earlier wins the global
 * scope"; that mechanism, and the eight silent collisions it produced, is what
 * `refactor.md` §2 is about.
 *
 * Today this file does three things and nothing else:
 *
 *   1. installs the e2e test bridge (see `./testBridge.js` — temporary, PR 12 removes it),
 *   2. keeps every module that used to be script-tagged inside the module graph,
 *   3. imports `./main.js`, which still contains the whole menu/startGame/renderLoop
 *      monolith.
 *
 * §4.1 has this file at under 50 lines of real bootstrap once Phase 3 has emptied
 * `main.js` into `src/ui/`, `src/core/Game.js` and the systems. Until then the import of
 * `./main.js` *is* the bootstrap.
 */

// ─── 1. Test bridge ─────────────────────────────────────────────────────────
// Must be evaluated before main.js so `window.__cuubz` exists as soon as the page
// has any script at all. It has no effect on the game.
import './testBridge.js';

// ─── 2. Modules that were script-tagged but are never referenced ────────────
//
// Twelve of the 65 files `index.html` used to load are not reached from `main.js` at
// all. As classic scripts they were still fetched, parsed and evaluated on every page
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
import './game/entities/CharacterManager.js';  // RECONCILE with main.js:69 — PR 14
import './game/entities/WorldManager.js';      // RECONCILE with main.js:428 — PR 14
import './game/entities/QuestMarker.js';
import './game/mobs/ai/pathfinding.js';
import './game/systems/QuestSystem.js';
import './ui/hud/Crosshair.js';

// ─── 3. The application ─────────────────────────────────────────────────────
// `main.js` is an IIFE that runs on evaluation, exactly as it did as the last
// `<script>` tag in `index.html`. Phase 3 dismantles it (§13).
import './main.js';
