# PR 4 Handoff — Get the test suite green

**Goal:** `npm test` exits 0, so Phase 1 has a trustworthy parity gate.
**Status:** 30/54 passing (started at 17/53). 24 files left, all pre-triaged below.
**Parent doc:** `refactor.md` §5 PR 4. **Do not start Phase 1 until this lands.**

---

## 0. Environment

Node and npm are installed (`node v24.18.0`, `npm 11.16.0`). `npm install` and `npm i -D jsdom` have already been run — `node_modules/` exists and is gitignored.

```bash
bash test/run_tests.sh          # full suite (bash script — `node` cannot run it)
node test/test_<name>.js        # single file
node scripts/check-globals.js   # must stay at 0 duplicates
```

On Windows use Git Bash. PowerShell has no `bash` on PATH.

Last commit: `e645e63 fix(PR4, partial): real sfx bug, require shims, async test drift`
Rollback point: tag `pre-refactor-baseline` (local only — **still needs `git push origin pre-refactor-baseline`**).

---

## 1. Two rulings already made by the repo owner — do not re-litigate

1. **Hybrid strategy.** Fix the mechanical failures; quarantine only what genuinely needs a human ruling.
2. **For gameplay-value mismatches, the CODE IS RIGHT and the TEST IS STALE.** Update the assertion to match current behavior.

Ruling 2 was confirmed against git history: the source files changed in feature commits — `b287569` (VoxelGen overhaul), `ed0dc1a` (skybox rewiring) — *after* these tests were written, and the tests were never updated. You do not need to re-verify this per file.

**The one thing that ruling does NOT cover:** if a test failure turns out to be a genuine code bug rather than stale expectations, fix the **code**. One such bug was already found and fixed this way (see §2).

---

## 2. Already done in PR 4

