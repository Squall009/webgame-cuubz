# PR 8 Handoff — Phase 0 is closed and ticked. Phase 1 is half done. PR 9 is next and it is the big one.

**Status:** PR 6d, PR 7 and PR 8 are **landed and pushed**. `refactor/phase-0` is at
`0717382`, CI green. Nothing is in progress and nothing is half-finished.
**Parent doc:** `refactor.md` §5 PR 6d and §6 PR 7 / PR 8 — the full outcome write-ups
live there, not here. The previous handoff is `PR6B_HANDOFF.md`; it is superseded by this
one except where noted. **This document is a starting point for the next session, not a
record.** The record is `refactor.md`, `DEPLOY.md` and `BUGS.md`.

---

## 0. Where things stand in one screen

```bash
git log --oneline -5
#   0717382 feat(PR8): pin three@0.134.0 exactly, and make the pin a CI gate
#   f35983c feat(PR7): Vite skeleton -- config, scripts, CI build step, no source changes
#   c3c060c test(PR6d): make the H-2 probe's byte comparison actually discriminate
#   f66d95a fix(PR6d): H-2 schema version ladder + H-3 single DB opener; D-23 cache-bust
#   8b67f22 fix(PR6c): H-1 world-scoped chunk keys + D-15 buffer size, one migration

npm test                  # 52/52 passing, 4 quarantined, exit 0      (CI)
npm run check-globals     # 0 duplicates, 65 files, 368 symbols, exit 0 (CI)
npm run build             # exit 0 — but see D-24, dist/ does not run   (CI)
npm run test:e2e          # 150 assertions, 0 failures, exit 0   (~6 min, local, Edge)
npm run test:e2e:vite     # 150 assertions, 0 failures, exit 0   (~6 min, local, Edge)
git status                # clean
```

**Branch state:** `refactor/phase-0` at `0717382`, pushed. **`origin/main` is still at the
PR 1 baseline `27959d3`** — deliberately; the owner merges. **PR #1 is open**
(`refactor/phase-0` → `main`, "Phase 0 — stop the bleeding") and is to be left open.
**`pre-refactor-baseline` is pushed** (`27959d3`) — that was an open PR 1 acceptance
criterion and it is closed.

**The Phase 0 gate in `refactor.md` §5 is ticked, all seven boxes**, each with the command
that verified it. The save/load box carries a footnote naming the three §7 steps that are
still manual and the PR that closes them. Read the footnote before citing the tick.

---

## 1. Rulings already made — do not re-litigate

The first six are in `BUGS.md`'s decision table with the rows that wait on each. All were
settled by the owner on 2026-07-29.

1. **Push the tag, open the PR, do not move `main`.** Done. The owner merges PR #1.
2. **Tick a gate box only if you ran the thing.** Done, with the save/load footnote.
3. **D-8 → non-zero exit code**, not `Restart=always`. PR 10.
4. **D-10 → resolve `node` from the environment**, do not pin a patch version by absolute
   path. PR 10.
5. **D-21 → `SurvivalSystem` spawns at `SEA_LEVEL + 4` (68)**, matching `SpawnManager`.
   PR 22.
6. **H-2 → a version ladder, and `DB_VERSION` stays at 2.** Shipping the mechanism and
   moving every player's database through it are separate risks. Done in PR 6d.

Carried from `PR6B_HANDOFF.md` and still true:

7. **`DEPLOY.md` §2 is authoritative for storage.** `refactor.md` §1.5 is superseded.
8. **Never renumber `BLOCK_REGISTRY`.** Numeric ids are baked into every saved chunk.
   Append at the end.
9. **Do not `npm install three`.** It is pinned at `0.134.0` exactly and
   `test/test_threePin.js` now fails in CI if that changes. §1.2.
10. **Defect-asserting tests are a deliberate pattern.** None are live right now — all
    three (D-14, D-15, H-1) completed the lifecycle. If you need one again, head the block
    `ASSERTING A KNOWN DEFECT` and write the replacement assertion beside it.

