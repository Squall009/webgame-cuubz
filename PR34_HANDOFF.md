# PR 34 Handoff — the refactor is finished. PR 35 is a new slot, and §4 is its inventory.

**Read this first:** the owner ruled on 2026-07-30 (`BUGS.md` **decision 20**) that **nothing
deploys to `10.0.30.160` until the entire rewrite is finished.** The rewrite is finished now. The
deploy is the owner's call and **it has still never been executed** — the delta between this branch
and anything that has ever run on the host is the whole refactor. `./sync.sh --dry-run` is green
and is the only thing that has ever been run; **§5 is what a first deploy should expect.**

**Read second:** `refactor.md` **§8.7** — the plan was collapsed from 17 remaining PRs to 7
(**decision 32**). All seven have landed. **Nothing is renumbered**; absorbed PRs keep their
headings marked **ABSORBED**, and **PR 21's `EventBus` and PR 28/29's component framework were
dropped outright. Do not build them.**

**Status:** `refactor/phase-0` at **`ec7f45a`**, pushed, CI green with **zero annotations**. Tree
clean. Nothing in progress. **Phases 0/1/2/3/4/5/6 are all CLOSED.** `PR26_HANDOFF.md` is
superseded; `PR20_HANDOFF.md` §5 is spent (PR 34 acted on it).

---

## 0. Where things stand in one screen

```bash
git log --oneline -4
#   ec7f45a  feat(PR34): decision 68 — the five deferred gameplay subsystems are deleted
#   c54cb0e  feat(PR33): shared/protocol.js, server/ becomes ESM, the typeof sweep, minify
#   d4ff225  feat(PR33): D-77 — mob rendering was disabled by two constant typeof guards
#   1a1bb59  feat(PR31): Vitest replaces the bash runner; 58 files restructured

npm test                  # 55 files, 114 tests, 0 failed, exit 0        (CI)
npm run test:count        # 5,467 assertions, 55 of 55 files reporting
npm run lint              # 0 errors, 121 warnings, exit 0   (CI runs lint:ci = --quiet)
npm run build             # exit 0
npm run test:e2e          # 189 assertions, 0 failures  (~7 min, builds first, serves dist/)
npm run test:e2e:vite     # 189 assertions, 0 failures  (~6 min, npm run dev, Edge)
npm run test:e2e:mp       # 70 assertions, 0 failures   (~70 s, real relay + two contexts)
./sync.sh --dry-run       # exit 0
git status                # clean
```

**`npm test` NOW RUNS FROM POWERSHELL.** The Git-Bash-only constraint is gone — `package.json`
calls `vitest run`, a Node binary. `ci.yml`'s `shell: bash` pin on the test step and the four
warnings about it were deleted in PR 31. **If you find that constraint written down anywhere else,
it is stale.**

**189 on both e2e hosts, unchanged since PR 17.** That equality is the proof that the built bundle
and the dev server are the same game. **`test:e2e:mp` is a THIRD entry point** (decision 65) and is
deliberately not part of that pair.

**Branch state:** `refactor/phase-0`, pushed. **`origin/main` is still at the PR 1 baseline
`27959d3`** — deliberately; the owner merges. **PR #1 is open and stays open.**
`pre-refactor-baseline` is pushed.

---

## 1. What PR 31, 33 and 34 did

**PR 31 — the bash runner and the `require` hook are gone.** All 58 test files moved to
`test/unit/{core,engine,game,ui,multiplayer,util,server,meta}/` and `test/integration/`, bodies
**verbatim and un-reindented** inside one `it()` each (decision 60), `process.exit` shimmed into the
verdict with a **no-verdict-is-a-failure** guard that caught three un-awaited async tails
(decision 62). `environment` is **`node`, not jsdom** (decision 61). **Every one of the 58 files
reports exactly the assertion count its pre-migration original reported**, measured file-for-file
against the legacy runner *before* deleting it. Closed D-20, D-28, D-47, D-48, D-73, D-79, D-80,
D-83.

**PR 33 — two commits.** D-77 landed **alone with the e2e pair as its gate**: two constant `typeof`
guards meant **no mob had been rendered since PR 9**. Then `shared/protocol.js` (27 keys replacing
two copies and 14 bare literals), `server/` → ESM, D-27's 30-site sweep, `minify` (**bundle
−46.5%**), and `ChunkMeshBuilder.js` 759 → 340. Closed thirteen rows.

