# Cuubz — Refactoring Plan (v2, verified)

> **Goal:** Turn a 34k-line, script-tag, single-global-scope codebase into a modular ES-module architecture — without losing player data, breaking deployment, or silently changing gameplay.
>
> **This version was written by running the code, not skimming it.** Every number below was measured on 2026-07-29. v1 of this document was rejected: its diagnosis was directionally right but its facts were wrong, its safety gate (the test suite) does not exist, and it omitted deployment entirely. See [Appendix B](#appendix-b--what-changed-from-v1) for the diff.
>
> **Handoff format:** numbered PRs, each independently verifiable with its own acceptance criteria and rollback point. Not weeks. Do not batch PRs.

---

## Table of Contents

1. [Read This First — Hard Constraints](#1-read-this-first--hard-constraints)
2. [Why Modules: The Global Scope Is Actively Broken](#2-why-modules-the-global-scope-is-actively-broken)
3. [Measured Current State](#3-measured-current-state)
4. [Architecture Target](#4-architecture-target)
5. [Phase 0 — Stop The Bleeding (PR 1–6, plus 6b)](#5-phase-0--stop-the-bleeding-pr-16-plus-6b)
6. [Phase 1 — Vite + ES Modules (PR 7–11)](#6-phase-1--vite--es-modules-pr-711)
7. [Phase 2 — Hoist Closure State onto `Game` (PR 12–13)](#7-phase-2--hoist-closure-state-onto-game-pr-1213)
8. [Phase 3 — Decompose main.js (PR 14–19)](#8-phase-3--decompose-mainjs-pr-1419)
9. [Phase 4 — Systems, EventBus, Split Monoliths (PR 20–25)](#9-phase-4--systems-eventbus-split-monoliths-pr-2025)
10. [Phase 5 — UI / HTML / CSS (PR 26–29)](#10-phase-5--ui--html--css-pr-2629)
11. [Phase 6 — Shared Protocol & Test Migration (PR 30–33)](#11-phase-6--shared-protocol--test-migration-pr-3033)
12. [Deferred: Three.js Upgrade (separate project)](#12-deferred-threejs-upgrade-separate-project)
13. [File Migration Map](#13-file-migration-map)
14. [Anti-Patterns](#14-anti-patterns)
15. [Appendices](#appendix-a--full-file-inventory)

---

## 1. Read This First — Hard Constraints

These are the things that will destroy the project if ignored. Each is verified.

### 1.1 There is no green baseline. The suite is red *now*.

```
$ bash test/run_tests.sh
53 test files → 21 pass, 32 fail
```

Three source files **crash on `require`** because `module.exports` references identifiers that only exist as script-tag globals:

| File | Error |
|---|---|
| `js/systems/crafting.js:?` | `ReferenceError: BLOCK_TYPES is not defined` |
| `js/systems/damageSystem.js:?` | `ReferenceError: DAMAGE_SOURCES is not defined` |
| `js/entities/worldManager.js:462` | `ReferenceError: MIN_NAME_LENGTH is not defined` |

The remaining failures are real assertion failures and missing deps (`test_skybox`: fog density 0.008 vs expected 0.001; `test_responsiveHUD`: 26 failing assertions; `test_pageLoad`: **jsdom is not installed**).

> **You cannot verify "feature parity" against a red baseline.** Phase 0 exists solely to produce a trustworthy gate. Do not start Phase 1 until PR 4 lands.

Also: `"test": "node test/run_tests.sh"` (proposed in v1) **cannot work** — it's a bash script. Use `bash test/run_tests.sh`.

### 1.2 Pin `three@0.134.0`. Do NOT run `npm install three`.

`js/three.min.js` is **r134 (2021)**. The renderer silently depends on r134 defaults:

- `js/renderer/pbrShader.js` is **843 hand-written lines** with **7 `ShaderMaterial`** instances, `fog: true` on 6 of them (lines 710, 734, 752, 781, 798, 826), custom world-space lighting, and custom shadow-map uniforms.
- There is **zero** occurrence of `outputEncoding`, `sRGBEncoding`, `outputColorSpace`, `physicallyCorrectLights`, or `useLegacyLights` anywhere in `js/`.

Modern Three (r15x+) flipped color management to sRGB-by-default and changed light units. A blind upgrade changes **every colour in the game** and breaks the custom shader's fog/shadow integration.

Good news, verified: neither worker uses THREE at all (`workerGeneration.js`: 0 refs, `meshWorker.js`: 0 refs), and no removed APIs (`THREE.Geometry`, `CanvasRenderer`, `JSONLoader`) are used. So a pinned r134 module install is a pure no-op visually.

→ Phase 1 installs `three@0.134.0` **exactly**. The upgrade is [§12](#12-deferred-threejs-upgrade-separate-project), a separate project gated on screenshot diffing.

### 1.3 Web Workers are fetch+Blob and will break under Vite.

`js/chunkmanager.js` builds both worker pools by fetching source text and wrapping it in a Blob:

```js
// chunkmanager.js:222   (world gen)
const blob = new Blob([source], { type: 'application/javascript' });
// chunkmanager.js:239   (mesh builder)
const response = await fetch('js/renderer/meshWorker.js?v=20260726-1');
```

Problems:
- Hardcoded `js/...` paths break the instant files move to `src/`.
- `js/renderer/meshWorker.js` **is not in any `<script>` tag** — Vite will not emit it unless told to.
- `js/world/workerGeneration.js` is **dual-mode**: an IIFE taking `globalScope` (`typeof globalScope !== 'undefined'` ×2), *and* it's script-tagged at `index.html:523` for a main-thread inline fallback, *and* it's fetched for the worker. That triple contract must be preserved deliberately or removed deliberately.

→ PR 9 must convert to `new Worker(new URL('./meshWorker.js', import.meta.url), { type: 'module' })` or Vite's `?worker` / `?url` imports, and state explicitly what happens to the inline fallback.

### 1.4 Deployment is the single biggest risk. A build step breaks it.

- `sync.sh` tars the repo → `scp` → extracts into `/var/www/html` on `10.0.30.160`, served as **raw static files**.
- `cuubz-relay.service` has `WorkingDirectory=/var/www/html/server`, `ExecStart=node index.js`.
- **`sync.sh` excludes `dist/`** (line: `--exclude='dist'`) **and `.gitignore` ignores `dist/`.**

→ The first `./sync.sh` after Phase 1 would ship **a site with no JavaScript at all**. PR 10 must land a build-then-sync `sync.sh` in the same PR as the Vite switch, and confirm the systemd unit's `WorkingDirectory` still resolves after the layout change.

> **PR 6 consolidated this section into [`DEPLOY.md`](./DEPLOY.md) — read that before deploying.** It documents the full deploy path line by line and adds nine defects this section does not mention, of which the three that matter most are: **`sync.sh` never restarts the relay** (no `systemctl` anywhere in the repo, so `server/` changes are silently inert), **`tar xzf` never deletes** (the stale `js/` tree stays live next to `src/` after PR 9), and **there is no rollback mechanism at all** — extraction is in-place with no backup retained. PR 10 owns all three. `DEPLOY.md` §8 is the defect table with owners.

### 1.5 Player data must survive byte-for-byte.

Hard invariants — never change these strings or the schema behind them:

| Key | Location | Value |
|---|---|---|
| IndexedDB name | `js/chunkmanager.js:20` | `'cuubz-worlds'` |
| IndexedDB version | `js/chunkmanager.js:21` | `2` |
| localStorage | `js/renderer/performanceSettings.js:34,52` | `'cuubz:settings'` |
| localStorage | `js/main.js:1272,1284,1593,1768,1785` | `'cuubz_last_session'` |

→ **Save/load test at every single checkpoint:** create a world, place blocks, quit to menu, reload the page, re-enter, confirm blocks persist. **PR 6b automated most of it early — run `npm run test:e2e`** (104 assertions, real browser, reads IndexedDB and localStorage directly). Three steps stay manual until PR 12–13 hoists the closure locals: placing/breaking blocks, quit-to-menu (blocked by `DEPLOY.md` D-14), and multiplayer. See the [PR 6b outcome](#pr-6b--automate-the-saveload-gate--done).

> **PR 6 found this table incomplete and superseded it — the authoritative list is now [`DEPLOY.md` §2](./DEPLOY.md#2-do-not-change-player-data-invariants).** The four rows above are real, but they miss: the three `js/world/persistence.js` localStorage keys (**`cuubz:characters`** — every character the player has ever made — plus `cuubz:slotMap` and `cuubz:worldSlot:{N}:conf`), both IndexedDB object stores and their key paths, and the entire chunk binary format (magic `"CUUB"`, version `3`, 20-byte header, FNV-1a checksum constants). It also misses the two hazards that make the table load-bearing: **bumping `DB_VERSION` destroys every player's worlds** (`onupgradeneeded` deletes all object stores before recreating them), and **chunk primary keys are not world-scoped, so the three world slots overwrite each other's terrain** — a live bug. The executable 14-step checklist is [`DEPLOY.md` §7](./DEPLOY.md#7-saveload-checklist); it includes the save-timing rules (chunks flush on a 5 s timer, player state every 30 s / on Escape) without which the naive version of this test produces false failures.

### 1.6 `renderLoop` cannot be extracted as written.

`startGame()` (`js/main.js:2156`) wraps everything in `setTimeout(async () => { try { ... } })`. About 1,845 lines sit at ≥10 spaces of indentation. `renderLoop` (`js/main.js:3908`) is a closure over **~184 local variables**, including `renderer, chunkManager, player, inventory, skybox, biomeEffects, blockInteraction, chunkStreamer, playerSync, droppedItems, firstPersonHand, itemAtlas` and ~170 more.

→ [Phase 2](#7-phase-2--hoist-closure-state-onto-game-pr-1213) exists purely to hoist those locals onto an explicit `Game` object **before** any file splitting. Skip it and every extraction in Phase 3 breaks.

### 1.7 `js/mobs/` is untracked. Commit or park it.

18 files, **3,516 lines**, entirely absent from git. `MOB_PLAN.md` is **56 checked / 253 unchecked** — a half-built subsystem. Additionally **16 tracked files are modified right now** (`index.html`, `js/main.js`, `js/chunkmanager.js`, `js/input/interaction.js`, `js/multiplayer/chunkStreamer.js`, `js/multiplayer/client.js`, `js/renderer/firstPersonHand.js`, `js/renderer/voxelRenderer.js`, `js/systems/inventory.js`, `server/session.js`, `package.json`, `package-lock.json`, + 4 textures) plus 6 untracked texture PNGs.

→ PR 1 commits everything and tags a rollback point. Refactoring on top of uncommitted work has no undo.

### 1.8 Textures: 118 MB, 3,370 files, already in git.

3,364 are tracked; `.git` is 117 MB. v1 said `cp -r textures/* public/textures/` — that **duplicates 118 MB on disk and in the repo**.

→ Use `git mv`, or better: point Vite's `publicDir` at the existing `textures/` location and don't move anything. Also note `js/renderer/textureAtlas.js` fetches with **relative** paths (`textures/blocks/manifest.json:213`, `textures/blocks/${base}.png:233,235,237,254,256,258`) which break if the base URL changes — needs a leading `/` or an `import.meta.env.BASE_URL` prefix.

### 1.9 `scripts/generate-manifest.js` eval-parses source with a regex.

```js
// scripts/generate-manifest.js:22
const BLOCK_REGISTRY = eval('(' + registrySource.match(/const BLOCK_REGISTRY = (\[.*?\]);/s)[1] + ')');
```

`export const BLOCK_REGISTRY = [...]` still matches. Any reformatting of that array does not. Add a smoke test for this script in PR 4.

---

## 2. Why Modules: The Global Scope Is Actively Broken

**This is the strongest argument for the refactor, and it's not theoretical.** All 64 `<script>` tags share one scope. I parsed `index.html`'s actual load order and enumerated top-level declarations: **355 unique symbols, 8 of them declared in more than one file.** Later scripts win.

### 2.1 Three are live production bugs

| Symbol | Loser | Winner (loads later) | Consequence |
|---|---|---|---|
| `getBossDefinition` | `js/entities/boss.js:317` (reads `BOSS_DEFINITIONS`) | `js/systems/damageSystem.js:130` (reads `BOSS_ATTACKS`) | `boss.js:362` — `new Boss()` calls the *wrong* function, gets `null`, and **throws `Unknown boss: ...`**. Boss spawning is broken in production. |
| `validateInventory` | `js/multiplayer/host.js:205` — `(playerId, inventory)` | `js/multiplayer/inventorySync.js:189` — `(slots, maxSlots)` | `host.js:934` passes a playerId **string** as `slots` → `Array.isArray` false → **every client→host inventory sync is rejected**. The error log then reads `valid.reason`, which is `undefined`. |
| `isMobileViewport` | `js/renderer/performanceOptimizer.js:54` — `(screenWidth)`, `< 768` | `js/multiplayer/playerListHUD.js:63` — `()`, `<= 600` | `performanceOptimizer.js:400` passes an argument that is silently ignored, and the mobile threshold is **600, not 768**. Mobile perf tuning is misapplied. |

Load order confirming the winners: `boss.js:556` < `damageSystem.js:563`; `host.js:572` < `inventorySync.js:575`; `performanceOptimizer.js:544` < `playerListHUD.js:576` (all `index.html` line numbers).

### 2.2 Five more are currently harmless but prove the pattern

`smoothstep` (`skybox.js` → `ambient.js`, identical impls) · `distanceBetween` (`boss.js` → `playerSync.js`, same math) · `fbm2` and `applySpline` (`noise.js` → `biomeSystem.js`, aliases) · `_log` (`client.js`, `host.js`, `game.js` — three-way).

### 2.3 Do this deliberately, in Phase 0, with tests

ES modules will **silently fix all eight**. If you don't fix them first, your "behavior is identical" verification becomes a lie: boss spawning starts working, host inventory sync starts working, and the mobile breakpoint shifts from 600 to 768. Fix them in PR 3 with regression tests so the change is attributable.

### 2.4 The mechanism is implicit globals, not `window.*`

v1 blamed `window.GlobalName` exports. There are only **4** such assignments in the whole codebase:

```
js/util/logger.js:39        window.CuubzLogger = CuubzLogger;
js/game.js:274              window.CuubzGame = Game;
js/game.js:275              window.CuubzBlockPalette = BlockPalette;
js/mobs/mobIntegration.js:125  window.MobIntegration = MobIntegration;
```

The real mechanism is **implicit top-level `const`/`let`/`class`/`function` in classic scripts**, which share one scope with no export marker at all.

`typeof X !== 'undefined'` totals **126** occurrences across 63 files — but **62 are `typeof module`** (the CommonJS test shim) and 15 are `typeof window`. Excluding host builtins, only **29** are genuine cross-module guards:

```
CuubzLogger ×4 · QUEST_REGISTRY ×2 · globalScope ×2 · sessionManager · mobIntegration
inventoryOpen · _INLINE_BLOCK_PROPERTIES · Skybox · PlayerSyncManager · PlayerListHUD
NAMED_ITEMS · MultiplayerClient · InventorySync · HostManager · FirstPersonHand · (+ ~10 more)
```

`main.js` has 16 of them. That's a bounded, tractable list — not "littered everywhere". Don't send the implementer hunting ghosts.

---

## 3. Measured Current State

### 3.1 Totals

| Metric | Value |
|---|---|
| JS files in `js/` (excl. `three.min.js`) | **64** |
| Total lines in `js/` (excl. `three.min.js`) | **33,912** |
| `<script>` tags in `index.html` | **64** (v1 said ~50) |
| `index.html` lines | 604 |
| Inline `style="` attributes in `index.html` | **24** |
| `css/style.css` | ~2,100 lines |
| Test files | **53** (v1 said 55) — 21 pass, 32 fail |
| `server/*.js` | ~1,110 lines, CommonJS, **not the problem** |
| Untracked mob subsystem | 18 files, 3,516 lines |
| `textures/` | 118 MB, 3,370 files (3,364 tracked) |

### 3.2 The 15 largest files (all of these need a destination in the target tree)

```
4919  js/main.js                       1048  js/systems/inventory.js
1664  js/chunkmanager.js               1048  js/multiplayer/client.js
1175  js/multiplayer/host.js           1031  js/renderer/skybox.js
1170  js/audio/ambient.js               846  js/multiplayer/playerSync.js
1160  js/systems/survival.js            843  js/renderer/pbrShader.js
1152  js/entities/boss.js               813  js/multiplayer/inventorySync.js
1064  js/world/workerGeneration.js      788  js/renderer/chunkMeshBuilder.js
                                        769  js/multiplayer/chunkStreamer.js
```

Then: `voxelRenderer.js` 667 · `damageSystem.js` 634 · `sfx.js` 621 · `questMarker.js` 613 · `interaction.js` 589 · `textureAtlas.js` 549 · `performanceOptimizer.js` 541 · `crafting.js` 527 · `mobDefinitions.js` 486. Full inventory in [Appendix A](#appendix-a--full-file-inventory).

> v1 never mentioned 52 of the 64 files, including 11 of the 15 largest. Its target tree had **no `src/audio/` directory at all** and no destination for `boss.js`, `performanceSettings.js`, `performanceOptimizer.js`, `meshWorker.js`, or `persistence.js`. The tree in [§4.1](#41-target-directory-structure) is complete.

### 3.3 Real symbol landmarks in `main.js`

**Use symbol names, never line numbers.** v1's entire §8.1 line table was wrong (e.g. it put `renderLoop` at 3950–4350 and `startGame` at 1850–2150). Actual, as of the current working tree:

| Symbol | Line |
|---|---|
| IIFE opens | 6 |
| `class BrowserCharacterManager` | **69** (v1: 60–200) |
| `class BrowserWorldManager` | **428** (v1: 420–610) |
| `function renderWorldSlots` | **606** (v1: 615–700) |
| `function initMenuNavigation` | 804 |
| `const REJOIN_STORAGE_KEY` | 1593 |
| `class SessionManager` | **1723** |
| `async function startGame` | **2156** (v1: 1850–2150) |
| `new CuubzGame()` | 2569 |
| `function renderLoop` | **3908** (v1: 3950–4350) |
| `function updateDebugStats` | 4394 |
| `function setupPauseMenu` | 4428 |
| `new BrowserCharacterManager(persistence)` | 4749 |

These will drift after the first edit. Grep for the symbol.

### 3.4 Duplicate managers — decide before touching them

| In `main.js` | Duplicates | Status |
|---|---|---|
| `BrowserCharacterManager` (L69) | `js/entities/characterManager.js` (392 lines) | Script-tagged, **has tests**, `require`s cleanly. `main.js` does **not** use it. |
| `BrowserWorldManager` (L428) | `js/entities/worldManager.js` (463 lines) | Script-tagged, **has tests**, currently **crashes on require**. `main.js` does **not** use it. |

v1's §4.1 said move `BrowserCharacterManager` → `src/game/entities/CharacterManager.js`, which **collides with the existing tested file**. PR 14 must make an explicit reconcile-or-delete decision and record it here.

Similarly, `js/game.js` (280 lines) is mostly a stub, touched only at `new CuubzGame()` (`main.js:2569`). State plainly: **`core/Game.js` is a rewrite, not a move.**

### 3.5 Protocol duplication — v1 was half wrong

`MESSAGE_TYPES` is defined in exactly two places: `js/multiplayer/client.js:40` and `server/session.js:30`. It is **referenced** in `js/multiplayer/host.js` — which never defines it, another silent load-order dependency. `matchmaking.js` and `server/index.js` have **zero** references (v1 claimed four-way duplication).

Un-noticed by v1: the **face/quad table is duplicated** — `var FACES = [...]` at `js/renderer/meshWorker.js:36` and an equivalent `sides` array at `js/renderer/chunkMeshBuilder.js:371`, in different formats. Worth its own task (PR 24).

### 3.6 Source-text tests conflict with Phase 5

Six tests `readFileSync` + regex over CSS/HTML/source rather than exercising behavior:

```
test_responsiveHUD  test_mobileViewports  test_pageLoad
test_textureAssets  test_textureGenerator test_chunkBinaryCodec
```

Slimming `index.html` and splitting CSS **invalidates all of them**. v1 scheduled that work (its Phase 4) *before* its test migration (Phase 5). → Resolved here: PR 26 rewrites or deletes them in the same PR that changes the HTML/CSS. No orphan window.

### 3.7 Root causes (corrected)

1. **No module system.** 64 script tags, one shared scope, 355 top-level symbols, 8 collisions, invisible dependency graph.
2. **`main.js` absorbed everything** — screens, character CRUD, world CRUD, sessions, game init, the whole render loop, inventory UI, crafting UI, hotbar, pause menu, perf settings, multiplayer wiring, mob attacks, biome effects, debug stats, audio toggles.
3. **`renderLoop` is a 184-variable closure** — extraction is blocked until state is hoisted.
4. **Inconsistent export style** — 4 `window.*`, 62 CommonJS shims, dual-mode IIFEs, bare classes.
5. **Ad-hoc state** — `game.frameCount`, `game.attackCooldown`, `game._shadowMissingCount`, `game._noPbrCount`.
6. **Fragile multiplayer wiring** — long inline `if (sessionManager && ...)` chains.
7. **No CI.** 34k lines, red suite, no automated gate on any push.

---

## 4. Architecture Target

### 4.1 Target Directory Structure

Complete — every one of the 64 files has a destination.

```
cuubz/
├── index.html                  # Vite entry, stays at root (~80 lines after PR 26)
├── textures/                   # STAYS PUT — Vite publicDir points here (118 MB, do not copy)
├── src/
│   ├── index.js                # Bootstrap (<50 lines)
│   ├── core/
│   │   ├── Game.js             # REWRITE (js/game.js is a stub) — owns loop, systems, state
│   │   ├── GameState.js        # Absorbs the ~184 hoisted renderLoop closure locals
│   │   └── EventBus.js
│   ├── engine/
│   │   ├── loop/{RenderLoop.js, SystemRunner.js}
│   │   ├── renderer/
│   │   │   ├── VoxelRenderer.js          ← js/renderer/voxelRenderer.js
│   │   │   ├── PBRShader.js              ← js/renderer/pbrShader.js (843, keep intact)
│   │   │   ├── SkyRenderer.js            ← js/renderer/skybox.js (1031, split cycle out)
│   │   │   ├── ChunkMeshBuilder.js       ← js/renderer/chunkMeshBuilder.js
│   │   │   ├── meshWorker.js             ← js/renderer/meshWorker.js  (?worker import)
│   │   │   ├── TextureAtlas.js           ← js/renderer/textureAtlas.js
│   │   │   ├── ItemTextureAtlas.js       ← js/renderer/itemTextureAtlas.js
│   │   │   ├── FirstPersonHand.js        ← js/renderer/firstPersonHand.js
│   │   │   ├── BiomeEffects.js           ← js/renderer/biomeEffects.js
│   │   │   ├── PerformanceOptimizer.js   ← js/renderer/performanceOptimizer.js
│   │   │   └── PerformanceSettings.js    ← js/renderer/performanceSettings.js
│   │   ├── world/
│   │   │   ├── ChunkManager.js      ← coordinator + public API   (~300)
│   │   │   ├── WorkerPool.js        ← extracted from chunkmanager (~80)
│   │   │   ├── ChunkStorage.js      ← IndexedDB + flushDirtyChunks (~200)
│   │   │   ├── ChunkCache.js        ← memoryCache Map (~100)
│   │   │   ├── RegionTracker.js     ← checkRegion/startRegionCheck (~150)
│   │   │   ├── workerGeneration.js  ← js/world/workerGeneration.js (?worker; resolve dual-mode)
│   │   │   ├── ChunkBinaryCodec.js  ← js/world/chunkBinaryCodec.js
│   │   │   ├── BiomeSystem.js       ← js/world/biomeSystem.js (drop fbm2/applySpline aliases)
│   │   │   ├── Noise.js             ← js/world/noise.js (canonical fbm2/applySpline)
│   │   │   ├── BlockRegistry.js     ← js/world/blockRegistry.js (keep manifest regex compatible)
│   │   │   ├── ChunkData.js         ← js/world/chunkData.js
│   │   │   ├── Persistence.js       ← js/world/persistence.js
│   │   │   └── SpawnManager.js      ← js/world/spawnManager.js
│   │   ├── audio/                              # ← MISSING ENTIRELY FROM v1
│   │   │   ├── AmbientAudio.js      ← js/audio/ambient.js (1170)
│   │   │   └── SFX.js               ← js/audio/sfx.js (621)
│   │   └── input/{InputManager.js, Keyboard.js, Mouse.js, Touch.js}
│   ├── game/
│   │   ├── data/
│   │   │   ├── ItemDefinitions.js   ← NAMED_ITEMS, ITEM_CATEGORIES, MAX_STACKS
│   │   │   ├── BossDefinitions.js   ← BOSS_DEFINITIONS from js/entities/boss.js
│   │   │   ├── BossAttacks.js       ← BOSS_ATTACKS from js/systems/damageSystem.js
│   │   │   └── FaceTable.js         ← single source for meshWorker + ChunkMeshBuilder
│   │   ├── entities/
│   │   │   ├── Player.js            ← js/entities/player.js
│   │   │   ├── Boss.js             ← js/entities/boss.js (1152)
│   │   │   ├── QuestMarker.js       ← js/entities/questMarker.js
│   │   │   ├── CharacterManager.js  ← RECONCILE: js/entities/characterManager.js vs main.js:69
│   │   │   └── WorldManager.js      ← RECONCILE: js/entities/worldManager.js vs main.js:428
│   │   ├── systems/
│   │   │   ├── System.js            # abstract base
│   │   │   ├── InventorySystem.js   ← js/systems/inventory.js (slots/stacking/serialize)
│   │   │   ├── EquipmentSystem.js   ← equipment half of inventory.js
│   │   │   ├── CraftingSystem.js    ← js/systems/crafting.js
│   │   │   ├── SurvivalSystem.js    ← js/systems/survival.js (1160)
│   │   │   ├── DamageSystem.js      ← js/systems/damageSystem.js
│   │   │   ├── QuestSystem.js       ← js/systems/quests.js
│   │   │   ├── DroppedItemsSystem.js ← js/systems/droppedItems.js
│   │   │   ├── BlockInteractionSystem.js ← js/input/interaction.js (589)
│   │   │   ├── MobSystem.js         ← wraps js/mobs/mobIntegration.js
│   │   │   └── TimeOfDaySystem.js   ← day/night cycle extracted from skybox.js
│   │   └── mobs/                    ← js/mobs/* (18 files, structure unchanged)
│   ├── multiplayer/
│   │   ├── SessionManager.js  ← main.js:1723 (inline class) + rejoin panel + conn status
│   │   ├── Client.js          ← js/multiplayer/client.js
│   │   ├── Host.js            ← js/multiplayer/host.js (import MESSAGE_TYPES explicitly!)
│   │   ├── PlayerSync.js      ← js/multiplayer/playerSync.js
│   │   ├── ChunkStreamer.js   ← js/multiplayer/chunkStreamer.js
│   │   ├── InventorySync.js   ← js/multiplayer/inventorySync.js
│   │   └── PlayerListHUD.js   ← js/multiplayer/playerListHUD.js
│   ├── ui/
│   │   ├── UIManager.js       # screen routing + modal management
│   │   ├── screens/{MainMenu,Character,World,Mode,Lobby,Settings,Loading}Screen.js
│   │   ├── hud/{HUD,Hotbar,SurvivalMeters,Crosshair,QuestTracker,FlyModeIndicator,ConnectionHUD,DebugStats}.js
│   │   ├── overlays/{InventoryScreen,CraftingScreen,PauseMenu,EquipmentPanel}.js
│   │   ├── components/{Button,Modal,Slider}.js
│   │   └── css/               # split from css/style.css (see §10.2)
│   └── util/
│       ├── Logger.js          ← js/util/logger.js
│       ├── MathUtils.js       ← canonical smoothstep, distanceBetween
│       ├── HTMLUtils.js       ← escapeHtml
│       └── StorageHelper.js   ← 'cuubz_last_session' / 'cuubz:settings' access
├── shared/
│   └── protocol.js            # MESSAGE_TYPES — single source for src/ AND server/
├── server/                    # UNCHANGED (CommonJS, already clean)
├── test/{helpers,unit,integration}/
├── scripts/generate-manifest.js   # keep regex-compatible with BLOCK_REGISTRY
├── .github/workflows/ci.yml
├── vite.config.js
├── eslint.config.js           # FLAT config — ESLint 9+ (NOT .eslintrc.cjs)
├── .prettierrc
├── sync.sh                    # REWRITTEN: build, then ship dist/ (+ rollback — DEPLOY.md §6.4)
├── cuubz-relay.service        # verify WorkingDirectory after layout change
└── DEPLOY.md                  # deploy + rollback + data invariants (PR 6) — update in PR 10
```

### 4.2 Key Patterns

**EventBus (pub/sub)** — replaces direct cross-module calls and inline `if (sessionManager && ...)` chains:

```js
EventBus.emit('block:broken', { x, y, z, blockType });
EventBus.on('block:broken', ({ x, y, z }) => chunkManager.applyBlockChange(x, y, z, 0));
EventBus.on('block:broken', ({ x, y, z }) => multiplayerClient.sendBlockBreak(x, y, z));
```

**System interface** — every system is uniform, so `SystemRunner` needs no special cases:

```js
export class System {
  static priority = 100;   // lower runs earlier
  init(game) { this.game = game; }
  update(dt) {}
  dispose() {}
}
```

**GameState** — single source of truth, and the landing zone for the hoisted closure locals:

```js
export class GameState {
  mode = 'survival';        // 'survival' | 'creative'
  isRunning = false;
  isPaused = false;
  frameCount = 0;
  player = null;
  currentWorld = null;
  currentCharacter = null;
  systems = new Map();
  stats = { fps: 0, activeChunks: 0, dirtyCount: 0 };
}
```

**Vite** — `index.html` → `<script type="module" src="/src/index.js">`; no script ordering, no `window.*`, no `typeof X !== 'undefined'`; HMR in dev; hashed bundle in `dist/`.

---

## 5. Phase 0 — Stop The Bleeding (PR 1–6, plus 6b)

> **Nothing else in this document is safe until Phase 0 lands.** v1 had no equivalent phase.

### PR 1 — Commit everything, tag a rollback point ✅ DONE
- `git add js/mobs/ MOB_PLAN.md refactor.md textures/items/*.png` and the 16 modified tracked files.
- Commit with a message naming the mob subsystem as work-in-progress.
- `git tag pre-refactor-baseline` and push the tag.
- **Decide and record here:** finish mobs, or explicitly park them (freeze `js/mobs/` and `MOB_PLAN.md`) until Phase 4. Refactoring on top of 253 unchecked plan items is a moving target.
- **Accept:** `git status` clean. Tag exists on the remote.
- **Rollback:** n/a (this *is* the rollback point).

**Outcome (2026-07-29):**
- Working tree was already clean; `js/mobs/` (18 files) and `MOB_PLAN.md` are tracked as of commit `27959d3`.
- Tag `pre-refactor-baseline` created locally at `27959d3`. **Push it manually** — the automation environment has no git credentials: `git push origin pre-refactor-baseline`.
- **Decision: mobs are PARKED.** `js/mobs/` and `MOB_PLAN.md` are frozen — no new mob features until PR 25. The 253 unchecked `MOB_PLAN.md` items are explicitly out of scope for Phases 0–4. Mob files still get migrated mechanically in PR 9 (`js/mobs/` → `src/game/mobs/`) but their *behavior* does not change. Rationale: a half-built subsystem that is still growing cannot serve as a parity baseline.

### PR 2 — Fix the 3 crash-on-require exports ✅ DONE
- `js/systems/crafting.js` — `BLOCK_TYPES is not defined`
- `js/systems/damageSystem.js` — `DAMAGE_SOURCES is not defined`
- `js/entities/worldManager.js:462` — `MIN_NAME_LENGTH is not defined`
- Minimal fix: guard the `module.exports` object, or (better) define the constants locally in the file that exports them.
- **Accept:** `node -e "require('./js/systems/crafting.js')"` and the other two exit 0. Browser still loads and plays.
- **Rollback:** revert commit; 3 files only.

**Outcome (2026-07-29):**
- Used the **existing in-repo shim pattern** from `js/world/biomeSystem.js:7-9` rather than defining the constants locally. Defining them locally would have created *new* duplicate top-level symbols (`BLOCK_TYPES`, `DAMAGE_SOURCES`, `MIN_NAME_LENGTH` are all already declared elsewhere) — i.e. it would have manufactured exactly the collision class PR 3 exists to eliminate. The shim is a no-op in the browser (`typeof module !== 'undefined'` is false there), so browser behavior is unchanged byte-for-byte.
  - `crafting.js` → `require('../world/blockRegistry').BLOCK_TYPES`
  - `damageSystem.js` → `require('./survival').DAMAGE_SOURCES`
  - `worldManager.js` → `require('./characterManager')` for `MIN_NAME_LENGTH` / `MAX_NAME_LENGTH`
- `characterManager.js` had to **add `MIN_NAME_LENGTH` / `MAX_NAME_LENGTH` to its `module.exports`** — it declared them but never exported them.
- Verified: all four files `require` with exit 0. No circular requires introduced.
- **Suite went 17/53 → 22/53.**

### PR 3 — Fix the 8 global collisions, with regression tests
For each, rename or consolidate, and **add a test that would have caught the bug**:

| Fix | Test to add |
|---|---|
| `getBossDefinition` → `getBossDefinition` (boss) / `getBossAttackProfile` (damageSystem) | `new Boss('<validId>')` constructs without throwing |
| `validateInventory` → `validateHostInventory` (host) / `validateInventorySlots` (inventorySync) | host accepts a well-formed client inventory sync; rejects a malformed one with a defined `.reason` |
| `isMobileViewport` → single canonical impl in `util/MathUtils.js` or a `viewport.js`; **pick one threshold and document it** | breakpoint assertion at 599/600/601/767/768/769 |
| `smoothstep` → one impl (`util/MathUtils.js`) | — |
| `distanceBetween` → one impl (`util/MathUtils.js`) | — |
| `fbm2`, `applySpline` → keep in `noise.js`, delete the `biomeSystem.js` aliases | existing noise tests must still pass |
| `_log` ×3 → per-module prefixed loggers via `util/Logger.js` | — |

- **Note in the changelog that behavior intentionally changes here:** boss spawning starts working, host inventory sync starts working, and the mobile breakpoint moves. Doing this in Phase 0 keeps Phase 1's "no behavior change" claim honest.
- **Accept:** the 3 new regression tests pass; no remaining duplicate top-level symbols (see the collision-detector script in PR 5).
- **Rollback:** revert commit.

**Outcome (2026-07-29):** ✅ DONE — `scripts/check-globals.js` now reports **0 duplicates** across 65 script-tagged files / 367 top-level symbols. `test/test_globalCollisions.js` added: **93 assertions, all passing.**

| Collision | Resolution |
|---|---|
| `getBossDefinition` | `damageSystem.js`'s copy renamed → **`getBossAttackProfile`**. `boss.js` keeps `getBossDefinition`. Test asserts the two key namespaces are disjoint, each lookup resolves only its own table, **and that `new Boss(id)` constructs for all 5 boss ids** (it previously always threw). |
| `validateInventory` | `host.js` → **`validateHostInventory`**; `inventorySync.js` → **`validateInventorySlots`**. Test asserts the host accepts a well-formed sync and that every rejection carries a **defined** `.reason` string (host.js:934 logs it). |
| `isMobileViewport` | New **`js/util/viewport.js`** — one impl, two named breakpoints. Boundary assertions at 599/600/601/767/768/769. |
| `smoothstep` | Moved to new **`js/util/mathUtils.js`**; `skybox.js` + `ambient.js` re-export it. |
| `distanceBetween` | Moved to **`js/util/mathUtils.js`**; `boss.js` + `playerSync.js` re-export it. |
| `fbm2`, `applySpline` | `biomeSystem.js`'s aliases deleted; its call sites now use its own private `_fbm2` / `_applySpline`. |
| `_log` ×3 | → `_clientLog` / `_hostLog` / `_gameLog`. |

**Two things the plan did not anticipate:**

1. **A fourth `_log` consumer.** `js/input/interaction.js` called a bare `_log(...)` at two sites (block break, block place) **without ever declaring it** — it was silently borrowing whichever of the three colliding globals loaded last. Renaming the three would have made breaking or placing a block throw `ReferenceError` in production. It now declares its own `_interactionLog`. *This is a bug the plan's own §2.1 audit missed, because a file that only consumes a colliding global is invisible to a duplicate-declaration scan.*

2. **Deviation on `isMobileViewport`.** The plan said "pick one threshold and document it". Not followed, deliberately. The two thresholds are not accidental duplication — 768px answers "is this device weak enough to need reduced draw distance?" and 600px answers "is this screen narrow enough to collapse the player list?". Collapsing them to one number would silently change either perf tuning or HUD layout with no gameplay justification. `js/util/viewport.js` therefore provides **one implementation with two named, documented breakpoints** (`MOBILE_MAX_WIDTH_PERF = 767`, `MOBILE_MAX_WIDTH_HUD = 600`, compared with `<=`, exactly reproducing the old `< 768` and `<= 600`). The collision is gone; both behaviors are preserved. Rationale is written into the file header.

**Behavior that intentionally changed in the browser** (all previously broken):
- Boss spawning now works — `new Boss(...)` no longer throws `Unknown boss: ...`.
- Client→host inventory sync is now actually validated instead of always rejected, and the warning log no longer reads `undefined`.
- Mobile **performance** tuning now applies below 768px as intended, not 600px. The player-list HUD still collapses at 600px, unchanged.

**New files:** `js/util/mathUtils.js`, `js/util/viewport.js` (both script-tagged in `index.html` immediately after `logger.js`, before every consumer), `scripts/check-globals.js`, `test/test_globalCollisions.js`.

**Regression check:** suite went 22/53 → 23/54. The 31 pre-existing failures are unchanged — no test that passed before PR 3 fails after it.

### PR 4 — Get the suite green, or quarantine explicitly ✅ DONE

- `npm i -D jsdom` (fixes `test_pageLoad`).
- Fix the real assertion failures. Start with `test_skybox` (fog density 0.008 vs 0.001 — **decide which is correct** and fix the code or the test, not whichever is easier) and `test_responsiveHUD` (26 failures).
- For anything that can't be fixed now, add `test/QUARANTINE.md` listing the file, the failure, why it's deferred, and the PR that will fix it. The runner must **skip quarantined files and exit 0**.
- Fix `package.json`: `"test": "bash test/run_tests.sh"`.
- Add a smoke test for `scripts/generate-manifest.js` (guards the eval-regex).
- **Accept:** `npm test` exits 0. Quarantine list is ≤5 files and every entry has an owner PR.
- **Rollback:** revert; Phase 1 is blocked until this lands.

**Outcome (2026-07-29):**

**Suite went 17/53 → 50/50 passing, 4 quarantined. `npm test` exits 0.** `scripts/check-globals.js` still reports 0 duplicates across 65 script-tagged files.

**Six genuine code bugs found and fixed.** Per the "the code is right, the test is stale" ruling, most failures were stale assertions — but that ruling only covered the value mismatches verified against git history. Everything else was investigated, and these turned out to be real:

1. **Block drops were resolved from a stale ID table** (`js/systems/inventory.js`, `js/input/interaction.js`). `_getBlockProperties` read `window.BLOCK_PROPERTIES`, but `blockRegistry.js` declares `BLOCK_PROPERTIES` as a top-level `const` in a classic script — a lexical global that is **never** a property of `window`. So the lookup was always `undefined` in the browser and silently fell through to `_INLINE_BLOCK_PROPERTIES`, a hand-maintained table keyed by **pre-renumbering** IDs. Player-visible effect: breaking andesite dropped cobblestone, breaking deepslate dropped coal. Fixed by moving drop resolution into `blockRegistry.getBlockDrop()`, keyed by block **name**, and deleting the stale table. Verified all 192 blocks resolve to a valid drop.

2. **Duplicate block ID in the registry** — `yellow_poplar_leaves` and `white_concrete` both claimed id `115`, so the leaves block was silently shadowed (`BLOCK_BY_ID` is built by iteration; the later entry wins). `BLOCK_TYPES.YELLOW_POPLAR_LEAVES === BLOCK_TYPES.WHITE_CONCRETE`. Moved the leaves to id `192` (the first free id) rather than shifting the 32 concrete/wool blocks, which would have reinterpreted every saved chunk. Caught by the new manifest smoke test, not by a pre-existing test.

3. **Creative palette used hard-coded pre-renumbering IDs** (`js/game.js`). `selectedBlock = 3` with a comment reading "Stone (ID=3)" — stone is now `2`, so creative mode silently defaulted to cobblestone. The `_getPlaceableBlocks` exclude set was likewise a literal id list, so it excluded granite/deepslate/ores while **admitting** water, lava, toxic slime and the quest items into the palette. Both now resolve by name. Same stale `3` default fixed in `interaction.js`.

4. **The require shims were order-dependent** (`chunkData.js`, `inventory.js`, `interaction.js`). Each guarded its whole block on `typeof BLOCK_TYPES === 'undefined'` while providing a *different* subset of symbols. Whichever module loaded first satisfied the guard for the rest, so e.g. requiring `interaction.js` before `chunkData.js` left `BLOCK_BY_ID` undefined and crashed on require. Each symbol is now guarded individually.

5. **`isMatchmakingConnected` / `isGameSessionConnected` returned `null`, not `false`** (`js/multiplayer/client.js`) when no connection object existed — contradicting the `is*` naming, and breaking strict comparison and JSON serialization. Coerced with `!!`. Every caller uses them for truthiness, so behaviour is unchanged.

6. **`test_websocketErrorHandling` would have hung the suite.** It only called `process.exit` on *failure*; passing fell off the end of the file with mock reconnect/heartbeat timers still pending, so Node never exited. Invisible while the file was red — it would have deadlocked `npm test` the moment it went green. Now exits explicitly in both directions.

(The `sfx` seeding bug fixed earlier in this PR makes seven in total.)

**Two handoff diagnoses were wrong, in the safe direction:**
- `test_creativeMode` was the **reverse** of the §3a table — the test correctly used `BLOCK_TYPES.STONE`; the *code* was stale. Fixed the code (bug 3 above).
- `test_questMarker` / `test_questIntegration` were **not** "inverted expectations". That harness's `assertEquals(actual, expected)` takes the literal in the *actual* slot, so "expected 0, got 25" actually meant `createAllMarkers()` returned **0**. Root cause: `questMarker.js` was missing a `QUEST_REGISTRY` require shim, so it silently produced no markers under Node. Browser was unaffected.

**Rewritten rather than patched** (the old APIs no longer exist; assertions were rewritten against the real surface, not invented to match):
- `test_biomeEffects` — targeted a `ParticleEffect` class plus `LAVA_ANIMATION` / `TOXIC_SLIME_ANIMATION` / `CORRUPT_FOG` and UV-offset state. `biomeEffects.js` exports only `{ BiomeEffects }` and none of those exist even as module-locals. Now covers biome fog/sky config, day/night blending, the particle pool, distance culling, the 200-particle cap and disposal. 136 assertions.
- `test_blockInteraction` — the Crosshair half still passes and was kept; the BlockInteraction half targeted `breakTarget`/`breakDuration`/`onBlockBreak`. Rewritten against `breakingBlock`/`breakProgress`/`_startBreak`/`_continueBreak`/`_completeBreak`, including tool efficiency, creative-mode placement and the mob-attack override. 137 assertions.
- `test_crafting` — the grid-based half (`craftingGrid`, `findMatchingRecipe`, `craft()`) is gone; crafting is inventory-driven via `getCraftableRecipes(inventory)` / `craftRecipe(id, inventory)`. 498 assertions.
- `test_noise` — asserted `NoiseGenerator.perm.length === 512`, now private to `createPerlin`. Replaced with the observable property that table exists for: the field is periodic with period 256 per axis.

**Harness bugs fixed** (not product bugs): `test_sessionDiscovery` built its own relay and dropped `sessionName`/`worldSeed`/`mode` when constructing `SessionManager`, so every name assertion failed against an `'Untitled'` fallback — the production path was intact throughout. `test_hostLogic` constructed a player and instantly moved it 2.2 blocks; with `dt` floored at 16ms that reads as ~140 blocks/s and the speed anti-cheat correctly rejected it — the test now backdates `lastMoveTime`.

**Deleted:** `test_textureGenerator.js` (asserted `scripts/generate_textures.py`, which no longer exists).

**New files:** `test/QUARANTINE.md`, `test/test_manifestGenerator.js`.

**Quarantined — 4 files, all owned by PR 26:** `test_pageLoad`, `test_responsiveHUD`, `test_mobileViewports`, `test_textureAssets`. All four `readFileSync` + regex over `index.html` / `css/style.css` rather than exercising behaviour; §3.6 has PR 26 rewriting them in the same PR that changes the markup, so fixing them now guarantees rework. `run_tests.sh` parses the **first column of the table** in `QUARANTINE.md` (matching any `test_*.js` anywhere in that file wrongly skipped three passing tests that the prose merely mentions) and reports them as `⏭️ SKIP` so they stay visible.

**The manifest smoke test** runs `scripts/generate-manifest.js` and cross-checks the entry count against a real `require()` of the block registry — that is the load-bearing assertion, because the script *scrapes* the registry with `eval('(' + match(/const BLOCK_REGISTRY = (\[.*?\]);/s)[1] + ')')`. A truncated parse still writes syntactically valid JSON, just missing most blocks. It snapshots and restores `textures/blocks/manifest.json` so the suite never dirties the tree. This test found bug 2 on its first run.

**Left alone deliberately:** `SurvivalSystem`'s default spawn is `{x:0, y:20, z:0}` while `SpawnManager` uses `SEA_LEVEL + 4` (68) — y=20 is 44 blocks underground. `SurvivalSystem.onDeath`/`onRespawn` are not wired to anything in production, so this is latent, not live. Changing a gameplay value is out of scope for a test-gate PR; flagged for a decision.

### PR 5 — Add CI
`.github/workflows/ci.yml`, on every push and PR:
```
node 22 · npm ci · npm test · npm run lint · npm run build (once Phase 1 lands)
```
Also add `scripts/check-globals.js` — parse the `<script src>` list from `index.html`, collect top-level `const|let|var|function|class` declarations, **fail on any duplicate**. This is what caught the 8 collisions; make it permanent so they can't come back during migration.

- **Accept:** CI green on a PR. `check-globals.js` fails when a duplicate is deliberately introduced.
- **Rollback:** delete the workflow.

**Outcome (2026-07-29):** ✅ DONE (one half of the accept criterion is pending a push — see *Not yet proven* below).

`.github/workflows/ci.yml` — one job, `ubuntu-latest`, on `push` and `pull_request`: `actions/checkout@v4` → `actions/setup-node@v4` (node 22, npm cache) → `npm ci` → `npm test` → `npm run check-globals`. `scripts/check-globals.js` already existed (PR 3); PR 5 only makes it a standing gate.

**`npm run lint` and `npm run build` are deliberately NOT steps.** Neither script exists in `package.json`. `npm run <missing-script>` exits 1, so adding them now makes CI red on its first run; adding them with `|| true` makes a gate that reports success without checking anything, which is worse than not having it. They are recorded as comments in the workflow naming the PR that adds each — **`npm run build` → PR 7** (Vite skeleton), **`npm run lint` → PR 11** (ESLint 9 flat config + Prettier). Each of those PRs adds its step in the same commit that adds its script.

**Four things the workflow does that the plan text did not ask for**, each because leaving it out has a concrete cost:
- **`timeout-minutes: 10`.** The suite runs in ~18 s but stands up real WebSocket servers and has no per-test timeout of its own. PR 4 bug 6 was a test that hung after passing; without this, the next one burns the 6-hour default.
- **`concurrency` + `cancel-in-progress`.** A newer push to the same ref supersedes the run in flight.
- **Full checkout — do not sparse-checkout `textures/` to save the 118 MB.** `test_manifestGenerator` runs `scripts/generate-manifest.js`, which `readdirSync()`s `textures/blocks/` (897 diffuse PNGs). That is the test that found PR 4's duplicate block id.
- **Explicit `shell: bash`** on both script steps. It is already the `ubuntu-latest` default; stating it keeps the requirement visible if the runner image ever changes.

**Verified without pushing.** The workflow has to be executed by GitHub, but everything inside it was reproduced locally: a fresh `git clone --depth 1` of `HEAD` into a scratch directory, then `npm ci` → `npm test` → `npm run check-globals` under **Node 22.22.0** (local dev is Node 24.18.0). Result: `npm ci` clean, **50/50 passing / 4 quarantined / exit 0**, **0 duplicates across 65 script-tagged files / 368 top-level symbols**, and `git status` clean afterwards — the manifest smoke test restores its snapshot correctly.

**Node 22 satisfies `jsdom`'s floor, but only just.** `jsdom@30.0.1` declares `engines: node ^22.22.2 || ^24.15.0 || >=26.0.0`. `node-version: '22'` resolves to the latest 22.x (22.23.2), which satisfies it; **pinning an exact older 22.x patch would emit `EBADENGINE`** (22.22.0 does). Noted in the workflow. `jsdom` is required only by `test_pageLoad`, which is quarantined, so it is not actually exercised in CI until PR 26 unquarantines it.

**Portability audit — the runner is a bash script, and the concern was that it only works in Windows Git Bash.** It does not; the toolchain is the same one, not merely a compatible one:
- **Line endings.** `core.autocrlf=true` normalizes on commit, and **zero tracked text blobs in `HEAD` contain a CR byte** (checked every tracked file, not just the shell scripts). A Linux checkout gets LF, so `bad interpreter: /bin/bash^M` cannot happen. There is no `.gitattributes`, and none is needed for this.
- **`grep -E` / `sed -E` / `sort -u` / `echo -e` / `local`.** Git Bash ships GNU coreutils and bash 5, exactly as `ubuntu-latest` does — `sed -E` is GNU `sed` in both. No BSD `sed` is in the picture on either side. `package.json` invokes `bash test/run_tests.sh` explicitly, so the `100755` mode bit is not load-bearing either.
- **Case sensitivity** (the risk that only shows up off NTFS), four sweeps, **0 mismatches**: the 65 `<script src>` and `<link href>` paths in `index.html`; **105 relative `require()` calls across 125 JS files**; 49 path-shaped string literals in `test/` + `scripts/`; and the texture pipeline — 92 named item textures in `itemTextureAtlas.js`, plus all 192 registry block textures, which the generator itself resolves through a case-sensitive `Set` lookup rather than `existsSync`, so it reports `✓ All registry textures found` identically on both platforms. Also **0 case-only duplicate paths** in the index (two such files can coexist on ext4 but not NTFS).
- **No platform coupling anywhere in Node-executed code**: no `process.platform` / `win32` branch, no `os.tmpdir` / `homedir` / `EOL`, no `toLocaleString` / `getTimezoneOffset` / `Intl` (CI runs UTC), no `os.cpus` / `availableParallelism` — the only concurrency probe is `navigator.hardwareConcurrency` in `chunkmanager.js`, which is browser-only.
- **`readdir` ordering.** ext4 returns directory entries in arbitrary order; NTFS does not. `generate-manifest.js` iterates `BLOCK_REGISTRY`, not `readdirSync`, so manifest order is registry-determined, and the smoke test asserts counts and shapes rather than bytes. Order cannot change the outcome.

**Both halves of the `check-globals` acceptance proof, run as the exact CI step** (`npm run check-globals`), then reverted:

| Injected collision | Result |
|---|---|
| `const SEA_LEVEL = 64;` appended to `js/util/mathUtils.js` (already owned by `chunkData.js:29`) | **exit 1** — `SEA_LEVEL: const at js/util/mathUtils.js:74 ← shadowed / const at js/world/chunkData.js:29 ← WINS (loads last)` |
| `function distanceBetween(a, b)` appended to `js/world/chunkData.js` (already owned by `mathUtils.js:38`) | **exit 1** — same report, correct load-order attribution |

The second shape matters because all three PR 3 collisions (`getBossDefinition`, `validateInventory`, `_log`) were **functions**, not `const`s. Both reverted with `git checkout --`; `git diff HEAD` empty and the gate back to exit 0.

**No code bugs found in this PR, and that is the finding.** For a CI PR the bug surface is portability — code that works on the author's machine and breaks on the runner — and the audit above came up empty across all six categories. Contrast PR 4, which found seven. Nothing was weakened to get here: no test was touched, `QUARANTINE.md` still holds 4 files against its cap of 5, and all four are still owned by PR 26.

**Flagged, not fixed** (both are out of scope for a CI PR, and neither fails silently):
- **The four relay tests call `http.listen()` on a fixed port with no `'error'` handler** — `test_serverIntegration` 18765, `test_multiplayerSync` 18770, `test_maxPlayerAndDisconnect` 18780, `test_sessionDiscovery` 18790. All four are free on a fresh runner and the tests run sequentially in separate processes, so this is fine in practice; but if one is ever occupied, the test dies on an unhandled `EADDRINUSE` and CI goes red with a misleading message instead of a clear one. Worth an `on('error')` for whoever next touches those files.
- **`on: push` with no branch filter plus `on: pull_request` double-runs a same-repo PR branch.** Kept literal to the plan ("on every push and PR"); `push: branches: [main]` is the one-line fix if the duplicate runs become annoying.

**Both halves of the accept criterion are now proven.** `actionlint 1.7.7` validated the workflow clean before it ever ran (schema, expression syntax, and `shellcheck` over the `run:` blocks). PR 1–5 were then pushed as branch **`refactor/phase-0`**, and the `push` trigger produced a **green run in 22 s** — [run 30494532166](https://github.com/Squall009/webgame-cuubz/actions/runs/30494532166). The portability audit held on the real runner:

```
Results: 50/50 passed, 0 failed, 4 skipped
⏭️  SKIP — test_mobileViewports / test_pageLoad / test_responsiveHUD / test_textureAssets
Scanned 65 script-tagged files from index.html
Found 368 unique top-level symbols
shell: /usr/bin/bash --noprofile --norc -e -o pipefail {0}
```

The four skips are the load-bearing detail: `run_tests.sh`'s `grep -E` + `sed -E` pass over the first column of the `QUARANTINE.md` table selected exactly the right four files under GNU sed on `ubuntu-latest`, which was the specific doubt about running a bash test runner authored in Windows Git Bash. `npm ci` installed 40 packages in 2 s with no `EBADENGINE`, confirming `node-version: '22'` resolved above `jsdom`'s 22.22.2 floor.

**The first real run found one defect in the workflow itself: `actions/checkout@v4` and `actions/setup-node@v4` target the deprecated Node 20 action runtime.** The runner forces them onto Node 24 and emits a warning annotation on every run; the shim is scheduled to go away, at which point this becomes a hard failure. Both are now pinned to the current latest major — **`checkout@v7`, `setup-node@v7`**. Every documented breaking change across v5/v6/v7 was checked against this workflow's actual usage and none applies: setup-node v5's automatic caching keys off a `packageManager` field that `package.json` does not have (and `cache: npm` is the explicit form), v6 only narrowed that same auto-detection, and checkout v7's fork-PR block only affects `pull_request_target` / `workflow_run`, neither of which is used. v5+ requires runner ≥ v2.327.1, which is noted in the workflow for the self-hosted case. Re-verified green after the bump.

**Still not pushed:** `main` itself (still at the PR 1 baseline `27959d3` on the remote — the six commits live only on `refactor/phase-0`) and the `pre-refactor-baseline` tag, which remains local. The **Phase 0 gate checkbox "CI runs on push" is satisfied in substance**; the gate list is left untouched because four of its seven items are still open and mixed ticking would obscure which.

### PR 6 — Write down the invariants ✅ DONE (one accept criterion deliberately unmet — see below)
Add to this file (or `DEPLOY.md`):
- The [§1.5](#15-player-data-must-survive-byte-for-byte) data-compatibility table, marked **do not change**.
- The full deployment plan: build → what gets tarred → what `sync.sh` excludes → how `cuubz-relay.service` is restarted → how to roll back a bad deploy.
- The manual save/load checklist run at every checkpoint.
- **Accept:** a fresh implementer can deploy and roll back from the doc alone.

**Outcome (2026-07-29):**

**Decision: standalone [`DEPLOY.md`](./DEPLOY.md), with §1.4 and §1.5 pointing at it.** The plan offered "this file (or `DEPLOY.md`)". Three reasons for the split, in order of weight:

1. **The accept criterion says "from the doc alone."** A deploy runbook nested inside an 84 KB refactor plan is not a standalone document — reaching it requires knowing that a *refactoring* plan contains *operational* instructions. `DEPLOY.md` sits beside `README.md` where a fresh implementer looks.
2. **The lifetimes differ.** `refactor.md` is transitional and gets archived when Phase 6 completes. The deploy path, the data invariants and the save/load checklist are permanent operational facts that outlive the refactor entirely. Putting them in a document scheduled for deletion is the wrong container.
3. **It is needed under pressure.** §6 is read during a broken deploy. 84 KB of migration planning between the reader and the rollback procedure is a real cost at exactly the wrong moment.

`DEPLOY.md` is 9 sections: short version → data invariants → topology → what `sync.sh` actually does → restarting the relay → rollback → save/load checklist → defect table with owners → verification status.

**The §1.5 table was incomplete. Six additions, two of them serious.** `DEPLOY.md` §2 supersedes it (§1.5 now says so). The four original rows are correct; found by reading every `localStorage` / `indexedDB` call site in `js/`:

| Added | Where | Why it matters |
|---|---|---|
| **`'cuubz:characters'`** | `js/world/persistence.js:20` | **every character the player has ever created.** Was entirely absent from §1.5 — the single most valuable key in the game. |
| `'cuubz:slotMap'`, `'cuubz:worldSlot:{N}:conf'` | `persistence.js:24,28` | world↔slot mapping and per-slot config; `MAX_WORLD_SLOTS = 3` is part of the key space |
| Object stores + key paths | `chunkmanager.js:23-24,273-275` | `chunks` (`keyPath: 'chunkKey'`), `manifests` (`keyPath: 'worldName'`), plus the non-unique `worldName` index |
| Chunk key format | `chunkmanager.js:455` | `` `${cx},${cz}` `` — see H-1 below |
| Chunk binary format | `chunkBinaryCodec.js:28-46` | magic `0x43555542` `"CUUB"`, version `3`, `LEGACY_LAYOUT_MAX = 2`, 20-byte header, height `256`, FNV-1a basis `0x811c9dc5` / prime `0x01000193`. Decode **throws** above version 3. |
| Block IDs are baked into saved chunks | `blockRegistry.js` | the format stores numeric IDs, not names. Renumbering reinterprets every chunk ever saved — PR 4 bug 2 already navigated this. |

**Two storage hazards found, both pre-existing, neither fixed here:**

- **H-1 — chunk keys are not world-scoped, so the three world slots overwrite each other's terrain. This is a live data-corruption bug.** `chunkKey` is only `` `${cx},${cz}` ``, and *no read path* filters on `worldName` — `loadChunk` (`chunkmanager.js:322-330`), `hasChunk` (`:332-340`) and `_batchLoadChunks` (`:857-880`) all do a bare `store.get(key)`. Writes set the `worldName` field and index it; nothing ever reads either. So chunk `(0,0)` is one shared record across all worlds: play world A at spawn, then world B at spawn, and B's chunk overwrites A's. Manifests *are* per-world, so world A's manifest still claims the chunk is generated — which is precisely what makes the stale record load instead of regenerating. `js/main.js:551` even contains the comment *"chunks remain orphaned but harmless — they're keyed by chunk coordinates"*: right premise, wrong conclusion. **Not fixed, deliberately** — the fix changes the primary key format, which is itself an invariant, so every already-saved chunk is orphaned without a migration. That is a data-migration PR with its own test plan, not a line in a docs PR. Currently **unowned**; needs a decision.
- **H-2 — bumping `DB_VERSION` destroys every player's worlds.** `onupgradeneeded` (`chunkmanager.js:264-276`) enumerates every existing object store, `deleteObjectStore`s all of them, then recreates them empty. Its comment describes this as "handles schema changes cleanly". §1.5 listed `version: 2` as a value to preserve without saying that incrementing that one character is unrecoverable total data loss. Now stated as a blocking warning.

(H-3, minor: `js/main.js:545` opens the DB with **no version argument** — creates a store-less v1 DB if none exists, then throws `NotFoundError` into a silent `catch {}`. Self-heals on the next `ChunkManager` open. Documented, not fixed.)

**The deployment reality is worse than §1.4 describes. Thirteen defects; §1.4 named one.** Full table with owners in `DEPLOY.md` §8. The ones that change how Phase 1 must be sequenced:

- **`sync.sh` never restarts the relay.** There is no `systemctl` / `service` / `pm2` call anywhere in the repo — the only such text is prose in `multiplayer.md:376`. So `server/` changes are deployed and **silently inert** until a human restarts by hand; the script prints `Sync complete!` either way. §1.4 does not mention this, and it is the most likely way to lose an afternoon.
- **`tar xzf` never deletes.** Files removed from the repo persist on the server forever. This is invisible today and concrete at PR 9: the stale `js/` tree stays live beside the new `src/`, `index.html` is overwritten to point at `src/`, and the host serves two full copies of the codebase — one dead, both fetchable, indistinguishable in a browser network tab. **PR 10's rewrite must handle deletion, not just the build.**
- **`node_modules` is excluded and nothing runs `npm ci` on the remote**, yet `server/index.js:14` and `server/matchmaking.js:21` both `require('ws')`. Production's `node_modules` was installed by hand at some point. Consequence: **dependency changes never reach production** — bump `ws` and the relay throws `Cannot find module` on its next restart.
- **The `chmod` is the fragile step.** `find /var/www/html -type f -exec chmod 644 {} +` runs over the *entire* web root, not the project. If any file there is not owned by `dadmin` it returns non-zero → the `&&` chain stops → `set -e` aborts — **after extraction already overwrote the live tree.** The error is about permissions and says nothing about the half-deployed site. This is the highest-value unverified check in the doc.
- **The archive is staged inside the public web root** (`/var/www/html/${PROJECT_NAME}.tar.gz`, `sync.sh:34`) and removed *only on success*. During every deploy — and permanently after a failed one — the complete source tree is downloadable at a predictable URL.
- **`ExecStart` hardcodes `/home/dadmin/.local/node-v22.22.0-linux-x64/bin/node`.** Production runs **22.22.0** from a hand-unpacked tarball; CI's `node-version: '22'` resolves **22.23.x**. Upgrading or moving that directory breaks the unit by path (`status=203/EXEC`, retried forever at 5 s). Note the skew has an edge: `jsdom@30`'s floor is `^22.22.2`, so production is *below* the version CI validates against — harmless (devDependency, quarantined test) but "green in CI" ≠ "runs on the relay host". **Not changed** — repointing the interpreter for the production relay is unverifiable without SSH.
- **`textures/` ships on every deploy.** Measured by reproducing `sync.sh`'s exact `tar` flags: **116,004,047 bytes compressed, 3,544 entries, of which only 171 are not textures.** No exclude, no content check.
- **`--exclude='dist'`** — the §1.4 landmine, noted and left for PR 10. Operational rule added to `DEPLOY.md`: **do not run `./sync.sh` between PR 7 and PR 10.**

**One code bug fixed: `sync.sh` did not exclude `.env`.** `.gitignore:2` lists it, so the project anticipates one existing locally, and `sync.sh`'s exclude list did not cover it — a local env file would have been tarred, extracted into a public web root, and `chmod 644`'d world-readable. No `.env` exists in the repo today, which is the only reason this was never a live leak; that also makes the fix provably non-regressive. One line, plus a comment naming the two `DEPLOY.md` sections. **Everything else was left alone on purpose:** PR 10 owns `sync.sh` and "must land with PR 9, not after", and every remaining defect is structural (release directories, deletion semantics, the build step, the staging path) — fixing them *is* the rewrite.

**Nothing was weakened.** No test touched, no assertion relaxed, no `QUARANTINE.md` change — still 4 files against the cap of 5, all owned by PR 26. `npm test` 50/50 + 4 quarantined, `check-globals` 0 duplicates / 65 files / 368 symbols, both exit 0 at this commit.

**Accept criterion, honestly: deploy ✅, rollback ❌ — and documentation cannot close it.**

> *"a fresh implementer can deploy and roll back from the doc alone"*

Deploying is fully documented, including the relay restart `sync.sh` omits. **Rolling back is not, because there is nothing to roll back to.** `tar xzf` extracts over the live tree; no backup is taken, no previous copy is kept, there are no versioned release directories, no symlink to flip, and the uploaded archive — the one artifact that could serve as a record — is deleted immediately after extraction. Once a deploy lands, the previous server state has ceased to exist.

`DEPLOY.md` §6.2 documents the best procedure that actually exists — re-deploy a known-good tag from a separate `git worktree`, with `npm test` / `check-globals` as the pre-flight gate — and states plainly that it is roll-*forward*-to-old-code with three gaps: deletions do not un-happen (§4.6), permissions and the relay's `node_modules` are not restored, and **it requires the known-good ref to be reachable**. Writing anything stronger would mean inventing machinery no line of this repo implements, which a fresh implementer would discover mid-incident. Two things close the gap, neither a documentation task:

- **Push `pre-refactor-baseline`** — still an open PR 1 criterion, and `git ls-remote --tags origin` confirms it is local-only. §6.2 has no target without it. This is now a *second*, independent reason to push it: not just a Phase 0 rollback point, but the only usable deploy-rollback target.
- **PR 10 must add a real rollback path** — versioned release directories plus an atomic symlink swap, or at minimum retaining the previous tree — in the same rewrite it already owns, and update `DEPLOY.md` §6 when it does.

**Not verified, and this is the doc's main weakness: `./sync.sh` was not run.** It needs SSH to `dadmin@10.0.30.160` with `~/.ssh/id_ed25519`, which this environment does not have. Everything about repo *contents* was verified by reading the cited file, and the payload measurement, the absence of `systemctl`, the absence of server-side filesystem writes, and the 5 s flush-timer wiring were verified by execution. Everything about the *remote host* is inference, marked `[UNVERIFIED]` inline and collected in `DEPLOY.md` §9 with the exact command that would confirm each — nine of them. Also unverified: **the save/load checklist was written from the code paths, not from a play session**, including its prediction that steps 8–9 fail on H-1. The doc says so and asks the first person to run it to correct the file.

**What serves `/var/www/html` is UNVERIFIED, not guessed.** Every `nginx` reference in the repo (`js/main.js:2112,2126`, `server/index.js:9`, `multiplayer.md:35,94,413`) describes nginx **only** as the TLS reverse proxy in front of the relay on 8765; `multiplayer.md:47` hedges the static server as `"(nginx / built-in)"`. There is no nginx config, no Apache config, and no static-server reference anywhere in the repo. Marked unverified with the command to settle it.

**One useful finding in the other direction: the relay is stateless and there is nothing on the server to back up.** `server/` performs no filesystem writes at all (verified across every `server/*.js`); sessions live in an in-memory `Map` and are disposed on shutdown. All player data is client-side. So a bad deploy can break the code that reads player data but cannot corrupt the data itself, and rebuilding the host from scratch loses nothing. That is what bounds the rollback gap above to *downtime* rather than *data loss* — worth stating, because it is the reason PR 6 can close with an unmet criterion rather than blocking Phase 1. The flip side: restarting the relay instantly destroys every in-flight multiplayer session.

**One unowned defect worth a decision (`DEPLOY.md` D-8):** `server/index.js:219-225` routes `uncaughtException` and `unhandledRejection` into the clean-shutdown path, which calls `process.exit(0)`. `Restart=on-failure` (`cuubz-relay.service:10`) does **not** restart on exit code 0 — so the relay stays down after an unhandled error, exactly the case the restart policy exists for. `Restart=always` or a non-zero exit code is the fix; both change production restart behavior, so neither belongs in a docs PR.

**New file:** `DEPLOY.md`. **Modified:** `sync.sh` (the `.env` exclude), `refactor.md` §1.4 / §1.5 / §4.1 (pointers to `DEPLOY.md`).

### PR 6b — Automate the save/load gate ✅ DONE
Not in the original plan. Added because PR 6 closed with `DEPLOY.md` §7 written but **never run**, and §9 said so: *"the save/load checklist was written from the code paths, not from a play session… The first person to run this checklist should confirm steps 8–9 fail as described and correct this document if they do not."* §7 is the parity baseline that Phase 1's "identical game, zero visual change" claim rests on, and a gate that depends on a human clicking around does not get run at every checkpoint.

- **Accept:** `DEPLOY.md` §7 runs as a script; H-1's prediction is either confirmed or the doc is corrected; nothing that cannot be driven is faked.
- **Rollback:** delete `test/e2e/` and the `test:e2e` script. Nothing else depends on it.

**Outcome (2026-07-29):** ✅ DONE. `npm run test:e2e` → **112 assertions, 0 failures, exit 0**, ~5 minutes. `npm test` (50/50 + 4 quarantined) and `check-globals` (0 duplicates / 65 files / 368 symbols) unchanged.

**The key design decision: build the harness around storage inspection, not input simulation.** That is what made this PR possible at all, and it follows from a hard limit worth stating precisely, because it is [§1.6](#16-renderloop-cannot-be-extracted-as-written) showing up somewhere new.

`page.evaluate` **can** reach all 368 top-level lexical symbols — `BLOCK_TYPES`, `ChunkManager`, `CHUNK_MAGIC`, `BLOCK_REGISTRY`, `PersistenceManager` — even though none of them are `window` properties. Same mechanism as [§2.4](#24-the-mechanism-is-implicit-globals-not-windows) and PR 4 bug 1: a top-level `const` in a classic `<script>` is a global lexical binding. Verified live: `typeof BLOCK_TYPES === 'object'`, `BLOCK_REGISTRY.length === 193`. So every registry, constant and codec is directly testable from the browser.

It **cannot** reach live game state. Exactly four things are on `window` — `CuubzGame` / `CuubzBlockPalette` (`game.js:282-283`), `MobIntegration` (`mobIntegration.js:125`), `CuubzLogger` (`logger.js:39`) — and all four are **classes, not instances**. The running `renderer` / `chunkManager` / `player` / `inventory` are among §1.6's ~184 closure locals inside `startGame()`'s `setTimeout`. So the harness can click and type but cannot say "place block 2 at (14,68,-3)" or read the player's position. **This is not fought, it is designed around, and it unblocks at PR 12–13** — which is now a second, independent argument for Phase 2 existing: it is the PR that makes the save/load gate fully automatable.

The consequence is the interesting part. **DEPLOY.md steps 8–9 need no block placement.** The naive reading of §7 is "build a shape in world A, visit world B, look at spawn" — which needs pointer lock, mouse-look and inventory, i.e. everything out of reach. But H-1 is a *storage* bug, so it is provable purely from storage: world B generating chunk `"0,0"` overwrites world A's record at the same key, so read that record's own `worldName` field and watch it carry world B's id while world A's manifest still lists the key as generated. No pointer lock, no mouse simulation, no screenshot diffing. Same for the binary format — decode a stored `ArrayBuffer` and assert magic and version straight from the bytes.

**H-1 REPRODUCES. The prediction PR 6 asked to be confirmed is confirmed, and it is worse than described.** World A seed `424242` slot 0, world B seed `999111` slot 1:

| Observation | Result |
|---|---|
| Chunk `"0,0"`'s own `worldName` after visiting B | world **B**'s id — B's record replaced A's at the same key |
| Re-entering world A and reading `"0,0"` | **byte-for-byte identical to world B's chunk** (`e78141dbf2aa11bb` both sides) |
| World A's original spawn chunk (`b7ae538ee784e765`) | **gone from the store entirely — unrecoverable** |
| World A's manifest | still lists `"0,0"` as generated, so A loads the stale record rather than regenerating |
| World A's manifest checksum for `"0,0"` | `3799605976`, but the bytes stored there checksum to `1653333176` |
| World A chunks destroyed by **one** visit to world B | **1,073 of 1,184** — world-scoped keys would have left 2,393 records; the store holds 1,320 |

Two findings the original write-up did not have:

1. **The blast radius is the entire overlapping region, ~90% of the world, not just spawn.** "Play world A, then world B at spawn, and B's chunk overwrites A's" understates it — the two worlds *are* one world everywhere their pre-generated regions overlap, which at `regionRadius: 16` is nearly all of both.
2. **The corruption is already detectable with data the game stores today.** `manifest.generatedChunks[].checksum` is the chunk header's own FNV-1a, read straight out of the encoded buffer at offset 16 (`chunkmanager.js:649`), so a manifest-vs-record checksum mismatch identifies a contaminated chunk exactly. Nothing compares them on load. **That is a cheap partial mitigation for whoever owns H-1** — verify on load, regenerate on mismatch — degrading corruption into regeneration without touching the key format. The primary-key migration is still the real fix; this is the thing that could ship first.

**So H-1 needs its own migration PR, and it now has an evidence base for one.** Still unowned.

**Four genuine bugs found. Three fixed, one left for its own PR.**

- **FIXED — `js/main.js:4865,4878` logged success milestones through `console.error`.** `=== AUTO-REJOIN COMPLETE ===` and `=== INIT COMPLETE ===`, so **every successful page load reported two console errors.** That pollutes error monitoring and made the harness's "zero console errors on a clean load" assertion impossible to write honestly. Now `console.info` — same visibility, correct severity, no behaviour change. **`js/util/logger.js` is correct and was left alone:** `CuubzLogger.log` is `console.log` gated on `DEBUG = false`, i.e. silent in production, which is exactly why someone reached for `console.error` to force visibility. The logger is not the bug; the severity was. With this fixed, "0 uncaught exceptions, 0 console errors, 0 missing assets on a clean load" is now literally true and asserted on every run.
- **FIXED — `DEPLOY.md` D-14: every "Exit to Menu" threw, leaving a blank page.** `js/main.js:4562` called `game.playerSync.reset()`. `PlayerSyncManager` has no `reset()` — that method belongs to `PingTracker` (`playerSync.js:103`; class boundaries at `:51`, `:125`, `:366`). `game.playerSync` is set whenever `sessionManager.client` exists, **which includes solo play** (`main.js:2612`), so this fired every time. The `TypeError` aborted `onExit` partway, skipping six cleanup steps (`playerListHUD.destroy`, `blockInteraction.dispose`, `firstPersonHand.dispose`, `droppedItems.clear`, `mobIntegration.destroy`, `_cleanupPauseMenu`) and — critically — `showScreen('mainMenu')` at `:4603`. Every screen stayed `hidden`: **a blank page, recoverable only by F5.** Almost certainly broken since `playerSync` was wired in, because nothing exercised the quit path. **Fixed by deleting the call**; `clearAll()` on the line above already disposes every remote-player mesh and clears the map (`playerSync.js:523-531`), so it was redundant as well as wrong. Fixed rather than merely flagged because it made **§7 step 7 unreachable** — one of the three steps the checklist says to stop the refactor over — and a gate that cannot run its own load-bearing step is not finished. Step 7 is now a real automated round trip, plus a guard that `onExit` returns to the menu, raises nothing, and leaves no in-game overlay visible.
- **FOUND, NOT FIXED — `DEPLOY.md` D-15: every saved chunk is exactly twice the size it needs to be.** `chunkBinaryCodec.js:63` sizes the buffer as `HEADER_SIZE + blockRuns.length * 4`, but `blockRuns` is a flat `Uint16Array` of `[id, count, id, count, …]`, so the run count is `blockRuns.length / 2` and the payload actually written is half the allocation. Measured on a real stored chunk: **24,156 bytes allocated, 12,088 used, 12,068 bytes of zeroes — 50.0% waste, ≈14 MB per world.** Not a corruption bug — `decode()` stops after `blockRunCount` runs and the checksum spans the whole data portion at both ends, so the padding is self-consistent, which is precisely why nobody noticed. It is pure waste: half the IndexedDB footprint and half the bytes written on every 5 s flush. Not fixed because shrinking the allocation changes the stored byte length and checksum of every future chunk, i.e. it is a `DEPLOY.md` §2.2 on-disk-format change and this PR is not allowed to touch `js/` beyond the log-severity fix. Backward compatible in principle (`decode` never consults buffer length), but it wants its own PR. **This bug is the direct payoff of asserting the header from real stored bytes rather than from the source constants** — a source-text test cannot see it.
- **FIXED — `DEPLOY.md` D-16: `#pause-pause-time` was inverted.** `index.html:477` was a checkbox labelled **"Pause Time of Day"**, `checked` by default, while `main.js:4693` sets `checked = !game.skybox.timePaused`. **So checked meant time was running:** ticking a box labelled "pause" un-paused it. Two possible fixes, and the choice is a product call rather than a refactor one, so it was escalated rather than picked: **relabel to "Day/Night Cycle"** (zero behaviour change — checked-by-default then correctly reads "cycle is on") or **invert the logic** (changes what the checked-by-default state *does*, i.e. every existing player's day/night cycle would start paused). **Relabelled**, on the decision. The harness now asserts the label, because a label that drifts back out of step with `main.js:4693` is exactly how this happened; asserting the actual `skybox.timePaused` value needs PR 12–13, since `game` is a closure local.

**Two defect-asserting blocks, and why that is a gate rather than an allowlist.** H-1 and D-15 are asserted *as defects* — the assertions pass because the bug is present, each headed `ASSERTING A KNOWN DEFECT` with the fix and the replacement assertion written next to it. This is not "allowlisting a bug to make a green run": a run goes red if a new failure appears **or** if a known failure stops reproducing, so fixing either turns the harness red on purpose and forces the assertion to be rewritten to what the fix makes true. The alternative — a harness that exits 1 from birth on pre-existing bugs — is the [§1.1](#11-there-is-no-green-baseline-the-suite-is-red-now) problem again, and PR 4 already paid to get out of it. **D-14 was a third such block and demonstrates the lifecycle**: it was asserted as a defect, then fixed in this same PR, and its block is now the real §7 step-7 round trip. Nothing was added to `QUARANTINE.md`; it still holds 4 files against its cap of 5, all owned by PR 26.

**Coverage: nine of fourteen steps automated, two explicitly not, and the harness says which on every run.** Steps 1, 2, 3, 5, 6, 7, 10, 11, 14 plus every `DEPLOY.md` §2 invariant. **Both load-bearing steps hold for terrain: chunk `"0,0"` is byte-for-byte identical with `savedAt` unchanged after a reload (step 6) *and* after a quit-to-menu with no reload (step 7)**, so the terrain was loaded from storage rather than regenerated. The two are not redundant — a reload throws the whole JS context away, so step 6 can pass while teardown leaks; step 7 keeps the context and exercises `onExit`, which is where D-14 lived. `#world-seed` (`index.html:154`) pins terrain, which is what makes a byte-equality assertion legitimate instead of a coin flip. The two remaining gaps are printed as `⚠️ UNVERIFIED` with what would close each, because a passing run must not imply more than it checked:

| Not verified | Why | What closes it |
|---|---|---|
| Step 4, and the placed-block half of steps 6/7 | pointer lock + mouse-look, and `blockInteraction` / `inventory` are §1.6 closure locals | **PR 12–13** |
| Steps 12–13 (multiplayer) | needs a relay, two contexts, **and** a guest placing a block | relay half works today; placement half waits for PR 12–13 |

Both gaps are the **same** blocker, which is the second independent argument for Phase 2: **PR 12–13 is what finishes this gate.**

**Toolchain, and why these choices.** `playwright-core`, **not** `playwright` — the latter's postinstall downloads ~300 MB of browsers; `playwright-core` is 14 MB and downloads nothing, driving the already-installed Edge (150.0.4078.105) via `chromium.launch({ channel: 'msedge' })`. **Headless WebGL works** with `['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-sandbox']`: `glRenderer` reports `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`, THREE loads, and `THREE.REVISION === 134` is asserted — so [§1.2](#12-pin-three0134-do-not-run-npm-install-three)'s pin is now checked against what the browser really loads, which PR 8 must preserve. `test/e2e/staticServer.js` is a ~90-line dependency-free static server rather than a dev server, so the harness stays independent of the thing PR 7 changes: a gate that depends on what it validates is not a gate.

**Two engineering details that were failures first.**
- **`waitForQuiesce`.** `#hud` loses `.hidden` (`main.js:3901`) long before `checkRegion(0,0)` finishes pre-generating its 33×33 region, so a snapshot taken a fixed few seconds after the HUD appears catches a partly-generated world. Comparing two such snapshots produced a false *"33 chunks appeared after a reload"* failure with nothing to do with persistence. Polling the chunk count until three consecutive reads agree is what lets the round-trip assertions compare **exact** counts instead of being weakened to inequalities. Weakening the assertion would have hidden the real property.
- **Console-error accounting has exactly two exclusions, and the count is itself asserted.** `/favicon.ico` (Chromium requests it unprompted; the repo has none — `staticServer.js` already excludes it from `missing` for the same reason) and the relay WebSocket to `cuubz-relay.thehomelabguy.com:8765`, which cannot connect because the harness runs no relay — tolerated *only* outside the load and world-entry phases, which must be clean. Every suppressed message is printed. `assertEquals(NOISE_RULES.length, 2, …)` means a third exclusion cannot be added quietly.

**Not in `npm test`, not in CI, deliberately — and recorded PR 5's way.** `ubuntu-latest` has no Edge, and a real Chromium download plus SwiftShader rasterisation turns a 26 s job into minutes. Following PR 5's idiom for `npm run build` / `npm run lint`, it is a **comment in `ci.yml` naming the earliest sensible owner (PR 10, which already rewrites the deploy path and would want a post-deploy smoke check)** rather than a step that fails or one wrapped in `|| true`. It is also invisible to `npm test`: `test/run_tests.sh:46` globs `test/test_*.js` — flat, non-recursive — so nothing under `test/e2e/` is collected. That is a safety property this PR depends on; the workflow comment says so, and nothing in here is named `test/test_e2e*.js`.

**Screenshots are a self-comparison baseline, and nothing more.** Six PNGs to `test/e2e/artifacts/` (gitignored), including `05-world-alpha-contaminated.png` and `06-exit-to-menu-blank.png`. **SwiftShader does not render identically to a GPU**, so these are comparable only to another SwiftShader run on the same Chromium. That is still the right regression gate for PR 9's "zero visual change" claim; it is **not** evidence that the game looks correct on real hardware. Stated in the file so a future reader does not over-trust them.

**Portability preserved.** PR 5's audit asserts no `os.tmpdir` / `homedir` / `platform` in Node-executed code; `saveLoad.js` and `staticServer.js` use only `__dirname`-relative paths and keep that property intact. The harness itself asserts §7 step 14: `git status --porcelain` is byte-identical before and after the run.

**Nothing was weakened.** No test touched, no assertion relaxed, no `QUARANTINE.md` change — 4 files against the cap of 5, all owned by PR 26. CI green.

**New files:** `test/e2e/saveLoad.js`, `test/e2e/staticServer.js`. **Modified:** `package.json` + `package-lock.json` (`playwright-core` devDependency, `test:e2e` script), `.gitignore` (`test/e2e/artifacts/`), `.github/workflows/ci.yml` (comment only), `js/main.js` (two `console.error` → `console.info`; one deleted line for D-14), `index.html` (the D-16 relabel), `DEPLOY.md` §2.4 / §7 / §8 / §9, `refactor.md` (this section).

**Three things left open, all needing a decision rather than work:** **H-1** (the migration PR — now with an evidence base and a cheap partial mitigation), **D-15** (the 2× chunk allocation — a §2.2 format change, so its own PR), and the §7 items that wait on PR 12–13. The Phase 0 gate checkboxes are still untouched; "Manual save/load test passes" is now *substantially* true — nine of fourteen steps automated and green, two blocked on Phase 2, H-1 confirmed as a pre-existing failure — but it is a judgement call whether a gate with a known live data-corruption bug counts as passed, and that call is not this PR's to make.

### Phase 0 gate — do not proceed until all are true
- [ ] `git status` clean; `pre-refactor-baseline` tag pushed
- [ ] All source files `require` without throwing
- [ ] `check-globals.js` reports 0 duplicates
- [ ] `npm test` exits 0 (green or documented quarantine)
- [ ] CI runs on push
- [ ] Deployment plan + data invariants written down
- [ ] Manual save/load test passes

---

## 6. Phase 1 — Vite + ES Modules (PR 7–11)

> **Deliverable:** identical game, ES modules, working build **and working deploy**. Zero visual change.

### PR 7 — Vite skeleton, no source changes
```bash
npm i -D vite
```
```js
// vite.config.js
import { defineConfig } from 'vite';
export default defineConfig({
  root: '.',
  publicDir: false,          // textures/ served from root; see §1.8 — do NOT copy 118 MB
  build: { outDir: 'dist', target: 'es2020' },
  server: { port: 3000 },
});
```
Add `dev` / `build` / `preview` scripts. **Do not touch `js/` yet.** Confirm `npm run dev` serves the existing script-tag site unchanged.
- **Accept:** `npm run dev` → game plays identically. `npm run build` succeeds.

### PR 8 — Pin Three.js at r134
```bash
npm i three@0.134.0 --save-exact
```
Keep `js/three.min.js` on disk until PR 9 flips imports. See [§1.2](#12-pin-threejs01340-do-not-run-npm-install-three).
- **Accept:** `package.json` shows `"three": "0.134.0"` (exact, no `^`).

### PR 9 — Convert `js/` → `src/` ES modules (mechanical, in dependency order)
For each file, in `index.html` script order (leaves first):
1. `git mv` to its [§4.1](#41-target-directory-structure) destination.
2. Add `export` to each externally-used symbol; add `import` for each consumed one.
3. Delete `window.X = X` (all 4) and the `typeof module !== 'undefined'` CommonJS shims (62) — tests will import ESM after PR 31; until then keep the shim **only** where a currently-passing test needs it, and list those files.
4. Delete the 29 genuine `typeof X !== 'undefined'` guards as their imports become explicit.

**Workers — must be in this PR** ([§1.3](#13-web-workers-are-fetchblob-and-will-break-under-vite)):
```js
// replace fetch + Blob + new Worker(blobURL)
const worker = new Worker(new URL('./meshWorker.js', import.meta.url), { type: 'module' });
```
- Decide and record: does `workerGeneration.js` keep its dual-mode `globalScope` IIFE and main-thread inline fallback, or is the fallback deleted? Do not leave it ambiguous.
- Fix `textureAtlas.js` relative fetches ([§1.8](#18-textures-118-mb-3370-files-already-in-git)).
- `host.js` must now **import** `MESSAGE_TYPES` (it never defined it — [§3.5](#35-protocol-duplication--v1-was-half-wrong)).
- `index.html`: 64 script tags → one `<script type="module" src="/src/index.js">`.

- **Accept:** `npm test` still exits 0. Game plays identically: solo, host, join, creative, pause, settings. **Worlds created before this PR still load** (manual save/load test). Chunk generation and meshing both still run in workers (check DevTools → Sources → Threads).
- **Rollback:** this is the biggest PR in the plan. If it must be split, split by directory (`util/` → `world/` → `renderer/` → `systems/` → `multiplayer/` → `ui/` → `main.js` last) with a working game after each.

### PR 10 — Fix deployment (**must land with PR 9, not after**)
- Rewrite `sync.sh`: run `npm run build`, then ship `dist/` + `server/` + `textures/` (**stop excluding `dist/`**).
- Decide whether `textures/` ships separately (118 MB per deploy is slow — consider rsync or a one-time upload).
- Verify `cuubz-relay.service`'s `WorkingDirectory=/var/www/html/server` still resolves; update the unit if the layout moved.
- Document the restart + rollback procedure.
- **Accept:** deploy to `10.0.30.160`, load the site in a browser, **JS actually loads**, multiplayer relay connects.
- **Rollback:** keep the old `sync.sh` as `sync-legacy.sh` for one release cycle.

### PR 11 — Lint + format
```bash
npm i -D eslint prettier
```
- **`eslint.config.js` (flat config)** — ESLint 9+ ignores `.eslintrc.cjs`. v1 got this wrong.
```js
export default [
  { files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 'latest', sourceType: 'module' },
    rules: { 'no-unused-vars': 'warn', 'no-undef': 'error' } },
];
```
- `.prettierrc`: `{ "semi": true, "singleQuote": true, "trailingComma": "es5", "printWidth": 120 }`
- Add `lint` / `format` scripts; wire `lint` into CI.
- **`no-undef` is the payoff:** with modules, every leftover implicit global becomes a lint error. Fix them; do not disable the rule.
- **Accept:** `npm run lint` exits 0. CI runs test + lint + build.

### Phase 1 gate
- [ ] `npm run dev`, `npm run build`, `npm test`, `npm run lint` all pass
- [ ] `three` pinned to exactly `0.134.0`; no visual change (compare screenshots against the tag)
- [ ] Both worker pools still run off-main-thread
- [ ] Deploy works end to end and serves real JS
- [ ] Pre-refactor worlds load; blocks persist across reload
- [ ] Multiplayer host + join + block sync verified with two browsers

---

## 7. Phase 2 — Hoist Closure State onto `Game` (PR 12–13)

> **Deliverable:** `renderLoop` reads state from an object, not from ~184 closure locals. **No files split yet.**
>
> This phase does not exist in v1. Without it, Phase 3 is impossible ([§1.6](#16-renderloop-cannot-be-extracted-as-written)).

### PR 12 — Introduce `GameState` and migrate the render-loop locals
- Create `src/core/GameState.js` (shape in [§4.2](#42-key-patterns)).
- Inside `startGame()`, create one `state` object and reassign the locals that `renderLoop` closes over onto it: `renderer, chunkManager, player, inventory, skybox, biomeEffects, blockInteraction, chunkStreamer, playerSync, droppedItems, firstPersonHand, itemAtlas`, + the rest.
- Rewrite `renderLoop` to read `state.x` everywhere. Keep it in the same file at this point.
- Fold the ad-hoc props in: `game.frameCount`, `game.attackCooldown`, `game._shadowMissingCount`, `game._noPbrCount`.
- **Accept:** `renderLoop`'s body references **no** function-scoped locals from `startGame` — verifiable by moving `renderLoop` to module top-level in the same file with only `state` passed in. Gameplay identical.

### PR 13 — Un-nest `startGame`
- Remove the `setTimeout(async () => { try { ... } })` wrapper; convert to a plain `async function` with real `await` and a top-level error handler.
- Dedent — ~1,845 lines currently sit at ≥10 spaces.
- Split the body into numbered private steps (still in `main.js`) matching the `Game.init()` order in [§8.4](#84-startgame--coregamejs-pr-17).
- **Accept:** max indentation in `main.js` under 8 spaces. Load-order-sensitive init still works (texture atlas before mesh build, chunk manager before player spawn).

---

## 8. Phase 3 — Decompose main.js (PR 14–19)

> **Deliverable:** `main.js` deleted, contents distributed. Feature parity.

### 8.1 PR 14 — Reconcile the duplicate managers (do this first)
Decide, per [§3.4](#34-duplicate-managers--decide-before-touching-them):
- **Option A (preferred):** make `main.js` use the tested `js/entities/characterManager.js` / `worldManager.js`, delete `BrowserCharacterManager` / `BrowserWorldManager`, port any browser-only behavior across.
- **Option B:** delete the untested standalone files **and their tests**, promote the `Browser*` classes.

Record the choice and the reason. Do not merge both silently.
- **Accept:** exactly one `CharacterManager` and one `WorldManager` in the tree, both covered by tests, character and world CRUD verified in the browser.

### 8.2 PR 15 — Extract the UI layer

| From `main.js` (grep the symbol) | Target |
|---|---|
| `screens` / `modals` / `sessionUI` objects, `showScreen()` | `src/ui/UIManager.js` |
| `renderCharacterSlots`, `createCharacterSlotElement`, `openCreateModal`, `openEditModal`, `closeCharModal` | `src/ui/screens/CharacterScreen.js` |
| `renderWorldSlots` (L606), `createWorldSlotElement`, `openCreateWorldModal`, `closeCreateWorldModal`, `openDeleteModal` | `src/ui/screens/WorldScreen.js` |
| Host lobby tabs, browse panel | `src/ui/screens/LobbyScreen.js` |
| Settings wiring | `src/ui/screens/SettingsScreen.js` |
| `initMenuNavigation` (L804) | `src/ui/UIManager.js` + per-screen handlers |
| `escapeHtml` | `src/util/HTMLUtils.js` |

Screen pattern:
```js
export class CharacterScreen {
  constructor(uiManager) {
    this.uiManager = uiManager;
    this.element = document.getElementById('character-screen'); // existing HTML for now
  }
  show() { this.element.classList.remove('hidden'); this.render(); }
  hide() { this.element.classList.add('hidden'); }
  render() { /* populate slots */ }
}
```
- **Accept:** menu → character → world → mode → game navigates correctly; all modals open/close; no screen file over 400 lines.

### 8.3 PR 16 — Extract `SessionManager`
`class SessionManager` (L1723), `REJOIN_STORAGE_KEY` (L1593), the rejoin panel, `updateConnectionStatus`, and the 5 `cuubz_last_session` write sites → `src/multiplayer/SessionManager.js`. Route localStorage through `src/util/StorageHelper.js`; **the key string does not change** ([§1.5](#15-player-data-must-survive-byte-for-byte)).
- **Accept:** host a session, close the tab, reopen → rejoin prompt appears and works.

### 8.4 PR 17 — `startGame()` → `src/core/Game.js`
`core/Game.js` is a **rewrite**; `js/game.js` (280 lines, stub) is absorbed or deleted, along with its `new CuubzGame()` call site (`main.js:2569`).

```js
class Game {
  async init(config) {
    // 1 hide screens / show loading      9 multiplayer (host or client)
    // 2 renderer                        10 first-person hand
    // 3 input                            11 mob system
    // 4 texture atlas                    12 inventory + systems
    // 5 PBR + shadows                    13 block interaction
    // 6 skybox                           14 HUD
    // 7 chunk manager                    15 start render loop
    // 8 player at spawn
  }
}
```
Each step is one private method or a system's `init()`. Preserve the existing ordering exactly — it is load-order sensitive.
- **Accept:** solo and multiplayer both start; saved spawn restore works; loading screen sequence unchanged.

### 8.5 PR 18 — `RenderLoop` + `SystemRunner`
```js
export class RenderLoop {
  constructor(game) { this.game = game; this.rafId = null; }
  start() {
    const loop = (t) => {
      this.rafId = requestAnimationFrame(loop);
      if (!this.game.state.isRunning) return;
      if (this.game.state.isPaused) { this.game.renderer.render(); return; }
      this.game.tick(t);
    };
    this.rafId = requestAnimationFrame(loop);
  }
  stop() { cancelAnimationFrame(this.rafId); }
}
```
```js
const SYSTEM_ORDER = ['inputManager','blockInteraction','player','mobSystem','droppedItems',
  'playerSync','chunkStreamer','skybox','biomeEffects','survivalSystem','questSystem','hud'];
```
> **Ordering is behavior.** Derive `SYSTEM_ORDER` from the actual call order in the current `renderLoop` body, not from this list. Verify against the pre-refactor code.
- **Accept:** the loop function is under 30 lines. Frame-rate and gameplay feel unchanged; check `updateDebugStats` FPS against the tag.

### 8.6 PR 19 — Pause menu, debug stats, bootstrap; delete `main.js`
- `setupPauseMenu` (L4428) → `src/ui/overlays/PauseMenu.js` (owns its own listener setup/teardown).
- `updateDebugStats` (L4394) → `src/ui/hud/DebugStats.js`.
- Mobile detection, auto-rejoin, `beforeunload`, init trigger → `src/index.js` + `SessionManager`.
- Delete `js/main.js`.
- **Accept:** `js/main.js` gone. `src/index.js` under 50 lines. Every extracted file under 400 lines. Escape → pause → resume/exit/settings all work.

### Phase 3 gate
- [ ] `main.js` deleted
- [ ] `src/index.js` < 50 lines; no extracted file > 400 lines
- [ ] Zero `typeof X !== 'undefined'` in `src/` (`no-undef` clean)
- [ ] Solo, host, join, creative, pause, settings, save/load all verified manually
- [ ] `npm test && npm run lint && npm run build` green; deploy verified

---

## 9. Phase 4 — Systems, EventBus, Split Monoliths (PR 20–25)

### PR 20 — `System` base class
`src/game/systems/System.js` per [§4.2](#42-key-patterns). Convert systems one at a time; `SystemRunner` drops its special cases.

### PR 21 — `EventBus`
```js
class EventBus {
  constructor() { this._listeners = new Map(); }
  on(event, cb) {
    if (!this._listeners.has(event)) this._listeners.set(event, []);
    this._listeners.get(event).push(cb);
    return () => this.off(event, cb);
  }
  off(event, cb) { /* ... */ }
  emit(event, data) { (this._listeners.get(event) || []).forEach(cb => cb(data)); }
}
export const eventBus = new EventBus();
```

| Event | Emitter | Consumers |
|---|---|---|
| `block:broken` | BlockInteraction | ChunkManager, Client, DroppedItems |
| `block:placed` | BlockInteraction | ChunkManager, Client |
| `player:moved` | Player | Client, PlayerSync, ChunkStreamer, HUD |
| `player:damaged` | SurvivalSystem | HUD (flash), Client |
| `mob:died` | MobManager | DroppedItems, QuestSystem, HUD |
| `inventory:changed` | InventorySystem | Hotbar, InventorySync |
| `gamemode:changed` | Game | Player, HUD, BlockInteraction |
| `daynight:changed` | TimeOfDaySystem | Renderer (fog), HUD, Client |

- **Beware ordering:** `forEach` is synchronous and registration-ordered. Anywhere the old inline code depended on "chunk update happens before network send", assert it in a test.
- **Accept:** each migrated path has a unit test; no `if (sessionManager && ...)` chains left in gameplay code.

### PR 22 — Move cross-cutting logic out of the loop
These currently run inline in `renderLoop`; each moves into its own system's `update(dt)` with its own frame counter:
multiplayer movement sync (`frameCount % 3`) · touch look delta · fly-mode indicator · HUD armor (`% 10`) · debug stats · day/night + PBR update · biome effects · mob attack via mouse · multiplayer time sync (`% 30`) · block-change network send · hotbar UI (`% 5`) · the periodic-save `setInterval`.
- **Accept:** `renderLoop` calls only `SystemRunner.update(dt)` and `renderer.render()`.

### PR 23 — Split `chunkmanager.js` (1,664 → 5 files)

| Responsibility | File | ~Lines |
|---|---|---|
| Worker pool | `src/engine/world/WorkerPool.js` | 80 |
| Memory cache | `src/engine/world/ChunkCache.js` | 100 |
| IndexedDB + `flushDirtyChunks` + `startFlushTimer` | `src/engine/world/ChunkStorage.js` | 200 |
| `checkRegion` / `startRegionCheck` | `src/engine/world/RegionTracker.js` | 150 |
| `renderChunks`, `loadedMeshes`, `updateRenderChunks`, public API (`getVoxel`, `applyBlockChange`) | `src/engine/world/ChunkManager.js` | 300 |

- **Highest data-loss risk in the plan.** `DB_NAME`/`DB_VERSION` must not change; the `onupgradeneeded` path must behave identically. Run the save/load test before and after, and test with a **pre-existing** v2 database.

### PR 24 — Split `inventory.js` (1,048) + dedupe the face table

| From | To |
|---|---|
| `ITEM_CATEGORIES`, `MAX_STACKS`, `NAMED_ITEMS` | `src/game/data/ItemDefinitions.js` |
| `Inventory` (slots, add, remove, stack, serialize), `getAttackDamage()` | `src/game/systems/InventorySystem.js` |
| `EQUIPMENT_SLOTS`, `getEquipmentSlotForItem`, `equipItem`, `unequipItem`, `getEquipmentStats`, `getArmorValue`, `getArmorToughness` | `src/game/systems/EquipmentSystem.js` |
| `hotbarSlotIndex`, `selectByNumber`, `cycleSelection` | `src/ui/hud/Hotbar.js` |

Also: unify `FACES` (`meshWorker.js:36`) with the `sides` table (`chunkMeshBuilder.js:371`) into `src/game/data/FaceTable.js` ([§3.5](#35-protocol-duplication--v1-was-half-wrong)). Worker imports must stay worker-safe (no THREE, no DOM).
- **Accept:** inventory serialization round-trips existing saves; meshes render identically (screenshot diff).

### PR 25 — Split `skybox.js` (1,031) and finish mobs
- Extract the day/night cycle → `src/game/systems/TimeOfDaySystem.js`; keep rendering in `SkyRenderer.js`.
- Resolve the `test_skybox` fog-density discrepancy from PR 4 if still open.
- Unpark `js/mobs/` if it was parked in PR 1: move to `src/game/mobs/`, wrap in `MobSystem`, and either work through `MOB_PLAN.md` or freeze it with the remaining 253 items documented as out of scope.

---

## 10. Phase 5 — UI / HTML / CSS (PR 26–29)

### PR 26 — Slim `index.html` **and** fix the source-text tests in the same PR
Target:
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>Cuubz — Voxel Survival</title>
  <link rel="stylesheet" href="/src/ui/css/index.css">
</head>
<body>
  <div id="app"></div>
  <script type="module" src="/src/index.js"></script>
</body>
</html>
```
Phased approach: keep the DOM structure but move each screen's markup into a template imported by its screen module, so CSS selectors keep matching. Also remove the **24 inline `style="` attributes** — v1's "no inline styles" goal never accounted for them.

**In this same PR**, rewrite or delete `test_responsiveHUD`, `test_mobileViewports`, `test_pageLoad`, `test_textureAssets`, `test_textureGenerator`, `test_chunkBinaryCodec` — they `readFileSync` the HTML/CSS and will break ([§3.6](#36-source-text-tests-conflict-with-phase-5)). Prefer real jsdom DOM assertions; delete anything that only asserts a CSS string exists.
- **Accept:** `index.html` under 80 lines; `npm test` green; all screens render; mobile touch controls work.

### PR 27 — Reorganize CSS
Split `css/style.css` (~2,100 lines) into `src/ui/css/`:
```
reset.css  variables.css  layout.css
components/{buttons,modals,meters,hotbar,inventory,crafting,settings,lobby,slots,touch-controls}.css
hud/{meters,crosshair,debug-stats,quest-tracker}.css
screen/{main-menu,character,world,loading}.css
```
Add design tokens:
```css
:root {
  --color-bg:#1a1a2e; --color-text:#e0e0e0; --color-primary:#4CAF50;
  --color-danger:#e74c3c; --color-muted:#555;
  --spacing-xs:4px; --spacing-sm:8px; --spacing-md:16px; --spacing-lg:24px;
  --radius-sm:4px; --radius-md:8px; --font-mono:'Courier New', monospace;
}
```
Import CSS from the module that uses it (`import '../css/components/buttons.css'`).
- **Accept:** visual diff against the Phase 0 tag on desktop **and** mobile viewport. Extract token values from the existing CSS; don't invent colors.

### PR 28 — HUD components
`src/ui/hud/*` — each element owns its DOM and subscribes to EventBus instead of being poked from the loop.

### PR 29 — Overlay components
`InventoryScreen`, `CraftingScreen`, `PauseMenu`, `EquipmentPanel` — each owns show/hide and listener lifecycle.

---

## 11. Phase 6 — Shared Protocol & Test Migration (PR 30–33)

### PR 30 — `shared/protocol.js`
`MESSAGE_TYPES` currently lives in `js/multiplayer/client.js:40` and `server/session.js:30`, and is *used* undefined in `host.js`. One source of truth:
```js
// vite.config.js
resolve: { alias: { '@shared': path.resolve(__dirname, 'shared') } }
```
`server/` is CommonJS — either publish `shared/protocol.js` as dual CJS/ESM, or keep it CJS and let Vite consume it. **Pick one and write it down.**
- **Accept:** a test asserts client and server `MESSAGE_TYPES` are deep-equal. Two-browser multiplayer session still works.

### PR 31 — Vitest
```bash
npm i -D vitest
```
```js
// vitest.config.js
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'jsdom', include: ['test/**/*.test.js'] } });
```
Migrate incrementally: run the legacy `bash test/run_tests.sh` **and** `vitest` side by side in CI until the last file is converted. Do not big-bang this.
- **Accept:** both runners green; `npm test` runs Vitest; `test/QUARANTINE.md` is empty or has a documented owner per entry.

### PR 32 — Restructure tests + automate the data test
```
test/
├── helpers/setup.js
├── unit/{core,engine,game,ui}/
├── integration/{gameLoop,multiplayerSync,worldPersistence}.test.js
└── e2e/                     # future: Playwright
```
Automate the [§1.5](#15-player-data-must-survive-byte-for-byte) save/load check as `integration/worldPersistence.test.js` using `fake-indexeddb`, seeded with a **pre-refactor v2** database dump.

### PR 33 — Remove CommonJS shims and final cleanup
Delete the remaining `typeof module !== 'undefined'` blocks (62 at the start) now that tests import ESM. Final gate: `npm run dev`, `npm run build`, `npm test`, `npm run lint`, `./sync.sh` all pass.

---

## 12. Deferred: Three.js Upgrade (separate project)

Do not attempt during this refactor. When it happens:
1. Establish screenshot baselines first — day, night, underwater, cave, each biome, shadows on/off, mobile.
2. Read the r134 → target migration guides in sequence; the color-management break (r152) is the big one.
3. Set `outputColorSpace` / `useLegacyLights` explicitly to reproduce r134 behavior, then migrate deliberately.
4. Rewrite `pbrShader.js`'s 7 `ShaderMaterial` variants against the new fog and shadow uniform includes.
5. Diff every screenshot. Any pixel change must be explained, not accepted.

Confirmed non-blockers: workers use no THREE; no removed APIs are referenced.

---

## 13. File Migration Map

`main.js` → targets, **by symbol** (line numbers drift; see [§3.3](#33-real-symbol-landmarks-in-mainjs) for current values):

| Symbol / region | Target |
|---|---|
| IIFE open, logger init | `src/index.js` |
| `screens`, `modals`, `sessionUI`, `showScreen` | `src/ui/UIManager.js` |
| `BrowserCharacterManager` | **RECONCILE** → `src/game/entities/CharacterManager.js` (PR 14) |
| `BrowserWorldManager` | **RECONCILE** → `src/game/entities/WorldManager.js` (PR 14) |
| Top-level `let` declarations | Eliminated → `GameState` |
| `renderCharacterSlots`, `createCharacterSlotElement`, char modals | `src/ui/screens/CharacterScreen.js` |
| `escapeHtml` | `src/util/HTMLUtils.js` |
| `renderWorldSlots`, `createWorldSlotElement`, world modals | `src/ui/screens/WorldScreen.js` |
| `initMenuNavigation` | `src/ui/UIManager.js` + per-screen |
| `REJOIN_STORAGE_KEY`, `SessionManager`, rejoin panel, `updateConnectionStatus` | `src/multiplayer/SessionManager.js` |
| `init()` DOM/event/settings wiring | `src/index.js` + `src/ui/screens/*` |
| `startGame()` steps 1–15 | `src/core/Game.js` |
| `new CuubzGame()` + `js/game.js` | Absorbed; `core/Game.js` is a **rewrite** |
| Hotbar update, inventory toggle, crafting screen | `src/ui/hud/Hotbar.js`, `src/ui/overlays/*` |
| Damage/quest/creative/sound wiring | respective system files |
| Keyboard shortcuts, mouse wheel | `src/engine/input/InputManager.js` |
| Periodic save `setInterval` | `src/engine/world/ChunkStorage.js` |
| `renderLoop` | `src/engine/loop/RenderLoop.js` + `SystemRunner.js` |
| `updateDebugStats` | `src/ui/hud/DebugStats.js` |
| `setupPauseMenu`, `onExit` | `src/ui/overlays/PauseMenu.js` |
| Mobile detection, auto-rejoin, `beforeunload` | `src/index.js` + `SessionManager.js` |

`chunkmanager.js` → [PR 23](#pr-23--split-chunkmanagerjs-1664--5-files). `inventory.js` → [PR 24](#pr-24--split-inventoryjs-1048--dedupe-the-face-table). Everything else → [§4.1](#41-target-directory-structure).

---

## 14. Anti-Patterns

- ❌ **Don't skip Phase 0.** A red suite means you cannot prove parity. This is the whole reason v1 was rejected.
- ❌ **Don't run bare `npm install three`.** Pin `0.134.0`. See [§1.2](#12-pin-threejs01340-do-not-run-npm-install-three).
- ❌ **Don't change `DB_NAME`, `DB_VERSION`, `'cuubz:settings'`, or `'cuubz_last_session'`.** Players lose worlds.
- ❌ **Don't merge the module switch without the deploy fix.** `sync.sh` excludes `dist/`; you'd ship a site with no JS.
- ❌ **Don't extract `renderLoop` before hoisting its 184 closure locals.**
- ❌ **Don't `cp -r textures/`.** 118 MB, already in git. `git mv` or leave it.
- ❌ **Don't use `.eslintrc.cjs`.** ESLint 9+ needs flat `eslint.config.js`.
- ❌ **Don't let module conversion silently fix the 8 collisions.** Fix them in PR 3, with tests.
- ❌ **Don't change HTML/CSS while source-text tests still read them.** Same PR, or delete them first.
- ❌ **Don't put game logic in UI components.** Screens manage DOM, emit events, delegate.
- ❌ **Don't reach into another module's internals.** EventBus for cross-cutting concerns.
- ❌ **Don't use `typeof X !== 'undefined'`.** If it isn't imported, it's a bug. Keep `no-undef` on.
- ❌ **Don't assign to `window.*`.** ES exports only.
- ❌ **Don't inline large data objects in logic files.** `src/game/data/`.
- ❌ **Don't batch PRs.** Each one must be independently verifiable and revertible.

---

## Appendix A — Full File Inventory

64 files, 33,912 lines (excludes `js/three.min.js`). Every one has a destination in [§4.1](#41-target-directory-structure).

```
4919  main.js                    613  entities/questMarker.js
1664  chunkmanager.js            589  input/interaction.js
1175  multiplayer/host.js        549  renderer/textureAtlas.js
1170  audio/ambient.js           541  renderer/performanceOptimizer.js
1160  systems/survival.js        527  systems/crafting.js
1152  entities/boss.js           486  mobs/mobDefinitions.js
1064  world/workerGeneration.js  463  entities/worldManager.js        ← dup of main.js:428
1048  systems/inventory.js       392  entities/characterManager.js    ← dup of main.js:69
1048  multiplayer/client.js      280  game.js                         ← stub, absorbed
1031  renderer/skybox.js         + 36 more files under 500 lines
 846  multiplayer/playerSync.js    (world/, renderer/, systems/, input/, util/, mobs/*)
 843  renderer/pbrShader.js
 813  multiplayer/inventorySync.js   Untracked: js/mobs/ — 18 files, 3,516 lines
 788  renderer/chunkMeshBuilder.js   Not script-tagged: js/renderer/meshWorker.js
 769  multiplayer/chunkStreamer.js
 667  renderer/voxelRenderer.js      server/: index.js, session.js, matchmaking.js (~1,110)
 634  systems/damageSystem.js
 621  audio/sfx.js
```

Regenerate with:
```bash
find js -name '*.js' -not -name 'three.min.js' | xargs wc -l | sort -rn
```

## Appendix B — What Changed From v1

| v1 claim | Reality |
|---|---|
| "All 55 existing tests pass" (Phase 1 gate) | 53 files; **21 pass, 32 fail** before any change. 3 source files crash on `require`. |
| `npm install three` | Bundled Three is **r134 (2021)**; 843-line custom PBR shader with 7 `ShaderMaterial`s and no color-management config. Blind upgrade changes every color. **Pin 0.134.0.** |
| Web Workers | Never mentioned. Both pools use `fetch` + `Blob` with hardcoded `js/` paths; `meshWorker.js` isn't script-tagged; `workerGeneration.js` is triple-contract dual-mode. |
| Deployment | Never mentioned. `sync.sh` **and** `.gitignore` exclude `dist/` → first sync ships zero JS. |
| "Root cause: `window.GlobalName` exports" | Only **4** `window.*` assignments. Real cause: implicit top-level globals in classic scripts. |
| "`typeof X !== 'undefined'` littered everywhere" | 126 total, but **62 are `typeof module`**; only **29** are genuine cross-module guards. |
| §8.1 line-number table | **Every entry wrong.** `startGame` is 2156 (not 1850), `renderLoop` 3908 (not 3950), `BrowserWorldManager` 428, `renderWorldSlots` 606. Replaced with symbol names. |
| "`renderLoop()` is 200+ lines → extract it" | It's a closure over **~184 locals** inside a `setTimeout(async…)`. Not extractable without a new hoisting phase. |
| `MESSAGE_TYPES` duplicated in 4 files | Defined in **2**; `matchmaking.js` and `server/index.js` have zero refs; `host.js` uses it **undefined**. |
| ~50 script tags | **64**. Plus 24 inline `style=` attributes the "no inline styles" goal ignored. |
| `.eslintrc.cjs` | ESLint 9+ needs flat `eslint.config.js`. |
| `"test": "node test/run_tests.sh"` | It's a bash script — `node` can't run it. |
| `cp -r textures/* public/textures/` | Duplicates **118 MB / 3,370 files**, already tracked in git. |
| Target tree | Omitted **52 of 64 files**, including 11 of the 15 largest. No `src/audio/` at all. |
| `BrowserCharacterManager` → `CharacterManager.js` | **Collides** with the existing tested `js/entities/characterManager.js`. Needs an explicit reconcile decision. |
| Global collisions | Not mentioned. **8 exist, 3 are live production bugs** (boss spawning throws, host inventory sync always rejects, mobile breakpoint is 600 not 768). |
| Data compatibility | Not mentioned. IndexedDB `cuubz-worlds` v2 + 2 localStorage keys must survive byte-for-byte. |
| `js/mobs/` | Not mentioned. **Entirely untracked** — 18 files, 3,516 lines; `MOB_PLAN.md` 56/309 done. |
| Phase 4 before Phase 5 | Phase 4 invalidated 6 source-text tests that Phase 5 was supposed to migrate. Merged into one PR here. |
| CI | Not mentioned. Now PR 5, before anything else. |
| "~6 weeks, Week 1…Week 5" | Not credible for 34k lines with a red suite, and useless for handoff. Replaced with 33 numbered PRs, each with acceptance criteria. |

---

*v2 written 2026-07-29 against the working tree (16 modified tracked files, `js/mobs/` untracked). All figures measured, not estimated. Regenerate them before starting if the tree has moved.*
