# PR 20 Handoff — PR 18 and PR 20 are landed. PR 23 is next, and §4 is its inventory.

**Read this first:** the owner ruled on 2026-07-30 (`BUGS.md` **decision 20**) that **nothing
deploys to `10.0.30.160` until the entire rewrite is finished** — not at any phase gate.
**PR 10's `sync.sh` stays unverified on purpose.** Do not run it. The accepted cost is
written down and is not an oversight: **the delta between this branch and anything that has
ever run on the host grows with every PR.**

**Read second:** `refactor.md` **§8.7** — the plan was collapsed from 17 remaining PRs to 7
(`BUGS.md` **decision 32**). **The `EventBus` (PR 21) and PR 28/29's component framework are
dropped.** Do not build them. Absorbed PRs keep their headings, marked **ABSORBED**;
**nothing is renumbered.** One slot was *added*: **PR 34** (§9), created by PR 20's decision
42 — see §5.

**Status:** PR 18 and PR 20 are **landed and pushed**. `refactor/phase-0` at `35166ca`.
Tree clean. Nothing in progress. **Phase 3 is CLOSED** — `src/main.js` is deleted.
Phase 4 is **one of two done** (PR 20 landed; PR 23 remains).
**Parent doc:** `refactor.md` §8.5 and §9 — the outcome write-ups live there, not here.
`PR17_HANDOFF.md` is superseded.

---

## 0. Where things stand in one screen

```bash
git log --oneline -3
#   35166ca  feat(PR20): System base class + D-25 triage — six dead modules deleted
#   056754d  feat(PR18): delete src/main.js — RenderLoop + SystemRunner, pause menu, bootstrap
#   e2a2611  docs: PR17_HANDOFF.md

npm test                  # 50 files, 0 failed, 4 quarantined, exit 0        (CI)
                          # 5,699 assertions (was 6,855 — PR 20 deleted dead modules' tests)
npm run lint              # 0 errors, 159 warnings, exit 0                   (CI runs lint:ci)
npm run build             # exit 0
npm run test:e2e          # 189 assertions, 0 failures  (~7 min, builds first, serves dist/)
npm run test:e2e:vite     # 189 assertions, 0 failures  (~6 min, npm run dev)
git status                # clean
```

**189 on both hosts, unchanged across both PRs.** The two must stay equal — that equality is
the proof that the built bundle and the dev server are the same game.

**`npm test` only runs from Git Bash, never PowerShell** — `package.json` calls
`bash test/run_tests.sh`. This costs a cycle every time it is forgotten.

**Branch state:** `refactor/phase-0`, pushed. **`origin/main` is still at the PR 1 baseline
`27959d3`** — deliberately; the owner merges. **PR #1 is open** and is to be left open.
`pre-refactor-baseline` is pushed (`27959d3`).

**`src/main.js`: 5,155 → deleted**, across PR 14, 15, 16, 17 and 18.
**`src/` lost a further 2,592 lines in PR 20.**

---

## 1. What PR 18 and PR 20 did

### PR 18 — `main.js` is gone

| File | Lines | What |
|---|---|---|
| `src/engine/loop/RenderLoop.js` | 105 | rAF, the two early-outs, delta, `frameCount++` |
| `src/engine/loop/SystemRunner.js` | 45 | the order, and nothing else |
| `src/engine/loop/steps/*.js` | 52–211 | six ordered steps |
| `src/ui/hud/DebugStats.js` | 60 | + the three FPS `let`s |
| `src/ui/overlays/PauseMenu.js` | 377 | |
| `src/multiplayer/AutoRejoin.js` | 156 | |
| `src/core/Bootstrap.js` | 351 | exports `start()` |
| `src/core/savePlayerState.js` | 57 | split out for the 400 ceiling |

**Ordering was preserved exactly and verified statement-by-statement against the deleted
file**, not asserted. `sendMove` stays inside the player step between `player.update()` and
the touch-look; `renderer.render()` stays in the **middle** of `WorldStep` with the tooltip
raycast and `updateRenderChunks` after it; `mouse.update()` stays last in the combat step;
`frameCount++` stays the frame's last statement (D-34).