New rulings made in this session, recorded here so they are not re-opened:

11. **`vite` is not version-pinned** (`^8.1.5`). §1.2's pin is about `three`, where a minor
    bump changes every colour in the game. A build tool producing no deployed artifact does
    not need the same treatment.
12. **`publicDir: false`.** Vite copies `publicDir` into `dist/` on every build and
    `textures/` is 118 MB across 3,370 files (§1.8). Do not point it at `textures`.
13. **`staticServer.js` stays the e2e default**, with `--server=vite` as the second host.
    A harness that only runs against the thing it is validating is not a gate.
14. **`on: push` in `ci.yml` stays unfiltered for now** (D-22). Narrowing it while a
    refactor branch is the only branch being worked on removes the feedback loop the plan
    depends on. PR 11's call.

---

## 2. What the last three PRs delivered

- **PR 6d — H-2 and H-3.** `onupgradeneeded` is a version ladder: `SCHEMA_STEPS[v]` takes a
  database from `v-1` to `v`, steps only ever create, and an unregistered version throws
  and aborts the upgrade. `ChunkManager.openDatabase()` is the codebase's only database
  opener. Proved by incrementing `DB_VERSION` to 3 over a **seeded** version-2 database in
  a real browser and asserting every chunk and manifest survives field for field.
  `DEPLOY.md` §2.1's ⛔ is now a five-step procedure. Also **D-23**: 28 `?v=` cache-bust
  strings in `index.html` had gone stale across all of Phase 0.
- **PR 7 — Vite skeleton.** Config, four scripts, a `build` step in CI, and
  `test/e2e/viteServer.js` so the *whole* harness runs against `npm run dev`. Both hosts:
  150 / 0. Not one byte of `js/` or `index.html` changed. Found **D-24**.
- **PR 8 — the `three` pin.** `"three": "0.134.0"` exact, plus `test/test_threePin.js`,
  which checks the declared range, the installed package, the vendored bundle **and that
  the two copies agree** — the failure mode §1.2 actually describes.

---

## 3. `BUGS.md` — the ledger

**No row is unowned.** Open at this commit:

| Owner | Rows |
|---|---|
| **PR 7** (class-level fix) | D-23 — hand-maintained `?v=` cache-bust strings. *Mitigated*, not fixed; Vite's content hashing removes the class |
| **PR 9** | **D-24** — `npm run build` exits 0 and produces a `dist/` that cannot run |
| **PR 10** | D-2, D-3, **D-4**, D-5, D-6, D-7, D-8, D-9, D-10, D-11, D-12, D-13 — the entire deploy path |
| **PR 11** | D-22 — `ci.yml` runs twice per push on a PR branch |
| **PR 22** | D-21 — `SurvivalSystem` spawn `y=20` |
| **PR 31** | D-20 — four relay tests on fixed ports with no `error` handler |

Fixed and closed: H-1, H-2, H-3, D-1, D-14…D-19.

**The standing process rule still applies to every PR:** every bug found gets a row with a
severity and an owner PR, and either a fix in the current PR or an explicit slot created in
`refactor.md`. "Documented and unowned" is not an end state.

---

## 4. PR 9 is next, and here is what will bite

`refactor.md` §6 PR 9 is *"convert `js/` → `src/` ES modules, mechanical, in dependency
order"* and calls itself **the biggest PR in the plan**. It is 65 files and 368 top-level
symbols. Read §1.3, §1.6, §2.4 and §4.1 first. **PR 10 must land with it, not after**
(D-4).

### 4.1 The one nobody has written down yet: the e2e harness stops working

**This is the most important paragraph in this document.**

