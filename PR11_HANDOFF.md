# PR 11 Handoff — Phase 1 is closed. `./sync.sh` has never been run. PR 12 is next.

> **AMENDED BY PR 12 — read [§7](#7-the-one-thing-to-do-before-writing-any-more-code--superseded)
> before acting on the deploy advice below.** The owner ruled on 2026-07-30 (`BUGS.md`
> decision 20) that **nothing deploys until the entire rewrite is finished.** The
> paragraph immediately following, and §7, both tell you to deploy. They are the record of
> what was true on 2026-07-30 before that ruling; they are not instructions any more.
> Everything else in this file still holds, except that PR 12 has since landed — see
> `refactor.md` §7 PR 12 for what changed and `PR12_HANDOFF.md` for the current state.

**Read this first, before anything else:** the deploy path was rewritten in PR 10 and
**not one line of its remote half has been executed.** `./sync.sh` now builds, deletes,
backs up, restarts the relay and verifies — from a workstation that has no SSH key for
`dadmin@10.0.30.160`. **Run `./sync.sh --dry-run` and read it before you deploy.** It
prints every remote command and connects to nothing. `DEPLOY.md` §9 lists the eleven
checks the first real deploy should confirm. This is the one Phase 1 gate box that is not
ticked, and it cannot be ticked from here.

**Status:** PR 9, PR 10 and PR 11 are **landed and pushed**. `refactor/phase-0` is at
`45028db`, CI green with **zero annotations**. Tree clean. Nothing in progress.
**Parent doc:** `refactor.md` §6 PR 9 / PR 10 / PR 11 — the full outcome write-ups live
there, not here. The previous handoff is `PR8_HANDOFF.md`; it is superseded except for its
§5, which is still the clearest list of things that are easy to break by accident.
**This is a starting point, not a record.** The record is `refactor.md`, `DEPLOY.md` and
`BUGS.md`.

---

## 0. Where things stand in one screen

```bash
git log --oneline -5
#   45028db fix(PR11): CI lints with --quiet, and the flat config is .mjs
#   8e7e915 feat(PR11): ESLint flat config + Prettier; retire check-globals; no-undef finds 2 real bugs
#   a392db7 feat(PR10): rewrite sync.sh -- build, delete, back up, restart, verify
#   838c03e feat(PR9): convert js/ -> src/ ES modules; one module entry; dist/ runs
#   4f07656 docs: PR8_HANDOFF.md — Phase 0 closed, Phase 1 half done, PR 9 is next

npm test                  # 52/52 passing, 4 quarantined, exit 0            (CI)
npm run lint              # 0 errors, 178 warnings, exit 0                  (CI runs lint:ci)
npm run build             # exit 0 — and dist/ RUNS now                     (CI)
npm run test:e2e          # 152 assertions, 0 failures  (~7 min, builds first, serves dist/)
npm run test:e2e:vite     # 152 assertions, 0 failures  (~6 min, npm run dev)
git status                # clean
```

`scripts/check-globals.js` **no longer exists.** It was deleted in PR 11 together with its
CI step; `npm run lint` is its replacement. Do not go looking for it.

**Branch state:** `refactor/phase-0` at `45028db`, pushed. **`origin/main` is still at the
PR 1 baseline `27959d3`** — deliberately; the owner merges. **PR #1 is open**
(`refactor/phase-0` → `main`) and is to be left open. `pre-refactor-baseline` is pushed
(`27959d3`).

**CI now runs once per push, not twice** (D-22 closed). `on: push` is narrowed to
`branches: [main]`, so a push to this branch produces exactly one `pull_request` run.

---

## 1. What Phase 1 actually did

| PR | Result |
|---|---|
| **7** | Vite skeleton. Config, scripts, a `build` step in CI, `test/e2e/viteServer.js`. Not one byte of `js/` changed |
| **8** | `three` pinned at `0.134.0` exactly, and `test/test_threePin.js` makes the pin a CI gate |
| **9** | **66 files `js/` → `src/` as ES modules.** `js/three.min.js` deleted, `js/` gone. `index.html`: 65 classic `<script src>` → one `<script type="module" src="/src/index.js">`. 368 symbols became exports; 62 CommonJS shims and all four `window.X =` assignments removed |
| **10** | **`sync.sh` rewritten.** Builds, ships `dist/`, deletes stale paths, backs up first, installs the unit, restarts the relay, verifies on the host. Eleven `BUGS.md` rows closed |
| **11** | ESLint 9 flat config with `no-undef: error`, Prettier as a script, `check-globals.js` deleted. `no-undef` found two real bugs on its first run |

**The two e2e hosts are now "built bundle" vs "dev server", not "raw source" vs "dev
server".** That is not a downgrade — a raw static server cannot serve this tree at all any
more, because `index.html` loads one ES module whose graph contains bare specifiers
(`import * as THREE from 'three'`). `test/e2e/staticServer.js` serves `dist/` with a
fallback to the repo root for `textures/`, which is exactly the two-artifact split PR 10
creates on the host. So **every `npm run test:e2e` is a rehearsal of the deployed layout**,
and D-24 ("the build succeeds and its output does not run") is closed by measurement.

**150 → 152 assertions.** One removed: `window.__THREE_LOAD_FAILED is not set` — the
script tag and the flag are both gone, so it would have asserted that a flag nobody can
set was not set. Three added: the module bundle evaluated (`window.__cuubz` exists), both
worker pools initialised, `navigator.hardwareConcurrency` is readable.

---

## 2. Rulings already made — do not re-litigate

`BUGS.md` has all nineteen in its decision table, each citing the rows that wait on it.
1–6 are the owner's from 2026-07-29; 7–10 the owner's from 2026-07-30; **11–15 were made
inside PR 9 and 16–19 inside PR 11**, under the standing instruction to decide rather than
stop. The ones that will bite if forgotten:

1. **`window.__cuubz` is the e2e bridge** (`src/testBridge.js`), and **PR 12 removes it.**
   Module-scoped `const`s are unreachable from `page.evaluate`; this is how the storage
   invariants stay checkable. Do not add to it casually and do not add a second one.
2. **Neither Web Worker is an ES module.** Both stay classic scripts built from `fetch` +
   Blob; only the paths changed, to `?url` imports. `workerGeneration.js` **must** stay a
   classic IIFE because the main-thread inline fallback evaluates the same file.
3. **`workerGeneration.js` keeps its triple contract** — IIFE, fetched for the worker,
   *and* evaluated on the main thread for the fallback (now a side-effect import from
   `src/index.js`). Owner's ruling: losing the fallback means a browser that cannot spawn
   a worker gets no terrain at all.
4. **`test/helpers/esmRequire.js` is how CommonJS tests require ES modules.** `refactor.md`
   §6 PR 9 step 3 ("keep the shim where a passing test needs it") is **impossible** —
   `require()` rejects `import` syntax before any shim runs. PR 31 deletes the hook.
5. **`TextureAtlas.js` fetches `/textures/…` absolutely**, not via `import.meta.env.BASE_URL`.
6. **`minify` stays `false`** and **the 28 remaining `typeof X !== 'undefined'` guards
   stay**, both now owned by **PR 33**, both with reasons in the decision table. Do not
   flip minify until a real deploy has happened.
7. **Prettier reformats nothing.** The tool ships as `npm run format`; running it over
   34,000 lines would touch every file right before Phase 2 moves all of them.
8. **CI runs `lint:ci` (`--quiet`), not `lint`.** GitHub renders every warning as a check
   annotation; 178 of them buries anything that matters.

Still true from earlier phases: **never renumber `BLOCK_REGISTRY`**; **`DB_VERSION` stays
at 2**; **do not `npm install three`**; **`DEPLOY.md` §2 is authoritative for storage**.

---

## 3. `BUGS.md` — nine open rows, all owned

| Owner | Rows |
|---|---|
| **PR 12** | **D-31** — Escape never closes the inventory (`inventoryOpen` is out of scope) |
| **PR 20** | **D-25** — twelve modules referenced by nothing, including 1,791 lines of never-instantiated audio |
| PR 22 | D-21 — `SurvivalSystem` spawn `y=20` |
| PR 10 | D-12 — `StrictHostKeyChecking=accept-new`; improved, not closed |
| PR 31 | D-20 (relay tests on fixed ports), D-28 (`esmRequire` vs ESM on cycles) |
| PR 32 | D-33 — 178 `no-unused-vars` warnings |
| PR 33 | D-27 (vacuous `typeof` guards), D-30 (`minify: false`) |

Closed in this session: **D-2, D-3, D-4, D-5, D-6, D-7, D-8, D-9, D-10, D-11, D-13**
(PR 10), **D-23, D-24, D-26** (PR 9), **D-22, D-29, D-32** (PR 11).

**Three bugs found that nothing before could have seen**, all by the module graph or the
linter — which is the argument for both:

- **D-32** (fixed) — `sumBase`/`sumAmp` assigned with no declaration in `BiomeSystem.js`.
  Sloppy mode made them globals for the life of the project; **an ES module is always
  strict**, so from PR 9 it was a `ReferenceError` in a function `main.js` calls twice per
  frame. Both call sites wrap it in `try{}catch{}`, so biome particle effects fell back to
  plains forever and biome-specific mob spawning got `undefined` for every chunk, with no
  console error — **all 152 e2e assertions passed over it.** Introduced by PR 9, caught by
  PR 11's `no-undef`, two commits apart. Remember this about what a green harness proves.
- **D-31** (open, PR 12) — the Escape handler tested `typeof inventoryOpen !== 'undefined'`
  for a `let` declared in a different scope, so the guard was permanently false.
- **D-25** (open, PR 20) — computing reachability from `src/index.js` showed twelve former
  script-tag files that nothing imports. The whole audio subsystem is among them.

**The standing process rule still applies to every PR:** every bug found gets a row with a
severity and an owner PR, and either a fix in the current PR or an explicit slot created in
`refactor.md`. "Documented and unowned" is not an end state.

---

## 4. PR 12 is next, and here is what will bite

`refactor.md` §7 PR 12 — *introduce `GameState` and migrate the render-loop locals.*
[§1.6](./refactor.md#16-renderloop-cannot-be-extracted-as-written) is the constraint:
`startGame()` (`src/main.js:2156`-ish) wraps everything in
`setTimeout(async () => { try { … } })`, about 1,845 lines sit at ≥10 spaces of
indentation, and `renderLoop` closes over **~184 local variables**. Phase 3 is impossible
until they are on an object.

### 4.1 Three things PR 12 is on the hook for that are not in its section

1. **Delete `src/testBridge.js`.** Its whole justification is that the harness cannot reach
   module-scoped bindings and there is nothing else on `window`. PR 12 puts a real `Game`
   there. When it does, move the harness onto it and delete the bridge — the file's header
   and `refactor.md` §7 PR 12 both say so, and `eslint.config.mjs` allowlists exactly one
   `window.*` assignment, at exactly that path.
2. **D-31 — make `inventoryOpen` reachable and restore the Escape behaviour.** The dead
   block is deleted with a comment naming the row; the fix is a one-liner once the local is
   on `GameState`. Do not re-add it as a `window` global.
3. **The two `⚠️ UNVERIFIED` steps in the e2e harness unblock here.** Placing a block needs
   pointer lock *and* a reachable `chunkManager` / `inventory` / `blockInteraction`. Once
   they are on `Game`, `place → flush → reload → assert the voxel` is a few lines in
   `saveLoad.js`, and `DEPLOY.md` §7 steps 4 and 6/7 stop being manual. That is the single
   biggest coverage win available and it has been waiting since PR 6b.

### 4.2 What the harness can and cannot see, right now

`page.evaluate` reads storage constants through `window.__cuubz` only. It **cannot** reach
any live game state: `renderer`, `chunkManager`, `player`, `inventory` are all closure
locals. Every persistence assertion in `saveLoad.js` therefore goes through IndexedDB and
localStorage rather than through the game. That shape is a consequence of §1.6 and PR 12 is
what changes it.

### 4.3 Do not break these while moving 184 variables

- **`waitForQuiesce` exists for a reason.** `#hud` loses `.hidden` long before
  `checkRegion(0,0)` finishes its 33×33 pre-generation. Polling until three consecutive
  chunk counts agree is what lets the round-trip assertions compare **exact** counts. Do not
  replace it with a sleep and do not weaken the counts to inequalities.
- **Chunks flush on a 5 s dirty timer**; player state saves every 30 s, on Escape, and on
  `game.stop()`. `DEPLOY.md` §7 has the timing table. A block that vanishes after an instant
  reload is not necessarily a regression.
- **The e2e run asserts the working tree is unchanged** (`git status --porcelain` before and
  after). If PR 12 makes the harness write anything, that assertion goes red and it is
  right to.

---

## 5. Things that are true and easy to break by accident

- **`test/run_tests.sh` globs `test/test_*.js` — flat, non-recursive.** That is the only
  reason `test/e2e/` is invisible to `npm test` and CI. Never name anything in `test/e2e/`
  `test/test_e2e*.js`, and never make that glob recursive.
- **`test/run_tests.sh` runs `node -r ./test/helpers/esmRequire.js`.** Without that flag
  every test that requires a source file dies on *"Cannot use import statement outside a
  module"*. If you add a new entry point that requires `src/`, it needs the hook too —
  `test/e2e/saveLoad.js` requires it directly for that reason.
- **The two worker files must stay classic scripts.** `eslint.config.mjs` lints them with
  `sourceType: 'script'` precisely so an accidental `import` is a parse error at lint time
  rather than a silent Blob-worker failure at runtime. The pools fall back to main-thread
  generation and only `console.warn` — the game still works, single-threaded, and passes
  every storage assertion. `saveLoad.js` asserts that warning never fires.
- **`publicDir` is `false` and must stay that way.** `textures/` is 118 MB across 3,370
  files; Vite copies `publicDir` into `dist/` on **every** build.
- **`QUARANTINE.md` holds 4 files against a cap of 5, all owned by PR 26.** Do not grow it
  to make anything pass.
- **`test:e2e` and `test:e2e:vite` are not in CI on purpose.** `ubuntu-latest` has no Edge.
  `ci.yml` records this in a comment naming the earliest sensible owner. Do not add a step
  that fails and do not wrap one in `|| true`.
- **A stale dev server will make a green run a lie.** `viteServer.js` uses a fixed port with
  `--strictPort` because an old `vite` once answered while the new one failed to bind, and
  the run tested stale code and passed. It happened again in this session and `--strictPort`
  caught it. Do not "fix" it to an ephemeral port; kill the stale process.
- **Never weaken an assertion to make a run pass.** If a defect-asserting block goes red
  because you fixed the defect, rewrite it into the assertion the fix makes true, in the
  same PR. Two vacuous tests were found and repaired this session — `test_logger.js` (15
  assertions running against empty stubs) and the `__THREE_LOAD_FAILED` check — and both
  had been passing for months.
- **Screenshots are a self-comparison baseline only.** SwiftShader is not a GPU.

---

## 6. Acceptance criteria for whatever comes next

- `npm test` stays at 52/52 + 4 quarantined, exit 0.
- `npm run lint` stays at **0 errors**. Warnings may not grow without a `BUGS.md` note.
  Do not disable `no-undef`.
- `npm run build` stays at exit 0.
- `npm run test:e2e` and `npm run test:e2e:vite` stay at 0 failures and stay **equal to each
  other**. If the count changes, say why in the same PR.
- `QUARANTINE.md` stays at 4 files.
- `git status` clean after every gate run.
- CI green on push, **zero annotations**.
- Every bug found gets a `BUGS.md` row with a severity and an owner PR, in the same commit.

---

## 7. ~~The one thing to do before writing any more code~~ — SUPERSEDED

> **This section is obsolete. It said "deploy, or decide not to", and the owner decided
> not to.** `BUGS.md` **decision 20** (owner, 2026-07-30): nothing deploys to
> `10.0.30.160` until the **entire rewrite** is finished — not at the Phase 1 gate, not at
> the Phase 2 gate — and **PR 10's `sync.sh` stays unverified on purpose.** The rule was
> recorded in PR 12; `DEPLOY.md` §4.3 and `refactor.md`'s Phase 1 gate carry it in full.
>
> Do not run `./sync.sh`. Do not treat the unticked deploy box as blocked work.
>
> The section below is kept as the dated record it was — this file is a log, and D-29's
> ruling is that handoffs are not rewritten. What it got right is the cost, and the owner
> has accepted it explicitly rather than overlooked it: **the delta between this branch
> and anything that has ever run on the host grows with every PR, and the first real
> `./sync.sh` will be debugged against a codebase that has changed shape six times.**

**Deploy, or decide not to.** Phase 1's deliverable is "identical game, ES modules, working
build **and working deploy**". Four of the six gate boxes are ticked; the deploy box is not,
and every commit from here adds to the delta between what is on this branch and what has
ever run on `10.0.30.160`. The longer that gap grows, the harder the first real `./sync.sh`
is to debug — and `sync.sh` now deletes before it extracts, installs a systemd unit and
repoints which node binary production runs.

```bash
./sync.sh --dry-run      # prints every remote command, connects to nothing
./sync.sh                # then, for real
```

Then work through `DEPLOY.md` §9's unverified table. `DEPLOY.md` §5.2 lists the three ways
the node-symlink change can fail and the one-line fallback for each.