**The adversarial pass caught two things the implementation did not**, and this is the third
consecutive PR where that has happened:

1. **D-50's row said eight listeners. There are eleven.** It counted the ones written inline
   in `startGame()` and missed the ones a *constructor* registers — `KeyboardInput` adds
   `keydown` + `keyup`, `MouseInput` adds `pointerlockchange`, `TouchInput` binds **thirteen**
   handlers to `index.html` buttons. All three classes carried an **idempotent `dispose()`
   with no call site**. And the keyboard set was not inert: `_onKeyDown` calls
   `preventDefault()` on `Space` with no focus guard, so **one exit to the menu left a stale
   handler eating the space bar in the character-name and world-name inputs.**
2. **The D-54 `try/catch` would have silently reinstated D-50.** It wrapped the whole of
   `stop()`, and `runTeardowns()` was the last statement inside it — so a throw in the
   newly-added save path would have skipped both the `clearInterval` and the listener drain,
   behind one `console.warn`. `Game.stop()` now guards only the fallible save.

### PR 20 — six of the twelve dead modules are gone

Deleted, **2,592 lines of `src/` and 2,658 of `test/`**: `AmbientAudio.js`, `SFX.js`,
`PerformanceOptimizer.js`, `Crosshair.js`, `pathfinding.js`, `SpawnManager.js`.
`Noise.js` reassigned to PR 23 (D-60). Five gameplay modules deferred to **PR 34**.
`src/game/systems/System.js` exists; **nothing extends it yet, on purpose** — see §5.
D-21, D-55 and D-59 fixed.

---

## 2. Rulings already made — do not re-litigate

`BUGS.md` has all **forty-three** in its decision table. 20 and 32 are the owner's;
**35–41 were made inside PR 18 and 42–43 inside PR 20.** The ones that will bite:

1. **Decision 20 — no deploy until the whole rewrite is done.** See the top of this file.
2. **Decision 32 — the plan is seven PRs.** No `EventBus`, no component framework.
3. **Decision 43 — §9 PR 22's accept criterion is SUPERSEDED, not missed.** *"`renderLoop`
   calls only `SystemRunner.update(dt)` and `renderer.render()`"* cannot be met without
   reordering the frame, because `renderer.render()` sits deliberately mid-`WorldStep`.
   Collapsing the loop moves the tooltip raycast, `updateRenderChunks` **and**
   `mobIntegration.update` from after the draw to before it. **Do not "finish" this.**
4. **Decision 42 — D-25 split three ways.** Six deleted, `Noise.js` to PR 23, five gameplay
   modules to PR 34. The line: deleting a *duplicate* or a *provably broken* module is
   triage; deleting five feature subsystems is a product decision.
5. **Decisions 30, 33 — the 400-line ceiling wins and forces more files than the plan
   names.** Applied three times now (session layer → 4 files; `startGame` → 11; PR 18 split
   `savePlayerState` out when `Game.js` hit 410). **§4 below says it binds again in PR 23,
   twice.**
6. **Decision 23 — never add a `GameState` property by assigning to it.** Declare it in the
   constructor. PR 18 added `camPos`, `session` and `teardowns` that way.
7. **Decision 36 — `state.camPos` gets a FRESH `THREE.Vector3` every frame**, not a reused
   one. Same allocation count as before; a mutated shared vector is a behaviour change for
   any consumer that retains the reference.
8. **Decision 21 — `src/testBridge.js` is not deleted until PR 33.** `window.__cuubz` is
   still the only sanctioned `window` assignment in `src/`, and `test_globalCollisions.js`
   fails if a second appears. **`Game.js` must not import it** — `publishGameState` arrives
   through `deps`.
9. **Decision 29 — a mechanical extraction does not RECREATE provably-dead `typeof` guards**,
   but moving one unchanged is fine. PR 33 owns the sweep.

