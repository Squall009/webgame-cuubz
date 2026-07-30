# PR 6b Handoff — Phase 0 is done. Start Phase 1, or clear the backlog first.

**Status:** PR 6b is **landed and pushed**. `refactor/phase-0` is at `0889448`, CI green
(30 s, 0 annotations). Nothing is in progress and nothing is half-finished.
**Parent doc:** `refactor.md` §5 PR 6b — the full outcome write-up lives there, not here.
**This document is a starting point for the next session, not a record.** The record is
`refactor.md` and `DEPLOY.md`.

---

## 0. Where things stand in one screen

```bash
git log --oneline -3
#   0889448 fix(PR6b): D-14 broken quit path, D-16 inverted day/night label
#   a7f0543 test(PR6b): browser harness for the DEPLOY.md §7 save/load gate
#   2cedfd2 docs(PR6): DEPLOY.md — deploy path, data invariants, save/load checklist

npm test                  # 50/50 passing, 4 quarantined, exit 0
npm run check-globals     # 0 duplicates, 65 files, 368 symbols, exit 0
npm run test:e2e          # 112 assertions, 0 failures, exit 0  (~5 min, real browser)
git status                # clean
```

Three gates, all green. `npm test` and `check-globals` run in CI on every push;
`test:e2e` is local-only and deliberately so (see §4).

**Branch state:** all eight Phase 0 commits live on `refactor/phase-0`. `origin/main` is
still at the PR 1 baseline `27959d3`. **No PR has been opened.** The
`pre-refactor-baseline` tag is **still local only** — `git ls-remote --tags origin`
returns nothing. That is an open PR 1 acceptance criterion and the only usable
deploy-rollback target (`DEPLOY.md` §6.2), so it is the cheapest high-value thing on
this list.

---

## 1. Rulings already made — do not re-litigate

1. **`DEPLOY.md` §2 is authoritative for storage.** `refactor.md` §1.5 is superseded and
   says so. Every string and number in §2 is now verified against a running browser, not
   just against source text.
2. **Do not increment `DB_VERSION`.** `onupgradeneeded` deletes every object store
   (`chunkmanager.js:264-276`). H-2. It is a one-character change with total player data
   loss as its effect.
3. **Never renumber `BLOCK_REGISTRY`.** Numeric ids are baked into every saved chunk.
   Append at the end. PR 4 already navigated this by moving a *new* block to id 192
   rather than shifting 32 existing ones.
4. **Do not run `./sync.sh` between PR 7 and PR 10.** `sync.sh` excludes `dist/`, so a
   deploy in that window ships a site with no JavaScript. `DEPLOY.md` §4.3.
5. **Do not `npm install three`.** Pin `three@0.134.0` exactly; that is PR 8's job.
   `refactor.md` §1.2. The harness asserts `THREE.REVISION === 134`, so breaking the pin
   turns `test:e2e` red.
6. **Defect-asserting tests are a deliberate pattern, not a smell.** See §5.

---

## 2. What PR 6b actually delivered

- **`test/e2e/saveLoad.js`** — drives `DEPLOY.md` §7 in a real browser. 112 assertions.
- **`test/e2e/staticServer.js`** — ~90-line dependency-free static server, so the harness
  does not depend on the dev server PR 7 introduces.
- **`npm run test:e2e`**, `playwright-core` devDependency, `test/e2e/artifacts/`
  gitignored.
- **Three bug fixes** (see §3).
- `DEPLOY.md` §2.4 / §7 / §7.1 / §7.2 / §8 / §9 and the `refactor.md` PR 6b outcome.

**Nine of fourteen §7 steps are automated:** 1, 2, 3, 5, 6, 7, 10, 11, 14, plus every
`DEPLOY.md` §2 invariant. Both load-bearing steps hold for terrain — chunk `"0,0"` is
byte-for-byte identical with `savedAt` unchanged after a reload (step 6) **and** after a
quit-to-menu with no reload (step 7).

**The design decision worth inheriting: storage inspection, not input simulation.**
`page.evaluate` reaches all 368 top-level lexical symbols (`BLOCK_TYPES`,
`ChunkManager`, `CHUNK_MAGIC`, `BLOCK_REGISTRY`, …) even though none are `window`
properties — a top-level `const` in a classic `<script>` is a global lexical binding
(`refactor.md` §2.4). It **cannot** reach live game state: only four things are on
`window` and all four are classes; the running `renderer` / `chunkManager` / `player` /
`inventory` are among `refactor.md` §1.6's ~184 closure locals inside `startGame()`'s
`setTimeout`. So every persistence assertion reads IndexedDB and localStorage directly.
**That is why H-1 is provable with no pointer lock at all** — it is a storage bug, so it
is visible in storage.

---

## 3. Bugs found by the harness — three fixed, one open