**PR 34 — decision 68: the five deferred gameplay subsystems are deleted.** 3,788 lines of `src/`
and 1,645 assertions. See `refactor.md` §9's PR 34 outcome for the five-part reasoning.

**The adversarial pass found a real defect in all three, under five green gates each — that is now
EIGHT consecutive PRs, and in two of these three it was a regression the PR had just introduced**
(PR 33's sourcemap about to publish all of `src/` to the web root; PR 34's hurt-animation material
leak). **Run it before committing, never alongside the e2e pair.**

---

## 2. `BUGS.md` — nine open rows, all owned, none pointing at a landed PR

| Owner | Rows |
|---|---|
| **PR 35** | **D-33**, **D-68** (mob half), **D-70**, **D-86**, **D-89**, **D-90**, **D-93** |
| PR 10 (post-deploy) | D-12, **D-91** |

**Closed this session:** D-20, D-25, D-27, D-28, D-30, D-47, D-48, D-62, D-69, D-71, D-72, D-73,
D-74, D-75, D-76, D-77, D-78, D-79, D-80, D-81, D-82, D-83, D-84, D-85, D-87, D-88 (three of eight),
D-92. **D-53's long-standing anomaly is gone too** — it had sat in the Open table with a Fixed
status since PR 17 and is now in the Fixed table where it belongs.

**Nine new rows were logged and every one has an owner:** D-84 through D-93.

---

## 3. Rulings — nine new ones, do not re-litigate

`BUGS.md` has all **68**. **60–66 were made inside PR 31, 67 inside PR 33, 68 inside PR 34.** The
ones that bind whoever comes next:

1. **Decision 68 — the five subsystems are deleted.** This is the one ruling in the session that is
   a **product** call rather than a refactor call, and it was made because the owner was
   unavailable and the standing instruction is to decide. It removes four advertised features
   (survival meters, environmental damage, quests, bosses). **Everything is recoverable in one
   `git show`**, and a feature PR can restore any of it *with a design*. If the owner wants them
   back, that is a normal reversal, not a repair.
2. **Decision 60 — migrated test bodies are verbatim.** They are the original scripts inside one
   `it()`. Do not "tidy" them into `describe`/`expect`; there is no gate that can tell a faithful
   rewrite from a weakened one, which is the whole reason they were left alone.
3. **Decision 61 — `environment: 'node'`, NOT jsdom.** jsdom flips 28 `typeof window`/`document`
   guards in `src/` from false to true. Opt in per file with `new JSDOM()` in the body, the way
   `sessionUI.test.js` and `createEntity.test.js` do — **not** with the `@vitest-environment`
   pragma, which changes the environment for every module the file transitively imports.
4. **Decision 62 — `process.exit` is shimmed, first exit wins, and "no verdict" is a FAILURE.**
   Do not "fix" a `legacy suite finished without signalling` failure by deleting that check. It is
   telling you an async body is not being awaited.
5. **Decision 65 — `test:e2e:mp` is a third entry point.** Do not fold multiplayer assertions into
   `saveLoad.js`; its 189/189 equality is the parity proof.
6. **Decision 67 — `sourcemap: 'hidden'` AND `--exclude='*.map'`, and both `--exclude`s must stay
   BEFORE `tar`'s first `-C`.** GNU tar applies an exclude only to members named after it.
7. **Decision 21 — `src/testBridge.js` is PERMANENT.** PR 33 wrote the measurement into the file:
   `dist/`'s entry chunk has **zero `export` statements** and `import()`ing it starts a second
   application in the same page. The removal condition can never be met. **Stop treating it as
   pending.** `window.__cuubz` is still the only sanctioned `window` assignment in `src/`.
8. **Decision 44 — prototype mixins** are how a class with heavily-shared instance fields gets
   split, plus a **load-time collision guard**. Applied a fourth time in PR 33 (`ChunkMeshBuilder`).
9. **Decisions 30/33/45/57 — the 400-line ceiling wins and forces more files than any plan section
   names.** Applied seven times now.

Still true: **never renumber `BLOCK_REGISTRY`**; **`DB_VERSION` stays 2**; **do not
`npm install three`**; **`DEPLOY.md` §2 is authoritative for storage**; **never change
`'cuubz_last_session'`**; **Prettier reformats nothing**; **`publicDir: false`**; **CI lints with
`--quiet`**; **both Web Workers stay classic scripts**.