Still true: **never renumber `BLOCK_REGISTRY`**; **`DB_VERSION` stays at 2**; **do not
`npm install three`**; **`DEPLOY.md` §2 is authoritative for storage**; **never change
`'cuubz_last_session'`**; **Prettier reformats nothing**; **CI lints with `--quiet`**.

---

## 3. `BUGS.md` — twenty-one open rows, all owned

| Owner | Rows |
|---|---|
| **PR 23** | **D-51**, **D-56**, **D-57**, **D-60**, **D-63**, **D-64**, **D-65**, **D-66**, **D-67**, **D-68** |
| PR 26 | D-41, D-52, D-58, D-61 |
| PR 31 | D-20, D-28, D-33, D-47, D-48, **D-62** |
| PR 33 | D-27, D-30 |
| PR 34 | D-25 (the five deferred), **D-69** |
| PR 10 | D-12 (post-deploy) |

Closed across this session: **D-42**, **D-50**, **D-54** (PR 18); **D-21**, **D-55**,
**D-59**, and six of D-25's twelve (PR 20).

**PR 23 now owns ten rows.** That is not scope creep — six of them were found *by* the PR 23
inventory in §4, and four (**D-56**, **D-63**, **D-64**, **D-68**) are the same defect class:
**hand-written id and name tables that predate a renumbering, in a codebase where
`BLOCK_REGISTRY` and `BiomeSystem` are the only things that know the real values.**

---

## 4. PR 23 is next, and here is its inventory

`refactor.md` §9 PR 23 — split `ChunkManager.js`, `InventorySystem.js` and `SkyRenderer.js`,
one at a time with `npm test` between each; do not interleave. Absorbs PR 24 and 25.

### 4.1 The plan's line counts are stale, and two of its targets do not fit

| File | §9 says | Actually |
|---|---|---|
| `src/engine/world/ChunkManager.js` | 1,664 | **2,057** (grew 393 — H-1/H-2/D-15/D-18/D-19 all landed in it) |
| `src/game/systems/InventorySystem.js` | 1,048 | **981** |
| `src/engine/renderer/SkyRenderer.js` | 1,031 | **1,007** |

Also wrong in the plan: `meshWorker.js` is at **`src/engine/renderer/`**, not
`src/engine/world/`; the `sides` table is at `ChunkMeshBuilder.js:375`, not 371; and
§9's `EquipmentSystem.js` row names `getArmorValue`/`getArmorToughness`, **which do not
exist** — the armour numbers are fields inside `NAMED_ITEMS`, summed inline in
`getEquipmentStats`.

### 4.2 ChunkManager — §4.1's five-file split does not hold as written

**`ChunkCache.js` is not a file.** §4.1 budgets 100 lines for "memoryCache Map". `memoryCache`
is read or written by **17 methods spread across every other proposed target**. There is no
method whose only state is the cache; a `ChunkCache.js` would be a ~15-line `Map` wrapper
that four other files each hold a reference to.

**`ChunkStorage.js` ↔ `ChunkManager.js` share twelve `this.` fields**: `_db`, `_dbReady`,
`_manifest`, `_flushQueue`, `_flushing`, `_flushIntervalId`, `memoryCache`, `worldName`,
`worldSeed`, `stats`, `_disposed`, `clientMode`. `_flushQueue` is the worst — **seven writers
on the coordinator side, three readers on the storage side**, and `flushDirty` (105 lines)
drains it, re-checks `memoryCache` for `chunk.dirty`, updates `_manifest` and writes `stats`
in one body.

**The arithmetic (decision 33 binds):**

| §4.1 target | §4.1 says | Honest allocation | Fits 400? |
|---|---|---|---|
| `WorkerPool.js` | 80 | **80** | ✅ clean, zero crossing |
| `ChunkCache.js` | 100 | **~15** | ✅ and pointless |
| `ChunkStorage.js` | 200 | **~570** | ❌ over by 170 |
| `RegionTracker.js` | 150 | 73 alone / **187** with `_batchEnsureChunks` | ✅ |
| `ChunkManager.js` | 300 | **~1,143**, of which the mesh pipeline is 456 | ❌ over by 743 |