| ID | What | Status |
|---|---|---|
| — | `js/main.js:4865,4878` logged `=== AUTO-REJOIN COMPLETE ===` and `=== INIT COMPLETE ===` through `console.error`, so **every successful page load reported two console errors** | **FIXED** → `console.info`. `js/util/logger.js` is correct and untouched: `CuubzLogger.log` is `console.log` gated on `DEBUG = false`, silent in production, which is exactly why someone reached for `console.error`. **Do not "fix" the logger.** |
| **D-14** | `js/main.js:4562` called `game.playerSync.reset()`, which does not exist on `PlayerSyncManager` (`reset()` belongs to `PingTracker`). **Every "Exit to Menu" threw**, skipping six cleanup steps and `showScreen('mainMenu')` — blank page, F5 the only way out. Broken since `playerSync` was wired in; nothing exercised the quit path | **FIXED** — call deleted. `clearAll()` was already the whole teardown |
| **D-16** | `#pause-pause-time` was labelled "Pause Time of Day", `checked` by default, while `main.js:4693` sets `checked = !skybox.timePaused` — checked meant time was **running** | **FIXED** — relabelled to "Day/Night Cycle" on the owner's decision. Zero behaviour change; inverting the logic would have started every existing player's cycle paused |
| **D-15** | `chunkBinaryCodec.js:63` sizes the buffer as `HEADER_SIZE + blockRuns.length * 4`, but a run is *two* `Uint16`s. **Every stored chunk is exactly 2× its needed size** — 24,156 allocated / 12,088 used, ≈14 MB of zeroes per world | **OPEN** — see §6 |

---

## 4. Things that are true and easy to break by accident

- **`test/run_tests.sh:46` globs `test/test_*.js` — flat, non-recursive.** That is the
  only reason `test/e2e/` is invisible to `npm test` and to CI. **Do not name anything in
  `test/e2e/` `test/test_e2e*.js`**, and do not "helpfully" make that glob recursive.
- **`test:e2e` is not in CI on purpose.** `ubuntu-latest` has no Edge, and a Chromium
  download plus SwiftShader rasterisation turns a 26 s job into minutes. It is recorded as
  a comment in `.github/workflows/ci.yml` naming **PR 10** as the earliest sensible owner
  — following PR 5's idiom for `npm run build` / `npm run lint`. **Do not add it as a step
  that fails, and do not wrap it in `|| true`.**
- **The harness needs Edge.** `chromium.launch({ channel: 'msedge' })` with
  `--use-angle=swiftshader --enable-unsafe-swiftshader --no-sandbox`. `playwright-core`
  downloads no browsers — that is why it is `playwright-core` and not `playwright`, whose
  postinstall pulls ~300 MB.
- **Screenshots are a self-comparison baseline only.** SwiftShader is not a GPU.
  `test/e2e/artifacts/` is useful as PR 9's "zero visual change" gate against another
  SwiftShader run; it is **not** evidence the game looks correct on real hardware.