---

## 4. PR 35's inventory, banked so it is not re-derived

`refactor.md` **§15** is the slot. **It is not more refactoring** — PR 33 turned mob rendering on
(D-77) and everything that had been invisible became a live question in one commit.

### 4.1 The mob subsystem is the whole of it, and here is the measured state

`src/game/mobs/` is **live for the first time since PR 9.** Verified in a browser: both e2e hosts
stay at 189/0 with **zero console errors** after D-77, so it does not crash. What it does *badly*
was measured by executing the whole path in Node against real three 0.134 rather than by reading:

| What | Where | Status |
|---|---|---|
| attack + hurt animations never played | `mobAnimator.js:201`, `:222` | **fixed in PR 34** — they used the animator's monotonic lifetime clock, so `progress` was always 1 |
| the hurt flash leaked its material write | `hurtAnim.js` | **fixed in PR 34** as **D-92** — and it was PR 34's *own* regression, caught by the adversarial pass |
| `_buildCapsule` throws | `mobModelBuilder.js:200` | **deleted in PR 34** — `mergeBufferGeometries` is not a `BufferGeometry` method in any three version; fixing it needs the repo's first `three/examples/jsm` import, to serve zero call sites |
| **fog is applied twice** | `mobRenderer.js:117-147` | **D-88, open.** Materials carry `fog: true` in a scene with `FogExp2` *and* the manual pass pre-blends albedo. A deer measured `0x8B6348 → 0xA9DCFE` at ~60 blocks — mobs wash out earlier than the terrain behind them. **Probably delete the manual pass, not re-tune it** |
| **mob shadows will be speckled** | `VoxelRenderer.js:351` | **D-88, open.** The manual shadow-depth `overrideMaterial` discards on the **block atlas**'s alpha; mob primitives have full-square UVs, so they sample arbitrary atlas texels |
| **~960 extra `Object3D`s at `mobCap`** | `mobIntegration.js:38` | **D-88, open, and the one that could make D-77 feel like a regression.** 60 mobs × 9–16 separate meshes with individual materials, none merged or instanced, each rendered in three passes per frame, plus a per-frame traverse to mutate `material.color`. **Put a frame-time probe on this first** |
| `Game.stop()` does not destroy mob integration | — | **D-88, open.** Disposal happens only via `PauseMenu.js:271`'s `onExit`; `state.addTeardown` is the mechanism every other system uses |
| three animations move `group.position` and nothing survives | `mobRenderer.js:115` | **D-93, open.** The renderer sets position from `mob.position` every frame **immediately before** `animator.update()` |
| per-frame mob exceptions are swallowed after frame 10 | `WorldStep.js:219-221` | **D-89, open** |
| five biomes have no mobs | `mobDefinitions.js` | **D-68, open — a content call.** `test_mobBiomes` pins it as an assertion |
| mobs sink to the seabed | `mobMovement.js` | **D-70, open, and now player-visible.** D-56 correctly made water and lava passable; nothing replaces buoyancy/swim/drown |

**Do not reorder `mobManager.update()`'s two passes** to fix any of this. `mobAI.js:170` documents
why: the AI must see the same tick's movement and the renderer must see the AI's decision. The
animator accommodates the ordering; the ordering is correct.

### 4.2 The non-mob rows, and what each actually needs

- **D-90 (1) is a UI decision, not a bug fix.** `src/ui/css/responsive.css:163-167` declares a
  **3-column** mobile crafting grid that has never rendered — `screens/crafting.css` is import #28
  to responsive's #21 at equal specificity. Somebody designed a 3-column phone layout and somebody
  else designed a 9-column one. **And `crafting.css:237`'s "348px" arithmetic is only correct
  BECAUSE responsive's `gap` is dead**, so reviving that rule silently invalidates D-81 (2)'s fix.
- **D-90 (2)** — `Bootstrap.js:178-181` clears `chunkManager._uvLookupCache` on a texture-resolution
  change but not `_meshTablesCache`, and `ChunkMeshCoordinator.js:174` returns early once
  `uvFallbackSize > 0`. New coupling: D-74 made that payload atlas-derived.
- **D-90 (3)** — `ChunkMeshBuilder.js:325-338`'s mixin collision guard has **no regression test**.
- **D-86** — PR 31's migration residue, four inert items. The one with teeth is (3):
  **`test/unit/ui/pageLoad.test.js:77-80` scrapes `#id` tokens out of `test/e2e/saveLoad.js`'s raw
  TEXT, comments included** — a `#foo` placeholder written in prose turns a unit test red.
