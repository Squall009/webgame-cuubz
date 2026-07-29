# Quarantined Tests

Tests listed here are **skipped by `test/run_tests.sh`** and do not fail the build.
They are reported as `⏭️  SKIP` so they stay visible rather than silently dropped.

The runner parses this file for filenames — one `test_*.js` per row of the table
below. Adding a row quarantines a test; deleting a row un-quarantines it. Nothing
else needs to change.

**Quarantine is not a way to make a red test green.** Every entry needs a real
reason and a named owner PR that will fix or replace it. Keep this list at **five
files or fewer**. If it grows past that, the suite is drifting from the code and
that is the problem to fix.

## Currently quarantined (4)

| File | Failure | Why it is deferred | Owner PR |
|---|---|---|---|
| `test_pageLoad.js` | `#render-distance` and `#inventory-screen` not found; expects `textures/*.png` at the repo root | `readFileSync` + regex over `index.html` rather than exercising behaviour. Asserts against markup that PR 26 rewrites. | **PR 26** |
| `test_responsiveHUD.js` | Mobile media-query blocks for `meters-container`, `hotbar-container`, `hotbar-slot` not matched | Same class: regex over `css/style.css`. Asserts the current selector names and breakpoints, both of which PR 26 changes. | **PR 26** |
| `test_mobileViewports.js` | 280px-breakpoint rules (meter labels, quest tracker, crosshair) not matched | Same class: regex over `css/style.css` for narrow-viewport rules that PR 26 restructures. | **PR 26** |
| `test_textureAssets.js` | 35 failures — expects `textures/*.png` at the repo root | Textures moved to `textures/blocks/` behind a generated manifest. Same source-text style as the three above, and the manifest is now covered by `test_manifestGenerator.js`. | **PR 26** |

## Why these four and nothing else

All four assert over **source text** — reading `index.html` or `css/style.css` and
regex-matching for selectors, rules and asset paths — instead of exercising
behaviour. That makes them fail whenever markup or CSS is reorganised, even when
the page still works.

`refactor.md` §3.6 assigns PR 26 the job of rewriting them **in the same PR that
changes the HTML/CSS**, so fixing them now would guarantee rework: the assertions
would be rewritten twice against two different markup structures.

`test_textureAssets.js` is grouped with them because it is the same kind of test —
it asserts a file layout rather than a behaviour. The behaviour it was really
protecting (that every block in the registry resolves to a texture on disk) is now
covered properly by `test_manifestGenerator.js`, which runs the generator and
cross-checks its output against the block registry.

## What was *not* quarantined

Everything else in the suite was fixed rather than deferred. In particular
`test_biomeEffects.js` and `test_blockInteraction.js` were rewritten against the
current APIs rather than parked here, because both cover live game behaviour and
the modules are exercisable from Node.

`test_textureGenerator.js` was **deleted**, not quarantined — it asserted the
existence of `scripts/generate_textures.py`, which no longer exists.
`test_manifestGenerator.js` replaces it.