**Two seams §4.1 does not name, and they are the ones that make it work:**

1. **`ChunkSchema.js` (~186)** — the statics `_ensureStore`, `_ensureIndex`,
   `_ensureBaseSchema`, `_applySchemaUpgrade`, `openDatabase` plus `SCHEMA_STEPS`. **They
   touch no instance field whatsoever** — pure functions over `(db, tx, oldVersion,
   newVersion)`. A genuine zero-crossing cut. Remaining `ChunkStorage.js` ≈ 384. Fits.
2. **`ChunkMeshCoordinator.js` (456)** — the mesh pipeline. Eleven fields cross into it, but
   **eight of them are used by nothing outside it except `dispose()`**. The cleanest
   400-sized cut in the file, and §4.1 has no destination for it at all. Still 56 over; the
   sub-seam is `_onMeshBuilt` + `_wrapBuffers` + `_unloadMesh` + `_disposeOldMeshes` (151).

**Do not cut the flush half out.** It is the only thing that reads `_flushQueue` +
`memoryCache` + `_manifest` + `_db` + `_storeKey` together, and `_setupGracefulShutdown`
writes both stores in one transaction *specifically because* **D-19** required them not to
disagree. That is the split most likely to reintroduce it.

**The storage surface is ~840 lines** across schema ladder, CRUD, manifest, keys, flush and
`_batchEnsureChunks`, and it carries H-1, H-2, D-15, D-18 and D-19's fixes. §4.1 budgets 200.
`DEPLOY.md` §2 is authoritative; `DB_VERSION` stays 2. Note the ladder's own procedure
comment says *"Increment `DB_VERSION` (line 21)"* — it is at **line 51**, already stale.

### 4.3 InventorySystem — the equipment seam holds, the hotbar seam does not

| §9 target | Actual | Fits? |
|---|---|---|
| `ItemDefinitions.js` | ~168 | ✅ |
| `EquipmentSystem.js` | ~120 | ✅ — the seam is clean; only `getAttackDamage` crosses, and only to read `NAMED_ITEMS` |
| `Hotbar.js` | ~30 | ❌ **collision** |
| `InventorySystem.js` remainder | ~660 | ❌ over by 260 |

**`src/ui/hud/Hotbar.js` already exists** (112 lines, PR 17) and is pure canvas/atlas icon
rendering with **no slot-selection logic**. §9's row would merge unrelated concerns into an
occupied filename. And the three methods it names all read five constructor-owned fields
(`hotbarStart`, `hotbarSize`, `selectedHotbarSlot`, `cols`, `onSelectionChange`) that six
other methods also use — it is not a seam.

**The remaining 660 needs another cut.** Cleanest by field usage: `getToolInfo`,
`getAttackDamage`, `canPlaceBlock`, `addBlockDrop`, `_getBlockProperties` (~90) are the only
methods that reach into `BlockRegistry` rather than into slots.

**Real duplication §9 does not mention:** `src/multiplayer/InventorySync.js` carries
`NAMED_ITEM_META` (10 entries duplicating `NAMED_ITEMS`), its own `getItemCategory` and its
own `getMaxStackSize`. And **`InventorySystem.js:13` imports `getItemCategory` from
`InventorySync.js` and never uses it** — shadowed by the class method — which makes a
`src/game/systems/` module depend on `src/multiplayer/`. That import should go.

### 4.4 SkyRenderer — this is the clean one, and it is four files not two

The field partition is almost perfect. **All 15 time accessors read `this.timeOfDay` and
nothing else**, and the 316-line pure-function block touches no `this` at all. **Exactly two
methods cross:** `_updateSkyState` (91 lines, the whole bridge) and `update` (65, which
advances time *and* drives clouds — the split point is inside it).

