# PR 13 Handoff — Phase 2 is closed. Nothing deploys until the rewrite is done. PR 14 is next.

**Read this first:** the owner ruled on 2026-07-30 (`BUGS.md` **decision 20**) that
**nothing deploys to `10.0.30.160` until the entire rewrite is finished** — not at the
Phase 1 gate, not at the Phase 2 gate. **PR 10's `sync.sh` stays unverified on purpose.**
Do not run it. Do not treat the unticked deploy box in `refactor.md`'s Phase 1 gate as
blocked work; it is deliberately deferred. `PR11_HANDOFF.md` §7 says the opposite and is
marked superseded. The accepted cost is written in three places and is not an oversight:
**the delta between this branch and anything that has ever run on the host grows with
every PR, and the first real `./sync.sh` will be debugged against a codebase that has
changed shape six times.**

**Status:** PR 12 and PR 13 are **landed and pushed**. `refactor/phase-0` is at `9592556`,
CI green with **zero annotations**. Tree clean. Nothing in progress. **Phase 2 is closed.**
**Parent doc:** `refactor.md` §7 PR 12 / PR 13 — the full outcome write-ups live there, not
here. `PR11_HANDOFF.md` is superseded except for its §5.
**This is a starting point, not a record.** The record is `refactor.md`, `DEPLOY.md` and
`BUGS.md`.

---

## 0. Where things stand in one screen

```bash
git log --oneline -4
#   9592556 feat(PR13): un-nest startGame — both setTimeout wrappers gone, 15 numbered steps, D-36
#   b94527c feat(PR12): GameState — renderLoop leaves the closure; D-31, D-34, D-35; e2e 152 -> 166
#   81c243a docs: PR11_HANDOFF.md — Phase 1 closed, deploy unverified, PR 12 is next
#   45028db fix(PR11): CI lints with --quiet, and the flat config is .mjs

npm test                  # 52/52 passing, 4 quarantined, exit 0            (CI)
npm run lint              # 0 errors, 178 warnings, exit 0                  (CI runs lint:ci)
npm run build             # exit 0
npm run test:e2e          # 166 assertions, 0 failures  (~7 min, builds first, serves dist/)
npm run test:e2e:vite     # 166 assertions, 0 failures  (~6 min, npm run dev)
git status                # clean
```

**152 → 166 in PR 12, and 166 → 166 in PR 13.** Both numbers matter. PR 12's rise is the
two `⚠️ UNVERIFIED` steps closing; PR 13 reshaped 1,800 lines and added no coverage, so an
unchanged count on both hosts is its parity evidence. **The two hosts must stay equal** —
that equality is the proof that the built bundle and the dev server are the same game.

**Branch state:** `refactor/phase-0` at `9592556`, pushed. **`origin/main` is still at the
PR 1 baseline `27959d3`** — deliberately; the owner merges. **PR #1 is open** and is to be
left open. `pre-refactor-baseline` is pushed (`27959d3`).

---

## 1. What Phase 2 actually did

| PR | Result |
|---|---|
| **12** | **`src/core/GameState.js`.** `renderLoop` moved to `main.js` top level as `renderLoop(state)`; 21 closure locals + `inventoryOpen` hoisted; the ad-hoc `game.*` props folded in; `window.__cuubz.state` published to the harness. **D-31, D-34, D-35 closed.** e2e 152 → 166 |
| **13** | **Both `setTimeout` wrappers removed** (200 ms and 500 ms, kept as awaited sleeps because the delays are behaviour). Body dedented from a base of 8/10 to 6. Fifteen numbered step banners. **D-36 closed** — `refactor.md` §8.4's step list did not match the order the code runs in |

**The single most useful thing PR 12 bought** is not the extraction. It is that
`window.__cuubz.state` made `chunkManager` reachable from `page.evaluate`, which closed
`DEPLOY.md` §7 step 4 and the placed-block half of 6/7 — open since **PR 6b**. The harness
now places a block and breaks a block through the production write path, reloads, and
asserts both voxels. **The break is the stronger half:** the seed is fixed, so AIR where
generation puts stone proves the world was loaded rather than regenerated.

---

## 2. Rulings already made — do not re-litigate