`test/e2e/saveLoad.js` reaches into the page with `page.evaluate` and reads **top-level
lexical bindings** — `ChunkManager`, `ChunkBinaryCodec`, `Chunk`, `BLOCK_TYPES`,
`BLOCK_REGISTRY`, `CHUNK_MAGIC`, `HEADER_SIZE`, `CHUNK_HEIGHT`, `MAX_WORLD_SLOTS`,
`PersistenceManager` and more. That works **only because they are classic scripts**: a
top-level `const` in a classic `<script>` is a global lexical binding (§2.4). **In an ES
module it is module-scoped and completely unreachable from `page.evaluate`.**

So the moment `index.html` becomes `<script type="module" src="/src/index.js">`, roughly
**a third of the 150 assertions stop being able to run at all** — including every
`DEPLOY.md` §2 storage invariant, the chunk-binary-header decode, the H-1 two-world
regression test, the H-1 migration check and PR 6d's `DB_VERSION` increment. The parity
baseline dies exactly at the PR whose entire claim is "identical game".

**Decide this before writing any conversion code, not after.** The options, cheapest first:

1. **A test-only bridge module.** `src/testBridge.js` imports the symbols the harness needs
   and assigns them to one namespace object, e.g. `window.__cuubz = { ChunkManager, … }`,
   imported from `src/index.js`. One file, one line per symbol, and the harness changes
   from `ChunkManager.key(...)` to `__cuubz.ChunkManager.key(...)`. It is a production
   file that exists for tests, which is a real cost — but it is a *smaller* cost than the
   alternative, and Phase 2 (PR 12–13) is going to put a real `Game` object on `window`
   anyway, at which point this collapses into that.
2. **Dynamic `import()` inside `page.evaluate`.** `await import('/src/chunkmanager.js')`
   works against the Vite dev server with no production change at all. It does **not**
   work against a built `dist/` with hashed filenames, so the harness would only be
   runnable in `--server=vite` mode — which contradicts ruling 13.
3. Rewrite those assertions to read raw IndexedDB and hard-code the constants. **Do not.**
   The assertions exist to catch a constant *changing*; hard-coding both sides makes them
   tautologies.

Whichever you pick, **write it down in the PR 9 outcome**, and expect the assertion count
to move. If it drops, say by how much and why.

### 4.2 `check-globals.js` becomes vacuous

The gate parses `<script src>` out of `index.html` and reports duplicate column-0
declarations across those 65 files. After PR 9 there is **one** script tag, so it scans one
file, finds ~0 symbols and exits 0 having checked nothing. It is currently in CI as a hard
gate and it is what stops PR 3's eight collisions coming back *during this very migration*.

Options: keep it pointed at `js/` until the last file moves (it takes the list from
`index.html`, so this means converting `index.html` **last**, which is the right order
anyway); or retire it in PR 11, where `no-undef` under ESLint flat config is the strictly
stronger replacement — §6 PR 11 already calls that "the payoff". **Retiring it silently by
making it scan one file is the failure mode to avoid.** If you retire it, delete the CI
step in the same commit, and say so.

### 4.3 The things §1.3 already warns about

- **Both worker pools are `fetch` + Blob, not `new Worker(url)`.** `chunkmanager.js`
  fetches `js/renderer/meshWorker.js?v=20260726-1` and wraps the source text in a Blob.
  The hardcoded `js/...` path breaks the moment files move.
- **`js/renderer/meshWorker.js` is in no `<script>` tag.** Vite will not emit it unless
  told to (`?worker` / `?url` / `new URL(..., import.meta.url)`).
- **`js/world/workerGeneration.js` has a triple contract**: an IIFE taking `globalScope`
  (×2 `typeof globalScope !== 'undefined'`), a `<script>` tag at `index.html:523` for the
  main-thread inline fallback, **and** it is fetched for the worker. Preserve it
  deliberately or remove it deliberately, and **say which in the outcome**.
- **`textureAtlas.js` fetches with relative paths** (`textures/blocks/manifest.json`,
  `textures/blocks/${base}.png`) which break if the base URL changes. §1.8.
- **`host.js` must now import `MESSAGE_TYPES`** — it never defined it. §3.5.
- **62 `typeof module !== 'undefined'` CommonJS shims** are what let `npm test` require
  these files at all. Deleting one breaks its test. §6 PR 9 step 3 says keep the shim only
  where a passing test needs it **and list those files**; the full move to ESM tests is
  PR 31/32.