- **D-33** — 121 warnings, almost all `no-unused-vars`, and the remaining half is `src/`.
  **Do not close it with a `--max-warnings` ratchet.**

### 4.3 The test suite, so you can work in it

- `npm test` is `vitest run`. **From any shell.** `vitest.config.js` explains the four load-bearing
  settings; **`pool: 'forks'` and `fileParallelism: false` are mandatory**, not stylistic — five
  suites bind real sockets and one shells out.
- Migrated files are the original script body inside `it(name, () => legacy(async () => { … }))`.
  `test/helpers/legacy.js` and `test/setup.js` explain the verdict plumbing.
- **`__dirname` does not exist**; `test/helpers/paths.js` exports `TEST_DIR`, imported *as*
  `__dirname`, which is why every `path.join(__dirname, '..', …)` in a moved body still resolves.
  `__dirname` is deliberately **not** an ESLint global, so a stray one is a `no-undef` error.
- **New files are plain Vitest** (`describe`/`it`/`expect`) — they do NOT need `legacy()`. But they
  **must print a `Results: N/N passed, 0 failed` line from an `afterAll`** or `npm run test:count`
  exits non-zero. Copy `sessionUI.test.js`'s `record()` helper: it counts **only after** the matcher
  returns, so a failing assertion is never counted and the printed line cannot overstate.
- `test/e2e/**` is **excluded from the Vitest glob explicitly**. A recursive suffix glob would
  otherwise pick up the seven-minute browser harness.
- **`npm run test:count` is a gate, not a decoration.** It exits non-zero if any file reports no
  count. It has produced a transient `TOTAL: 0` once, immediately after another vitest invocation —
  it **failed loudly and correctly**; re-run it.

---

## 5. What a first deploy should expect — read before running `./sync.sh` for real

Nothing here has ever run against the host. `--dry-run` is green and proves the script parses,
resolves paths and packs the right tree; it proves nothing about the box.

- **The archive is 17 members**: `dist/*` (including `index.html` and `assets/`), `server/`,
  `shared/`, `cuubz-relay.service`. **`shared/` is new in PR 33 and is load-bearing** — every
  `server/*.js` imports `../shared/protocol.js`, and `WorkingDirectory=/var/www/html/server` in the
  unit file is what makes that resolve. Without it the relay does not boot, the site serves fine,
  and multiplayer is silently gone — **D-2's shape**.
- **`server/` is an ES module now** (`server/package.json` has `"type": "module"`), and `shared/`
  has its own `package.json` for the same reason. Without it Node warns on **every relay boot**.
- **`*.map` is excluded from the archive on purpose — decision 67.** The map carries
  `sourcesContent` for 148 files / 2,526,003 bytes.
- **`--dry-run` cannot exercise the textures branch** (**D-91**): `remote` returns 0 unconditionally
  under it, so the run always takes "Textures unchanged — skipped". The 118 MB / 3,370-file upload
  onto a clean box is the branch a **first** deploy takes and it is the one the dry run never
  reaches. Run `./sync.sh --textures` deliberately.
- `DEPLOY.md`'s rollback procedure was corrected in PR 33 — it had been telling the reader to run
  `npm run check-globals`, deleted in PR 11, and warning about a `PROJECT_NAME` leftover that
  cannot exist.

---

## 6. Things that are true and easy to break by accident

- **When you edit a file mechanically, parse it with `acorn`.** `node --check` reported a
  brace-imbalanced file as valid during PR 13. `sourceType:'module'`; `'script'` for the two Web
  Workers and `test/e2e/**`.
- **`no-undef` is the other half of that gate — run lint after every file you create.** **And it is
  BLIND TO `typeof`**, which is how D-77 kept a whole subsystem dead through 17 PRs. PR 33's sweep
  put those 30 sites under the rule for the first time.
- **A `**/` sequence inside a `/* */` comment closes the comment.** This bit three separate agents
  in one session.
- **Do not edit a tracked file while an e2e run is in progress.** The vite host serves the working
  tree; the run asserts `git status --porcelain` is byte-identical before and after.