| Target | Lines | |
|---|---|---|
| `src/game/data/DayNightCurves.js` | **316** | constants + 19 pure functions, zero crossing |
| `TimeOfDaySystem.js` | ~140 | state + the 15 accessors |
| `SkyGeometry.js` | 217 | `init` + the four `_create*` methods |
| `SkyRenderer.js` | ~330 | per-frame + HUD + lifecycle |

Two files would be 456 and 546. Four fit. Decision 33 again.

### 4.5 The face table has NOT drifted — its siblings have, and one is a live high-severity bug

§9 sends the face table to `src/game/data/FaceTable.js`. **All 24 vertex triples and all 24
UV pairs in `meshWorker.js` and `ChunkMeshBuilder.js` are element-for-element identical**,
including the deliberately-inverted `bottom` winding. Only the key names differ.

**The drift is in the sibling tables in the same two files — `D-63`, and it is high.**
`ChunkMeshBuilder` **derives** `cutoutIds`/`transparentIds`/`tintableIds` from the registry;
`meshWorker` **hard-codes** them, and: `TINTABLE_IDS` lists `115` as YELLOW_POPLAR_LEAVES
when **id 115 is `white_concrete`** (so the worker tints white concrete green), and
`CUTOUT_IDS` omits **192**, the real `yellow_poplar_leaves` (so the worker culls faces behind
it). The main-thread fallback renders both correctly, **so the bug's presence depends on
whether a mesh worker spawned.** Extracting only the face table moves the one that is
correct and leaves all three that are wrong.

### 4.6 Test coverage — ChunkManager is the riskiest split by a wide margin

| File | Assertions | Assertions/line |
|---|---|---|
| `InventorySystem` | 204 | 0.21 |
| `SkyRenderer` | 108 | 0.11 |
| **`ChunkManager`** | **~140** | **0.068** |

And ChunkManager's coverage is **entirely on the storage third**. Grep finds **zero** test
calls to `_queueMeshBuild`, `_onMeshBuilt`, `_doMeshBuild`, `_dispatchMeshBuild`,
`_wrapBuffers`, `_buildMeshInline`, `_unloadMesh`, `_disposeOldMeshes`,
`_ensureUVLookupCache`, `updateRenderChunks`, `rebuildAllMeshes`, `setRenderDistance`,
`checkRegion`, `_batchEnsureChunks`, `_updateVoxelRegion`, `_processGenQueue`,
`generateChunk` or `_setupGracefulShutdown`. **456 lines of the largest seam have no unit
test**, and §9's accept criterion for the mesh half is a *screenshot diff* — not automated.

### 4.7 D-51 cannot be fixed the way its row implies

The row says generate the colour table from `BLOCK_REGISTRY`. **There is no colour field to
generate from.** Registry entries are `{ id, name, texture, category, hardness, tool }`;
`color:` appears on exactly **2 of 193** entries, both float RGB triples used as a mesh tint
for two flowers sharing a texture. (Also: the registry has **193** entries, not the 162 the
row and `refactor.md` say.) So fixing D-51 means one of: add a `dropColor` to 193 entries by
hand (a content change with no test that can tell right from wrong — which is why PR 17
declined it); **derive it by averaging the block's atlas tile** (`TextureAtlas` already
exposes `diffuseCanvas` and per-block `tileMap` coordinates, and `Hotbar.js:renderItemIcon`
already samples them — this is the only *generated* option); or draw the atlas tile on the
dropped item instead of a colour cube.

---

## 5. PR 34 exists now, and what it must decide

Created by decision 42, documented in `refactor.md` §9. `SurvivalSystem` (1,152),
`DamageSystem` (627), `QuestSystem` (262), `QuestMarker` (602), `Boss` (1,135) — ~3,800 lines
and ~1,000 assertions, none ever executed outside `test/`.

**The facts the decision needs are banked and must not be re-derived:**