- **Portability property worth preserving** (PR 5's audit): no `os.tmpdir` / `homedir` /
  `process.platform` in Node-executed code. `saveLoad.js` and `staticServer.js` use only
  `__dirname`-relative paths.
- **`waitForQuiesce` exists for a reason.** `#hud` loses `.hidden` long before
  `checkRegion(0,0)` finishes pre-generating its 33×33 region, so a fixed sleep catches a
  partly-generated world and produces a false "chunks appeared after a reload" failure.
  Polling until three consecutive chunk counts agree is what lets the round-trip
  assertions compare **exact** counts. Do not replace it with a sleep, and do not weaken
  the counts to inequalities.

---

## 5. Why two tests assert that bugs exist

`H-1` and `D-15` are asserted **as defects**, each block headed
`ASSERTING A KNOWN DEFECT` with the fix and the replacement assertion written beside it.

This is a gate, not an allowlist: **a run goes red if a new failure appears OR if a known
failure stops reproducing.** So fixing either turns `test:e2e` red on purpose, and that is
the signal to rewrite the block into the assertion the fix makes true.

**D-14 already demonstrated the full lifecycle inside PR 6b** — asserted as a defect,
then fixed, and its block is now the real §7 step-7 round trip. Copy that pattern.

The alternative — a harness that exits 1 from birth on pre-existing bugs — is
`refactor.md` §1.1 all over again, and PR 4 already paid to get out of it.

---

## 6. The backlog, in the order I would clear it

Nothing here blocks Phase 1 mechanically. Items 1–2 are cheap; 3–4 are real work that
needs an owner's decision first.

### 1. Push the tag, open the PR, fast-forward `main` — minutes
```bash
git push origin pre-refactor-baseline
gh pr create --base main --head refactor/phase-0
```
Open PR 1 criterion, and `DEPLOY.md` §6.2's rollback procedure has no target without it.
**Decision needed:** whether to squash Phase 0 into `main` or merge the eight commits.

### 2. Tick the Phase 0 gate — a judgement call, not a task
`refactor.md` §5's seven checkboxes are **all still unticked**, deliberately. Six are
now substantively true. The seventh, *"Manual save/load test passes"*, is the judgement
call: nine of fourteen steps are automated and green, two are blocked on Phase 2, and
**H-1 is a confirmed live data-corruption bug**. Whether a gate with a known corruption
bug counts as *passed* is the owner's call. Do not tick it unilaterally.

### 3. H-1 — the migration PR. **Highest severity open item.**
Chunk primary keys are not world-scoped, so worlds cross-contaminate. **Confirmed by
observation, not inference** (`DEPLOY.md` §7.1): one visit to a second world destroyed
**1,073 of the first world's 1,184 saved chunks**, and re-entering the first world served
the second world's spawn chunk byte for byte.

Two routes, and they compose:

- **Cheap partial mitigation, shippable first.**
  `manifest.generatedChunks[].checksum` is the chunk header's own FNV-1a, read straight
  out of the encoded buffer at offset 16 (`chunkmanager.js:649`). So a manifest-vs-record
  checksum mismatch **identifies a contaminated chunk exactly** — and nothing compares
  them on load. Verify on load, regenerate on mismatch. That degrades corruption into
  regeneration without touching the key format or writing a migration.
- **The real fix.** World-scope the primary key. This changes `chunkKey`, which is itself
  a `DEPLOY.md` §2.1 invariant, so **every already-saved chunk is orphaned without a
  migration**. Needs its own test plan. The harness's H-1 block becomes the regression
  test — invert its assertions.

### 4. D-15 — the 2× chunk allocation
One-line fix (`blockRuns.length` → `blockRuns.length / 2` in the size calculation), but
it changes the stored byte length and checksum of every future chunk, i.e. a §2.2
on-disk-format change. Backward compatible in principle — `decode()` never consults the
buffer length and stops at `blockRunCount` — but it wants its own PR and its own
verification, not a ride along in something else. Halves IndexedDB footprint and halves
every 5 s flush's write volume.

### 5. Still-open decisions carried from PR 5 and PR 6
- **`SurvivalSystem`** default spawn `{x:0, y:20, z:0}` vs `SpawnManager`'s `SEA_LEVEL+4`
  (68) — y=20 is 44 blocks underground. Latent: `onDeath`/`onRespawn` are not wired to
  anything in production.
- **Four relay tests bind fixed ports** (18765 / 18770 / 18780 / 18790) with no
  `on('error')`. Fine in practice — sequential, separate processes — but an occupied port
  dies on an unhandled `EADDRINUSE` with a misleading message.
- **D-8** — `server/index.js:219-225` routes `uncaughtException` /
  `unhandledRejection` into `process.exit(0)`, so `Restart=on-failure` never fires and
  the relay **stays down** after an unhandled error. Unowned.
- **D-10** — `ExecStart` hardcodes `node-v22.22.0` by absolute path; CI validates 22.23.x.

---

## 7. If you are starting Phase 1 (PR 7 — Vite skeleton)

Read `refactor.md` §1.3, §1.4 and §6 PR 7 first. The three things that will bite:

1. **Web Workers are `fetch` + Blob, not `new Worker(url)`.** `chunkmanager.js` builds
   both worker pools by fetching source text and wrapping it in a Blob. That breaks under
   Vite. §1.3.
2. **`sync.sh` excludes `dist/`.** From PR 7 onward a deploy ships no JavaScript. PR 10
   owns the fix and **must land with PR 9, not after**. §1.4 / `DEPLOY.md` §4.3.
3. **`index.html` loads 65 individual `<script src>` tags**, and `check-globals.js`
   parses exactly that list. Whatever PR 7 does to `index.html`, keep that gate working —
   it is what stops the eight global collisions from PR 3 coming back during migration.

**Run `npm run test:e2e` before and after PR 7.** It is the parity baseline: it asserts a
clean load with zero console errors, `THREE.REVISION === 134`, every storage invariant,
and byte-identical terrain across both round trips. That is precisely the "identical game,
zero visual change" claim Phase 1 rests on, and it is now a script rather than a promise.

---

## 8. Acceptance criteria for whatever comes next

- `npm test` stays at 50/50 + 4 quarantined, exit 0.
- `npm run check-globals` stays at 0 duplicates.
- `npm run test:e2e` stays at 0 failures — or goes red **only** because a
  defect-asserting block was fixed, in which case rewrite that block in the same PR.
- `QUARANTINE.md` stays at 4 files against its cap of 5, all owned by PR 26. **Do not
  grow it to make anything green.**
- `git status` clean after every gate run.
- CI green on push, zero annotations.