- **A stale process on port 3100 or 8765 makes a green run a lie — nine occurrences.** PR 31 fixed
  the harness half (**D-83**): `viteServer.js` now refuses to start on an occupied port and kills
  the child as a **tree** (`taskkill /T /F` — on Windows `proc.kill()` reaps the `cmd.exe` shell and
  leaves the `node` grandchild holding the port; that was reproduced, pid for pid). **Still check
  before every run.**
- **Capture the FULL e2e output.** `| tail -3` does not contain the `Results:` line, and a run that
  died early looks identical to one that passed.
- **`page.waitForSelector('#modal.hidden')` waits for VISIBLE** and burns the full 30 s timeout.
  Use `waitForFunction` + `classList.contains`.
- **`waitForQuiesce` exists for a reason.** Do not replace it with a sleep, do not weaken exact
  counts to inequalities. `saveLoad.js` expects **exactly six** `.png` in `test/e2e/artifacts/`;
  `multiplayer.js` writes to `artifacts/mp/` **because** `saveLoad.js` deletes every `.png` in the
  parent directory at the start of its run.
- **Do not push a second commit while a CI run is in flight** — the workflow has a concurrency group
  on `refs/pull/1/merge`, so it **cancels** the running one and reports `cancelled` with one
  annotation reading *"Canceling since a higher priority waiting request exists"*. That looks like a
  red CI and is not.
- **`gh run list --limit 1` can return the PREVIOUS run** for up to a minute after a push. Match on
  `headSha`.
- **`src/` is CRLF and `test/e2e/` is LF.** This silently defeated three mechanical-edit scripts
  written in one session: a pattern written with `\n` matches nothing. Normalise on read.
- **Never weaken an assertion to make a run pass.** New assertions must be proved non-vacuous by
  breaking the thing they check — and **two of PR 34's own new assertions were vacuous on the first
  draft and were only caught by mutating**, not by reading. A hue-only probe reported "still
  flashing" for a frozen animation; an "at least once" probe stayed green under the mutant.
- **A green harness proves less than it looks like, and so does a green adversarial pass on the
  previous PR.** **Eight consecutive PRs have now had a real defect found by the adversarial pass
  after five green gates**, and in three of them it was a regression that PR had just introduced.

---

## 7. Acceptance criteria for whatever comes next

- `npm test` stays at **0 failed**, exit 0. `test/QUARANTINE.md` is **empty — do not grow it**.
- `npm run lint` stays at **0 errors**. Warnings may not grow above **121** without a `BUGS.md`
  note. Do not disable `no-undef`. Do not undo `lint:ci`'s `--quiet`.
- `npm run build` stays at exit 0 — **and `dist/` must actually run**, which `test:e2e` proves.
- Both e2e hosts stay at 0 failures and **equal to each other**. `test:e2e:mp` stays green. If any
  count changes, say by how much and why, in the same PR.
- CI green on push, **zero annotations**.
- Every bug found gets a `BUGS.md` row with a severity and an owner PR, in the same commit.
- **No extracted file over 400 lines.**
- **Outcome sections are a paragraph and a gate table, not an essay** (decision 32).

---

## 8. The Phase 6 gate

**Phase 6 — CLOSED. Every phase of the refactor is closed.**

| Box | State |
|---|---|
| the suite runs under one modern runner | **Yes — Vitest 4, 55 files, from any shell** |
| the `esmRequire` hook is gone | **Yes, both install sites** (D-79) |
| `test/QUARANTINE.md` empty or owned per entry | **Empty since PR 26, still empty** |
| `shared/protocol.js` is the one source of truth | **Yes — 27 keys; `server/` and `src/` import it, and `matchmaking.js`'s 14 bare literals are symbols** |
| the CommonJS shims are gone from `src/` | **Yes — PR 9 removed them; PR 33 confirmed 0 of each and swept the comments that still named them** |
| the `typeof` sweep | **30 of 32 removed; the 28 host-builtin feature detections stay, correctly** |
| `minify` | **On, with `sourcemap: 'hidden'` — bundle −46.5%** |
| `src/testBridge.js` deleted | **No, and that is the ruling — decision 21, now written into the file as permanent with the measurement behind it** |
| deploy verified | **NO — decision 20, deliberately deferred, not blocked. `./sync.sh --dry-run` is green and is the only thing that has been run** |
| `src/index.js` < 50 lines | **No — 104, deliberately open under decision 41.** PR 34 removed the three side-effect imports for the deleted modules; `Noise.js` and `testBridge.js` remain and are wanted |