- `npm i -D jsdom` (unblocks `test_pageLoad`'s import).
- **Real code bug fixed** — `js/audio/sfx.js` `generateNoiseBuffer()` seeded with `(seed || Date.now()) | 0`. `Date.now() | 0` truncates the epoch to 32 bits and is **negative** for a large share of wall-clock times; JS `%` keeps the dividend's sign, so samples came out in `[-3, -1)` instead of `[-1, 1]` — out-of-range PCM that clips audibly. Now forces the seed into the LCG's positive domain. `test_sfx`: 357/357, stable across repeated runs.
- **Require shims** (same class as PR 2) added to `js/world/spawnManager.js`, `js/input/interaction.js`, `js/world/chunkData.js`, `js/systems/inventory.js`, `js/multiplayer/chunkStreamer.js`, `js/world/chunkBinaryCodec.js`. `chunkData.js` now also re-exports `BLOCK_TYPES` / `BLOCK_BY_ID` / `BLOCK_BY_NAME` / `BLOCK_PROPERTIES`, which several tests destructure from it. All inert in the browser.
- **Async drift** — `CharacterManager.selectCharacter()` became `async`; tests called it without `await`, so `result.success` was `undefined`. Fixed: `test_characterManager` 112/112, `test_characterManagementIntegration` 106/106.
- `test_noise.js` import corrected to `const { NoiseGenerator } = require(...)`.

**The shim pattern to copy** (from `js/world/biomeSystem.js:7-9`):

```js
if (typeof module !== 'undefined' && typeof SOME_GLOBAL === 'undefined') {
  global.SOME_GLOBAL = require('./providerFile').SOME_GLOBAL;
}
```

Never fix these by declaring the constant locally — that creates a **new** duplicate top-level symbol and `scripts/check-globals.js` will (correctly) fail. Re-run it after every change.

---

## 3. The 24 remaining failures

### 3a. Diagnosed — stale test, update the assertion

| File | Test expects | Code does | Cause |
|---|---|---|---|
| `test_worldManager` | 8 biomes incl. `Corrupt`/`Lava`; name ≤32 | 10 VoxelGen biomes; name ≤16 | VoxelGen overhaul |
| `test_skybox` | fog `0.008`/`0.025`, night ambient `0.08` | `0.001`/`0.003`, `0.25` | skybox rewiring |
| `test_inventory` | apple stack 16; block 1 = `Grass` | 64; `Bedrock` | block renumbering |
| `test_creativeMode` | `STONE === 2` | `3` | block renumbering |
| `test_crafting` | recipe id `planks` | `planks_oak` | recipes split per wood type |
| `test_hostLogic` | world Y `−32..64` | `0..96` | world height change |
| `test_serverValidation` | world Y `−32..64` | `0..96` | same — 4 assertions |
| `test_chunkStreamer` | `maxChunksPerTick` 4 | 32 | perf tuning |
| `test_survival` | default spawn Y 20 | `SEA_LEVEL + 4` = 68 | sea level change |
| `test_worldPersistenceIntegration` | 32-char world name | ≤16 | name-length change |
| `test_chunkBinaryCodec` | `dirty` survives encode/decode | **deliberately not persisted** — see the explicit comments at `chunkBinaryCodec.js:60` and `:155` | intentional design |
| `test_questMarker` | 0 markers | 25 | expectations are **inverted**; quest content was added |
| `test_questIntegration` | 0 markers | 25 | same |

`test_hostLogic` also crashes at line 402 on `new RemotePlayerState(...)` — check what `js/multiplayer/playerSync.js` actually exports before assuming the class still exists.

### 3b. Diagnosed — API was rewritten, rewrite the test against the current surface

| File | Test uses | Code has |
|---|---|---|
| `test_blockInteraction` | `breakTarget`, `breakDuration`, `onBlockBreak`, `onBlockPlace`, `crosshair` | `breakingBlock`, `breakProgress`, `breakStartTime` |
| `test_noise` | `NoiseGenerator.perm` (512 entries) | `_perlin` internally; no `perm` |
| `test_biomeEffects` | imports `LAVA_ANIMATION`, `TOXIC_SLIME_ANIMATION`, `CORRUPT_FOG`, `ParticleEffect` | `js/renderer/biomeEffects.js:351` exports **only** `{ BiomeEffects }` |

For `test_biomeEffects`, decide deliberately: either re-export those constants from `biomeEffects.js` (they may still exist as module-locals — check) or drop the assertions. Do not invent constants to satisfy the test.

### 3c. Diagnosed — test-harness bug, not a product bug

**`test_sessionDiscovery`** (7 name assertions). The test builds its **own** relay harness rather than using `server/index.js`. At `test/test_sessionDiscovery.js:75-81` it constructs `SessionManager` **without passing `sessionName`**, so `this.sessionName` falls back to `'Untitled'` and every name assertion fails.

Proof it is harness-only: on the *same* browse-list object, `players`, `maxPlayers`, `mode` and `sessionPort` all pass — only `name` fails. And the production path is intact end to end: `client.js:578` sends `name` → `matchmaking.js:137` reads `msg.name` → `index.js:136` sets `sessionName` → `session.js:57` stores it → `session.js:558` returns it.

Fix the harness:

```js
const session = new SessionManager({
  wss: sessionWSS,
  sessionId,
  sessionName,                       // <-- missing
  worldSeed: worldSeed || 42,        // <-- missing
  gameMode: mode || 'survival',      // <-- missing
  hostId: playerId,
  maxPlayers: 4,
  heartbeatInterval: 30000,
});
```

### 3d. Not yet diagnosed — 4 assertions total

- `test_multiplayerClient` — 3 failing: `Default heartbeat interval 15s`, `Not connected initially`, `No game session initially`. Almost certainly config drift; check `js/multiplayer/client.js` defaults.
- `test_websocketErrorHandling` — 1 failing: `ws.onerror triggers client cleanup` — `onSessionLeave should be called for the session`. Worth a real look; this one could be a genuine cleanup bug rather than a stale test.

### 3e. Delete

**`test_textureGenerator`** asserts `scripts/generate_textures.py` exists. That script was **deleted**; only `scripts/generate-manifest.js` remains. Delete this test and let the new manifest smoke test (§4) replace it.

### 3f. Quarantine — do NOT fix

- `test_pageLoad`
- `test_responsiveHUD`
- `test_mobileViewports`
- `test_textureAssets`

The first three `readFileSync` + regex over `index.html` / `css/style.css` instead of exercising behavior. `refactor.md` §3.6 has **PR 26 rewriting them in the same PR that changes the HTML/CSS** — fixing them now guarantees rework. `test_textureAssets` expects `textures/*.png` at the repo root, but textures moved into `textures/blocks/` behind a manifest; it is the same class of source-text test and belongs with the others.

Owner PR for all four: **PR 26**.

---

## 4. Remaining deliverables

1. **`test/QUARANTINE.md`** — one entry per quarantined file: the failure, why it is deferred, and the owner PR. Target is ≤5 files; the four in §3f fit.
2. **Make `test/run_tests.sh` skip quarantined files and exit 0.** It currently globs `test/test_*.js` unconditionally (line 18) and exits non-zero if anything failed (line 57). Parse the filenames out of `QUARANTINE.md`, skip them, and report them as skipped so they stay visible rather than silently dropped.
3. **`package.json`** — set `"test": "bash test/run_tests.sh"`. It is currently `echo "Error: no test specified" && exit 1`. Note `"node test/run_tests.sh"` **cannot work** — it is a bash script.
4. **Smoke test for `scripts/generate-manifest.js`.** It eval-parses source with a regex:
   ```js
   const BLOCK_REGISTRY = eval('(' + registrySource.match(/const BLOCK_REGISTRY = (\[.*?\]);/s)[1] + ')');
   ```
   `export const BLOCK_REGISTRY = [...]` still matches that regex, but **any reformatting of the array does not**. The test should run the script and assert it produces a valid manifest — this is what protects the Phase 1 module conversion from silently breaking texture loading.

---

## 5. Acceptance criteria

- [ ] `npm test` exits 0
- [ ] `test/QUARANTINE.md` has ≤5 files, each with an owner PR
- [ ] `node scripts/check-globals.js` still reports **0 duplicates**
- [ ] No test was made to pass by weakening it to a tautology
- [ ] Any genuine code bug found was fixed in the **code**, and called out explicitly in the commit message
- [ ] `refactor.md` PR 4 section updated with the outcome, in the style used for PR 1–3

---

## 6. Trap to avoid

The failure mode for this PR is **laundering a real regression into green**. Ruling 2 says the code is right for the *value* mismatches listed in §3a — those were verified against git history. It does not say the code is right for anything else. If you hit a failure that is not in §3a and the code looks wrong, it probably is; fix the code and say so. That is exactly how the `sfx` bug in §2 was found.