`BUGS.md` has all **twenty-three** in its decision table. 1–6 owner 2026-07-29; 7–10 owner
2026-07-30; 11–15 made inside PR 9, 16–19 inside PR 11, **21–23 inside PR 12 and PR 13**.
**Decision 20 is the owner's and overrides three documents** — read it before planning any
deploy work. The ones that will bite if forgotten:

1. **Decision 20 — no deploy until the whole rewrite is done.** See the top of this file.
2. **Decision 21 — `src/testBridge.js` was NOT deleted, and its removal is PR 33's.**
   `refactor.md` §7 PR 12 and decision 7 both said PR 12 would delete it. It has two halves
   and only one collapsed into the game object: `__cuubz.state` is live state, but
   `ChunkManager` the *class*, `CHUNK_MAGIC`, `DB_VERSION`, `BLOCK_REGISTRY` and
   `HEADER_SIZE` are module bindings no `Game` will ever carry, read directly so the
   `DEPLOY.md` §2 invariants do not become tautologies. The file's header states the
   condition for removal. **Do not add a second `window` assignment** —
   `test_globalCollisions.js` now fails if you do (D-35).
3. **Decision 22 — D-34's `frameCount` fix was allowed inside "identical game"**, because
   all six throttled sites state their intended rate in a comment. The multiplayer rate
   changes have **no automated coverage**; that is stated in the row rather than waved off.
4. **Decision 23 — PR 13's fifteen steps are banner comments, not functions.** They share
   ~160 init-only locals PR 12 deliberately did not hoist. PR 17 extracts them properly by
   moving each onto `GameState` as it lifts the step.
5. **Neither Web Worker is an ES module** and `workerGeneration.js` keeps its triple
   contract. Losing the main-thread fallback means a browser that cannot spawn a worker
   gets no terrain at all.
6. **`test/helpers/esmRequire.js` is how CommonJS tests require ES modules.** PR 31 deletes
   the hook. `refactor.md` §6 PR 9 step 3 is impossible as written.
7. **`minify` stays `false`, the 28 `typeof X !== 'undefined'` guards stay** — both PR 33's.
   Note decision 20 changed D-30's condition from "after the first real deploy" to "after
   the rewrite".
8. **Prettier reformats nothing. CI lints with `--quiet`.**

Still true: **never renumber `BLOCK_REGISTRY`**; **`DB_VERSION` stays at 2**; **do not
`npm install three`**; **`DEPLOY.md` §2 is authoritative for storage**.

---

## 3. `BUGS.md` — nine open rows, all owned

| Owner | Rows |
|---|---|
| **PR 14** | **D-37** — `gameState.persistence` is always `undefined` (`storage` vs `persistence` field split); **D-38** — the two `WorldManager`s disagree on max world-name length, 32 vs 16 |
| **PR 20** | D-25 — twelve modules referenced by nothing, incl. 1,791 lines of never-instantiated audio |
| PR 22 | D-21 — `SurvivalSystem` spawn `y=20` |
| PR 10 | D-12 — `StrictHostKeyChecking=accept-new`; improved, not closed |
| PR 31 | D-20 (relay tests on fixed ports), D-28 (`esmRequire` vs ESM on cycles) |
| PR 32 | D-33 — 178 `no-unused-vars` warnings |
| PR 33 | D-27 (vacuous `typeof` guards), D-30 (`minify: false`) |

Closed this session: **D-31, D-34, D-35** (PR 12), **D-36** (PR 13).

**Three of those four could not have been seen before the structural change that found
them** — which is the pattern to remember:

- **D-34** — `game.frameCount` was set to `0` and **never incremented**, so every
  `frameCount % N === 0` throttle in the render loop was permanently true. Six paths ran
  every frame instead of throttled: `sendMove` at ~60Hz not ~20Hz, `TIME_SYNC` at 60/sec
  not 2/sec, `updateHotbarUI` rebuilding nine `<canvas>` elements per frame. Found by
  folding scattered `game.*` assignments into one declared shape. **All 152 e2e assertions
  passed over it**, same as D-32 in PR 11.
- **D-35** — nothing had enforced "one `window.*` assignment in `src/`" since PR 11 deleted
  `check-globals.js`. `PR11_HANDOFF.md` §2 and its landmine list both claim
  `eslint.config.mjs` allowlists it by path. **It does not** — assigning to a property of a
  readonly global is not a lint error under any rule.