### 4.4 Ordering, and the fact that PR 10 rides along

§6 PR 9's own rollback note is the right plan: if it must be split, split by directory —
`util/` → `world/` → `renderer/` → `systems/` → `multiplayer/` → `ui/` → `main.js` last —
**with a working game after each**. `index.html` converts last.

**PR 10 must land with PR 9.** From the moment `index.html` loads a bundle, `sync.sh`
excludes the only directory containing runnable JavaScript (D-4). If you land PR 9 without
PR 10, that fact belongs in the **first line** of the next handoff, because until PR 10
lands the owner's next deploy ships a site with no JavaScript.

Note that `DEPLOY.md` §4.3 was corrected in PR 7: **the JS-less-deploy window opens at
PR 9, not PR 7.** Deploying the source tree is still correct today.

---

## 5. Things that are true and easy to break by accident

- **`test/run_tests.sh:46` globs `test/test_*.js` — flat, non-recursive.** That is the only
  reason `test/e2e/` is invisible to `npm test` and to CI. Do not name anything in
  `test/e2e/` `test/test_e2e*.js`, and do not make that glob recursive.
- **`QUARANTINE.md` holds 4 files against a cap of 5, all owned by PR 26.** Do not grow it
  to make anything pass. PR 26 fixes the source-text tests (§3.6).
- **`test:e2e` and `test:e2e:vite` are not in CI on purpose.** `ubuntu-latest` has no Edge.
  `ci.yml` records this as a comment naming PR 10 as the earliest sensible owner, following
  PR 5's idiom. Do not add a step that fails and do not wrap one in `|| true`.
- **Never weaken an assertion to make a run pass.** If a defect-asserting block goes red
  because you fixed the defect, rewrite it into the assertion the fix makes true, in the
  same PR. PR 6d's probe is the counter-example worth remembering: it passed for the wrong
  reason (three identical all-air chunks share a checksum) and was strengthened rather than
  left alone.
- **A stale dev server will make a green run a lie.** `viteServer.js` uses a fixed port with
  `--strictPort` because an old `vite` answered while the new one failed to bind, and the
  run tested stale code and passed. Do not "fix" it to an ephemeral port.
- **`waitForQuiesce` exists for a reason.** `#hud` loses `.hidden` long before
  `checkRegion(0,0)` finishes its 33×33 pre-generation. Polling until three consecutive
  chunk counts agree is what lets the round-trip assertions compare **exact** counts. Do not
  replace it with a sleep and do not weaken the counts to inequalities.
- **Screenshots are a self-comparison baseline only.** SwiftShader is not a GPU. Useful as
  PR 9's "zero visual change" gate against another SwiftShader run; not evidence the game
  looks right on real hardware.
- **Bump the `?v=` cache-bust string in `index.html` for every `js/` file you change**
  until PR 9 makes it moot (D-23). All 65 are currently correct.

---

## 6. Acceptance criteria for whatever comes next

- `npm test` stays at 52/52 + 4 quarantined, exit 0.
- `npm run check-globals` stays at 0 duplicates — **or is retired deliberately** (§4.2).
- `npm run build` stays at exit 0.
- `npm run test:e2e` and `npm run test:e2e:vite` stay at 0 failures and stay **equal to
  each other**. If the count changes, say why in the same PR.
- `QUARANTINE.md` stays at 4 files.
- `git status` clean after every gate run.
- CI green on push, zero annotations.
- Every bug found gets a `BUGS.md` row with a severity and an owner PR, in the same commit.

---

## 7. Naming note

The session that produced this was asked to write `PR6C_HANDOFF.md`. It stopped three PRs
later than that name assumed, so the file is named for where work actually stopped.
`PR6B_HANDOFF.md` is kept for its §2 and §5, which are still the clearest description of
how the browser harness works and why.