- **The survival HUD exists in `index.html` and nothing writes to it.** `#health-meter`,
  `#hunger-meter`, `#thirst-meter`, `#sleep-meter`, `#stamina-meter` all contain a
  `.meter-fill` hard-coded `style="width:100%"`, and **no code in `src/` ever touches
  `meter-fill`.** `SurvivalSystem.generateHUDHTML()` emits a *different*, self-contained
  `#survival-hud` overlay that does not exist in the HTML.
- **There is no boss HUD element at all.** `Boss.js` has **no rendering whatsoever** — no
  `THREE` import, no mesh; `BOSS_DEFINITIONS` carries `size` and `color` that nothing
  consumes. Wiring it means writing a boss renderer from scratch.
- **`#damage-flash` exists** and is CSS-driven via an `.active` class — but
  `DamageFlashEffect.generateHTML()` emits a *replacement* div with an inline `box-shadow`
  and no `active` class. The two mechanisms are incompatible; wiring means picking one.
- **`DamageSystem` cannot be wired independently of `SurvivalSystem`** — `update()` hard-
  returns without `linkSurvivalSystem()`, and it reaches into `survivalSystem.config.health.max`.
- **Quest data has four incompatible `questProgress` shapes** across `WorldManager`
  (`{stage, completed, lastUpdated}`, 5 hard-coded stages), `Host.js` (a bare number),
  `QuestSystem` (`{state, progress, completed, completedAt}`) and `{}` everywhere else.
  Production callers of `setQuestProgress`/`advanceQuest`: **zero.**
- **~20 defects were found by reading modules that have never run**, including:
  **`Boss.phaseTransitionTimer` is never initialised** — `deserialize` restores `state`
  without it, so `undefined - deltaTime` is `NaN`, `NaN <= 0` is false forever, and the boss
  is **permanently frozen and unkillable** (high); `Boss.serialize()` drops all combat state;
  `DamageSystem`'s `LAVA_ID = 15` / `TOXIC_SLIME_ID = 17` against a registry where lava is 47
  and toxic slime 188 (**D-64**) — **and `test_damageSystem.js` asserts the wrong mapping**;
  `QuestMarker.getInteractableMarkers(playerPos)` ignores its argument; `QuestSystem`'s
  `_rebuildChain` resets any `IN_PROGRESS` quest to `AVAILABLE` on every `deserialize`.

**If PR 34 wires anything, D-21's fix and D-64's tables are preconditions, not follow-ups.**

---

## 6. Things that are true and easy to break by accident

- **`npm test` only runs from Git Bash.** Not PowerShell. It calls `bash test/run_tests.sh`.
- **When you edit a file mechanically, parse it with `acorn` afterwards.** `node --check`
  reported a brace-imbalanced file as valid during PR 13 — it silently re-parses as ESM.
  `require(process.cwd()+'/node_modules/acorn')`, `sourceType:'module'`.
- **`no-undef` is the other half of that gate.** Run `npm run lint` after every file you
  create, not at the end.
- **Do not edit a tracked file while an e2e run is in progress.** The vite host serves the
  working tree, so HMR reloads the page mid-run; and the run asserts `git status --porcelain`
  is byte-identical before and after.
- **A stale `vite` on port 3100 makes a green run a lie.** Seven occurrences so far.
  `Get-NetTCPConnection -LocalPort 3100 -State Listen` → `Stop-Process -Force`.
  `--strictPort` is what makes it loud; do not switch to an ephemeral port.
- **Do not push a second commit while the previous CI run is still in flight.** The workflow
  has a concurrency group on `refs/pull/1/merge`, so the new push **cancels** the running one
  — `35166ca` (PR 20) has no green run of its own for exactly this reason, and the cancelled
  run reports `conclusion: cancelled` with **one annotation** reading *"Canceling since a
  higher priority waiting request … exists"*. That looks like a red CI with an annotation and
  is neither. Either wait for the run, or verify the *later* SHA and say so.
- **`gh run list --limit 1` can return the PREVIOUS run** for up to a minute after a push —
  the new one has not registered yet. Match on `headSha` before trusting it, or you will
  report the last commit's CI as this one's.