- **D-36** — `refactor.md` §8.4's `Game.init()` step list did not match the order the code
  runs in, in the block that tells PR 17 "preserve the existing ordering exactly".

**The standing process rule applies to every PR:** every bug found gets a row with a
severity and an owner, and either a fix in the current PR or an explicit slot in
`refactor.md`. "Documented and unowned" is not an end state.

---

## 4. PR 14 is next, and the groundwork is already done

`refactor.md` §8.1 — *reconcile the duplicate managers, do this first.* §3.4 is the
constraint: `main.js` carries `BrowserCharacterManager` (L105, ~130 lines) and
`BrowserWorldManager` (L470, ~190 lines), and `src/game/entities/{CharacterManager,
WorldManager}.js` (388 + 466 lines) are tested equivalents that **`main.js` does not use.**
§3.4 requires an explicit reconcile-or-delete ruling, recorded.

**PR 13 did the comparison rather than leaving it for you.** Here is what it found. This
is the whole reason to read this section before writing code.

### 4.1 Option A is right, and the tested classes are near-supersets

Make `main.js` use `src/game/entities/CharacterManager.js` and `WorldManager.js`, delete
both `Browser*` classes, port what is browser-only. Option B (delete the tested files and
their tests) throws away the only coverage either class has.

The tested classes already have everything the browser ones do, plus `setInventory` /
`getInventory` / `setSpawnPoint` / `getSpawnPoint` / `serialize` / `deserialize` /
`getQuestProgress` / `advanceQuest` / `addChunkReference` / `CHARACTER_COLORS` /
`generateBiomeMap`. **Five divergences are all that stand in the way**, and every one is a
decision, not a merge:

| # | Divergence | Why it matters |
|---|---|---|
| 1 | **`this.storage` (tested) vs `this.persistence` (browser)** | Two live call sites: `main.js` step 11 reads `characterManager.storage` (**D-37** — always `undefined` today) and `savePlayerState` reads `characterManager.persistence`. Exactly one name survives; fix **both** sites |
| 2 | **`selectCharacter` is sync in the browser class, `async` + persists `lastPlayed` in the tested one** | Every call site already `await`s, so the switch is safe — but it adds an IndexedDB write per character selection that did not happen before. Same for `selectWorld` (that one already persists in both) |
| 3 | **Max world-name length is 32 in the browser class, 16 in the tested one** (**D-38**) | `test_worldManager.js:114` asserts `MAX_NAME_LENGTH === 16`, and the tested `WorldManager` **imports that constant from `CharacterManager.js`** — a *character*-name limit reused for worlds. Switching silently tightens world names 32 → 16 and makes a 20-character world unrenameable |
| 4 | **`BrowserWorldManager.deleteWorld` deletes the world's chunks and manifest from IndexedDB; the tested one does not** | This is the **D-18 fix and the H-3 fix**, both shipped in PR 6c/6d, with the key-range and `ChunkManager.openDatabase()` reasoning in a 25-line comment at `main.js:584`. **Losing it silently re-opens a data leak.** It cannot move into `WorldManager.js` as-is — that file is imported by Node tests and must stay environment-free. The natural home is **`PersistenceManager.deleteWorld()`** (`src/engine/world/Persistence.js:188`), which is the browser storage backend and already owns the localStorage half of the same operation; check for an import cycle with `ChunkManager` before committing to it |
| 5 | **`getBiomePreview` (browser, `{biomes, seed}`) vs `getWorldPreview` (tested, `{biomes, seed, chunkCount}`)** | One call site, `createWorldSlotElement`. The tested one is a superset |

Also: the tested `createCharacter` / `deleteWorld` wrap storage calls in `try/catch` and
return `{success:false, error}` where the browser ones throw; and `init()` is idempotent
via `_initialized`. Both are improvements, but they change what a failing IndexedDB write
looks like to the UI — worth one line in the outcome.

### 4.2 What to verify, and what will not tell you anything

`npm run test:e2e` exercises **create character → create world → enter → reload → re-enter**
on both hosts, so the create/select/persist paths are covered by 166 assertions. It does
**not** exercise `deleteWorld`, `deleteCharacter`, `updateCharacter` or the rename modals.
Those four are where PR 14's risk actually is, and the honest options are (a) drive them in
`saveLoad.js` — the harness already clicks through these modals to create things, so
deleting is the same idiom, and it would close divergence 4 by measurement rather than by
reading; or (b) say plainly in the outcome that they are unverified.

