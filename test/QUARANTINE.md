# Quarantined Tests

## THE MECHANISM IS GONE (PR 31)

This file no longer does anything. It is kept for the record below.

Quarantine was a feature of `test/run_tests.sh`: the runner parsed the first column
of the table in this file, skipped those files and reported them as `⏭️  SKIP`.
**PR 31 replaced that runner with Vitest and deleted it**, so nothing reads this file
any more.

**Vitest has no equivalent and none is wanted.** The nearest things it offers —
`test.skip` / `describe.skip` and a `vitest.config.js` `exclude` entry — both hide the
skip inside the code or the config rather than in a list with an owner PR beside it,
which is the property that made the quarantine table safe. Nothing needs one today
(see below), and if something ever does, the answer is to fix or delete the test, not
to rebuild the mechanism.

The empty table below is preserved as-is. It parsed under the old runner; it is inert
now. **Do not add a row to it** — a row would be skipped by nothing and read by no
one, which is strictly worse than a red test.

## Currently quarantined (0)

| File | Failure | Why it is deferred | Owner PR |
|---|---|---|---|

**The quarantine is empty, and was already empty before the runner was deleted.** All
four entries were owned by **PR 26**, which is the PR that rewrote the HTML and CSS
they asserted against, and `refactor.md` §3.6 says the rewrite and the test fix ship
together. They did.

## The historical record — what was quarantined, when, and how it ended

All four were quarantined during **PR 21** and closed in **PR 26**. Every one of
them asserted over **source text** — reading `index.html` or `css/style.css` and
matching for selectors, rules and asset paths — instead of exercising behaviour.
That is what made them fail when markup and CSS were reorganised even though the
page still worked, and it is also what made most of their assertions *already
false* long before the reorganisation.

A bullet list, deliberately — **not** a table. `run_tests.sh` parsed the first
column of *every* markdown table row in this file, so a historical table here
would have re-quarantined all four. That runner is gone as of PR 31, so the
constraint is no longer live; the list is left as a list because rewriting it into
a table would gain nothing.

- **`test_pageLoad.js`** — went red on `#render-distance` and `#inventory-screen`
  not being found and on expecting `textures/*.png` at the repo root.
  **Rewritten** against the assembled DOM.
- **`test_responsiveHUD.js`** — went red on mobile media-query blocks for
  `meters-container`, `hotbar-container` and `hotbar-slot` not matching.
  **Deleted.**
- **`test_mobileViewports.js`** — went red on 280px-breakpoint rules (meter
  labels, quest tracker, crosshair) not matching. **Deleted.**
- **`test_textureAssets.js`** — 35 failures, all from expecting `textures/*.png`
  at the repo root. **Deleted.**

### `test_pageLoad.js` — rewritten, 486 lines → 136

It was never "`readFileSync` + regex" as the original row claimed; it parsed with
jsdom. The real defect was that it asserted a **static markup inventory of
`index.html`**, and after PR 26 that markup lives in `src/ui/templates/*.js`.

115 assertions became 48, and the great majority of what went was false
*independently of PR 26*: 33 `js/*.js` files on disk and a `js/three.min.js`
`<script>` (the `js/` tree was deleted in PR 9 — the `js/main.js` reference is
**D-61**), 26 root-level `textures/*.png`, and four ids that have never existed
(`#render-distance`, `#inventory-screen`, `#inventory-grid`,
`#btn-close-inventory`; the live controls are `#perf-render-distance`, a
`<select>`, and `#crafting-screen` / `#crafting-inv-grid` /
`#btn-close-crafting`). `#music-volume` does exist — it is read from nowhere in
`src/`, which is a different problem and not this file's.

What survived was repointed at the **assembled** DOM: the rewrite imports
`mountTemplates()`, mounts into jsdom, and asserts that every id
`test/e2e/saveLoad.js` drives exists, that ids are unique across all 16 templates,
that exactly one `.screen` lacks `.hidden` and it is `#main-menu`, and that no
inline `style=` or `on*` attributes survive. The id list is **scraped from the e2e
harness** rather than transcribed, so the two cannot drift.

### `test_responsiveHUD.js` — deleted, 373 lines

38 of its 68 assertions were `cssContent.includes('some string')`. `:318` asserted
`.meter-fill` exists, a class **no code writes to**. Its media-query extractor
(`:47`) took the *first* `@media (max-width:600px)` block up to the next `@media`,
which by PR 21 was the 18-line host-form block — so it searched the wrong body.
That is why it went red: **a rule was added above it; nothing regressed.** Its
Group 9 asserted `#crafting-grid` / `.crafting-slot`, selectors that matched
nothing in the DOM — green-by-string against dead CSS. Its one real claim, "touch
targets ≥48px on mobile", was asserted about CSS *text* rather than a rendered box
and belongs in the e2e harness if anywhere.

### `test_mobileViewports.js` — deleted, 640 lines

Groups 4–11 are named for nine devices and **simulate nothing** — no browser, no
layout engine. `getMediaBlockForMaxWidth` (`:70-78`) returns the first block
at-or-above the requested width, so Groups 4–8 (280/360/375/390/428px) all
inspected the *same* 18 lines. Groups 15–19 asserted that the stylesheet **lacks**
`@supports`, `env(safe-area-inset-*)`, orientation and DPI queries — i.e. they
would fail on any improvement. Its one valuable assertion, the viewport meta
(`:100-115`), is preserved by the `test_pageLoad.js` rewrite.

### `test_textureAssets.js` — deleted, 241 lines

`EXPECTED_TEXTURES` (`:51-60`) was 30 hand-written filenames checked against a
directory of *generated* names — the same hand-written-table-versus-generated-
registry class as **D-56 / D-63 / D-64**. The behaviour it was really protecting —
every block in the registry resolving to a texture on disk — is covered by
`test_manifestGenerator.js`, which runs the real generator, cross-checks the entry
count against a `require()` of `BLOCK_REGISTRY`, and asserts *"Every registry
texture resolves to a PNG on disk"* over every face of every entry. That was
re-verified before this file was deleted.

## What was *not* quarantined

Everything else in the suite was fixed rather than deferred. In particular
`test_biomeEffects.js` and `test_blockInteraction.js` were rewritten against the
current APIs rather than parked here, because both cover live game behaviour and
the modules are exercisable from Node.

`test_textureGenerator.js` was **deleted**, not quarantined — it asserted the
existence of `scripts/generate_textures.py`, which no longer exists.
`test_manifestGenerator.js` replaces it. That is the precedent the three deletions
above follow: a test that asserts a *file layout* rather than a behaviour is
replaced by one that exercises the behaviour, not carried forward.