- **Capture the FULL e2e output, not `| tail -3`.** The `Results: N passed` line is not in
  the last three lines, and a run that failed early looks identical to one that passed.
  This cost a cycle in PR 18.
- **`test/run_tests.sh` globs `test/test_*.js` — flat, non-recursive**, which is the only
  reason `test/e2e/` is invisible to `npm test`. Never name anything `test/test_e2e*.js`.
- **The two worker files must stay classic scripts.** `eslint.config.mjs` lints them with
  `sourceType: 'script'` so an accidental `import` is a parse error at lint time.
- **`publicDir` is `false` and stays that way.** `textures/` is 118 MB across 3,370 files.
- **`QUARANTINE.md` holds 4 files against a cap of 5, all owned by PR 26.** Do not grow it.
- **`waitForQuiesce` exists for a reason.** Do not replace it with a sleep, do not weaken
  exact counts to inequalities.
- **The screenshot assertion expects exactly six `.png` files.** Adding a `shot()` breaks it.
- **Never weaken an assertion to make a run pass.** If a defect-asserting block goes red
  because you fixed the defect, rewrite it into the assertion the fix makes true, in the same
  PR. **New assertions must be proved non-vacuous by breaking the thing they check** — PR 12
  for D-35, PR 14 for D-18, PR 16 three ways for D-43, PR 17 three ways for D-49, **PR 20 for
  D-55 (13/13 → 11/13 with the guard reverted)**.
- **A green harness proves less than it looks like.** D-32, D-34, D-43, D-45 and D-49 all sat
  under fully green runs. **And a green harness is not the last check** — PR 18's adversarial
  pass found a listener undercount and a `try/catch` that would have silently reinstated the
  bug it guarded, both under five green gates. **Run the adversarial pass before committing.**
- **D-62: the e2e seed assertion is nondeterministic.** One run failed
  `expected 424242, got 3335459929` and the identical tree passed it on the run before and
  the run after. If it goes red, re-run with full output *and log what happened* — do not
  re-run into silence.

---

## 7. Acceptance criteria for whatever comes next

- `npm test` stays at 50 files / 0 failed / 4 quarantined, exit 0.
- `npm run lint` stays at **0 errors**. Warnings may not grow above **159** without a
  `BUGS.md` note. Do not disable `no-undef`. Do not undo `lint:ci`'s `--quiet`.
- `npm run build` stays at exit 0 — **and `dist/` must actually run**, which `test:e2e` proves.
- Both e2e hosts stay at 0 failures and stay **equal to each other**. If the count changes,
  say by how much and why, in the same PR.
- CI green on push, **zero annotations**.
- Every bug found gets a `BUGS.md` row with a severity and an owner PR, in the same commit.
- **No extracted file over 400 lines.** `Game.js` is at 394.
- **Outcome sections are a paragraph and a gate table, not an essay** (decision 32).

---

## 8. The Phase 3 and Phase 4 gates

**Phase 3 — CLOSED.**

| Box | State |
|---|---|
| `main.js` deleted | **Yes.** 5,155 → 0 across PR 14–18 |
| `src/index.js` < 50 lines; no extracted file > 400 | **No file exceeds 400** (largest: `Game.js` 394). `index.js` is **85 lines** — the D-25 comment block grew when PR 20 recorded the six deletions and the PR 34 deferral. **Still open, still PR 20/34's, not a Phase 3 failure** (decision 41) |
| Zero `typeof X !== 'undefined'` in `src/` | **Cannot close in Phase 3 and is not a failure.** Decision 16 moved the sweep to **PR 33**. Report the count at the gate; do not tick it |
| Solo, creative, pause, settings, save/load verified | **Automated — 189 assertions on both hosts** |
| host, join verified | **Not automated.** **D-48**, owner PR 31 |
| `npm test && lint && build` green | **Green** |
| deploy verified | **Decision 20 — deliberately deferred, not blocked.** Do not tick it; do not run `./sync.sh` |

**Phase 4 — one of two.** PR 20 landed; **PR 23 remains** and §4 is its inventory.