**Do not skip the delete path.** It is the one carrying a shipped data-integrity fix.

---

## 5. Things that are true and easy to break by accident

- **`test/run_tests.sh` globs `test/test_*.js` — flat, non-recursive.** That is the only
  reason `test/e2e/` is invisible to `npm test`. Never name anything in `test/e2e/`
  `test/test_e2e*.js`, and never make that glob recursive.
- **`test/run_tests.sh` runs `node -r ./test/helpers/esmRequire.js`.** Without it every
  test that requires a source file dies on *"Cannot use import statement outside a
  module"*. `test/e2e/saveLoad.js` requires the hook directly for that reason.
- **The two worker files must stay classic scripts.** `eslint.config.mjs` lints them with
  `sourceType: 'script'` so an accidental `import` is a parse error at lint time rather
  than a silent Blob-worker failure. The pools fall back to main-thread generation and only
  `console.warn`; `saveLoad.js` asserts that warning never fires.
- **`publicDir` is `false` and must stay that way.** `textures/` is 118 MB across 3,370
  files; Vite copies `publicDir` into `dist/` on **every** build.
- **`QUARANTINE.md` holds 4 files against a cap of 5, all owned by PR 26.** Do not grow it.
- **`waitForQuiesce` exists for a reason.** `#hud` loses `.hidden` long before
  `checkRegion(0,0)` finishes its 33×33 pre-generation. Polling until three consecutive
  chunk counts agree is what lets the round-trip assertions compare **exact** counts. Do
  not replace it with a sleep, do not weaken counts to inequalities.
- **Chunks flush on a 5 s dirty timer**; player state saves every 30 s, on Escape, and on
  `game.stop()`. `DEPLOY.md` §7 has the timing table. **The new block-edit assertions call
  `chunkManager.flushDirty()` directly**, because the game is paused at that point in the
  run and `resumeGame()` is what restarts the interval — waiting would be waiting on a
  stopped timer.
- **The e2e run asserts `git status --porcelain` is byte-identical before and after.** If
  the harness writes anything, that goes red and it is right to.
- **A stale `vite` on the fixed port makes a green run a lie** — that has happened twice.
  `viteServer.js` uses `--strictPort` and fails loudly. Kill the stale process; do not
  switch to an ephemeral port.
- **Never weaken an assertion to make a run pass.** If a defect-asserting block goes red
  because you fixed the defect, rewrite it into the assertion the fix makes true, in the
  same PR.
- **Screenshots are a self-comparison baseline only.** SwiftShader is not a GPU.
- **When editing `main.js` mechanically, parse it with `acorn` afterwards.** `node --check`
  reported a brace-imbalanced version of the un-nested file as valid during PR 13 (it
  re-parses as ESM on failure); `acorn.parse(src, {sourceType:'module'})` caught it. ESLint
  catches it too. Do not trust `node --check` on this file.

---

## 6. Acceptance criteria for whatever comes next

- `npm test` stays at 52/52 + 4 quarantined, exit 0.
- `npm run lint` stays at **0 errors**. Warnings may not grow without a `BUGS.md` note.
  Do not disable `no-undef`.
- `npm run build` stays at exit 0.
- `npm run test:e2e` and `npm run test:e2e:vite` stay at 0 failures and stay **equal to
  each other**. If the count changes, say by how much and why, in the same PR.
- `QUARANTINE.md` stays at 4 files.
- `git status` clean after every gate run.
- CI green on push, **zero annotations**.
- Every bug found gets a `BUGS.md` row with a severity and an owner PR, in the same commit.

---

## 7. The Phase 2 gate

`refactor.md` §7 has no gate box list of its own; its deliverable is *"`renderLoop` reads
state from an object, not from ~184 closure locals. No files split yet."* Both halves hold:

- **`renderLoop` reads `state.x` and nothing else.** It is declared at `main.js` top level,
  so the criterion is structural rather than asserted — it *cannot* close over a
  `startGame` local, because none is in scope. Its remaining free names are `state`, module
  imports, and four `main.js`-level bindings §13 already assigns elsewhere.
- **No files were split.** `main.js` is 5,155 lines and still contains everything it did.
  `src/core/GameState.js` is the one new file.

**Do not tick a deploy box anywhere.** Decision 20.
