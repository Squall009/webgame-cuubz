/**
 * Cuubz — the CSS cascade, resolved rather than eyeballed (PR 33, BUGS.md D-81)
 *
 * ─── WHY THIS FILE EXISTS ───────────────────────────────────────────────────
 *
 * The stylesheet is 32 files loaded by an ordered `@import` manifest (`src/ui/css/
 * index.css`), each one a contiguous span of the pre-split `css/style.css`. The
 * responsive layer carries **no `!important` at all** — every one of its overrides wins
 * on source order alone. That makes the manifest load-bearing, and it makes a whole
 * class of defect invisible to every other gate in this repo:
 *
 *   D-81 (1)  the entire `@media (max-width: 600px)` equipment block sat at the end of
 *             `screens/crafting.css`, which is imported one line BEFORE
 *             `screens/equipment.css`. Equal specificity, earlier source — so the mobile
 *             equipment panel lost to the desktop rules it existed to override and the
 *             panel never shrank on a phone. `index.css`'s own header documented it as a
 *             defect "preserved verbatim".
 *   D-81 (2)  `#crafting-inv-grid` is `repeat(9, 36px)` at that breakpoint while
 *             `.inventory-slot` carries `min-width: 48px`. `min-width` is not overridden
 *             by a later `width`; the used width is `max(min-width, width)`. Nine 48px
 *             slots is 432px of content in a 348px grid.
 *   D-81 (3)  `.host-select-row` and `.host-select-row select` were each declared twice
 *             in `screens/host-form.css`, with conflicting `gap` and `margin-bottom`,
 *             under the same copy-pasted comment.
 *
 * None of the three is a syntax error, none breaks the build, none changes a single byte
 * of `dist/` in a way a diff would flag, and all three are mobile-only — so `npm test`,
 * `eslint`, `vite build` and the desktop e2e run were all green over every one of them
 * for the entire life of the file.
 *
 * ─── WHAT IT ACTUALLY DOES ──────────────────────────────────────────────────
 *
 * jsdom's `getComputedStyle` does not evaluate media queries, so it cannot answer "what
 * does this element look like on a phone?". This file therefore resolves the cascade
 * itself, over the REAL stylesheet in the REAL manifest order, against the REAL shipped
 * markup (`mountTemplates()`), with `Element.matches()` doing the selector matching:
 *
 *   1. read `index.css`, take the `@import` list IN ORDER — the order under test;
 *   2. concatenate those files, recording each rule's ordinal;
 *   3. for a given element, property and viewport width, keep every rule whose media
 *      condition holds and whose selector the element matches, and pick the winner by
 *      (`!important`, specificity, source order) — the cascade's own tie-break ladder.
 *
 * That is a model of the cascade, not the browser's cascade, so it is deliberately
 * narrow: it covers the declaration-level tie-breaks these three defects live in, and it
 * makes no claim about inheritance, shorthand expansion or layout. What it CAN do is go
 * red when a rule stops winning — which is the exact event no other gate here notices.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'fs';
import path from 'path';
import { TEST_DIR as __dirname } from '../../helpers/paths.js';
import { mountTemplates } from '../../../src/ui/templates/index.js';

let passed = 0, failed = 0;
function record(fn) { try { fn(); passed++; } catch (e) { failed++; throw e; } }
function eq(a, b, why) { record(() => expect(a, why).toBe(b)); }
function is(a, why) { record(() => expect(a, why).toBe(true)); }
afterAll(() => { console.log(`Results: ${passed}/${passed + failed} passed, ${failed} failed`); });

const CSS_DIR = path.join(__dirname, '..', 'src', 'ui', 'css');

// ─── The stylesheet, in manifest order ────────────────────────────────────────

const stripComments = (css) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The `@import './x.css';` list out of index.css, in the order it declares. */
function importOrder() {
  const index = stripComments(fs.readFileSync(path.join(CSS_DIR, 'index.css'), 'utf8'));
  return [...index.matchAll(/@import\s+['"]\.\/([^'"]+)['"]\s*;/g)].map((m) => m[1]);
}

/**
 * Flatten one file into `{media, selector, prop, value, important, order}` records.
 * Handles one level of `@media` nesting, which is all this stylesheet uses.
 */
function parseFile(css, file, rules) {
  const src = stripComments(css);
  let i = 0;

  const readBlock = (start) => { // start points AT the '{'
    let depth = 0;
    for (let j = start; j < src.length; j++) {
      if (src[j] === '{') depth++;
      else if (src[j] === '}') { depth--; if (depth === 0) return j; }
    }
    return -1;
  };

  const emit = (selectorList, body, media) => {
    for (const decl of body.split(';')) {
      const c = decl.indexOf(':');
      if (c < 0) continue;
      const prop = decl.slice(0, c).trim();
      let value = decl.slice(c + 1).trim();
      if (!prop || !value) continue;
      const important = /!important$/.test(value);
      if (important) value = value.replace(/!important$/, '').trim();
      for (const selector of selectorList.split(',')) {
        const sel = selector.trim();
        if (sel) rules.push({ media, selector: sel, prop, value, important, file, order: rules.length });
      }
    }
  };

  while (i < src.length) {
    const brace = src.indexOf('{', i);
    if (brace < 0) break;
    const prelude = src.slice(i, brace).trim();
    const close = readBlock(brace);
    if (close < 0) throw new Error(`${file}: unbalanced braces after ${prelude.slice(0, 60)}`);
    const body = src.slice(brace + 1, close);

    if (/^@media/i.test(prelude)) {
      const media = prelude.replace(/^@media\s*/i, '').trim();
      // One level of nesting: parse the inner rules against this condition.
      let k = 0;
      while (k < body.length) {
        const b2 = body.indexOf('{', k);
        if (b2 < 0) break;
        const sel = body.slice(k, b2).trim();
        let depth = 0, end = -1;
        for (let j = b2; j < body.length; j++) {
          if (body[j] === '{') depth++;
          else if (body[j] === '}') { depth--; if (depth === 0) { end = j; break; } }
        }
        if (end < 0) throw new Error(`${file}: unbalanced braces inside @media ${media}`);
        if (sel) emit(sel, body.slice(b2 + 1, end), media);
        k = end + 1;
      }
    } else if (prelude.startsWith('@')) {
      // @import / @keyframes / @font-face — no plain declarations under test here.
    } else if (prelude) {
      emit(prelude, body, null);
    }
    i = close + 1;
  }
}

/** Every declaration in the whole stylesheet, ordinal = manifest order. */
function loadStylesheet() {
  const rules = [];
  for (const rel of importOrder()) {
    parseFile(fs.readFileSync(path.join(CSS_DIR, rel), 'utf8'), rel, rules);
  }
  return rules;
}

/** `(a, b, c)` — ids, then classes/attributes/pseudo-classes, then types. */
function specificity(sel) {
  const ids = (sel.match(/#[\w-]+/g) || []).length;
  const classes = (sel.match(/\.[\w-]+/g) || []).length +
    (sel.match(/\[[^\]]*\]/g) || []).length +
    (sel.match(/(?<!:):(?!:)[\w-]+/g) || []).length;
  const types = (sel.replace(/#[\w-]+|\.[\w-]+|\[[^\]]*\]|::?[\w-]+/g, ' ')
    .match(/\b[a-zA-Z][\w-]*\b/g) || []).length;
  return ids * 10000 + classes * 100 + types;
}

/** Does `media` hold at this viewport width? Only `max-width` is used in this sheet. */
function mediaApplies(media, width) {
  if (!media) return true;
  const m = media.match(/max-width\s*:\s*(\d+)px/);
  if (!m) throw new Error(`unhandled media condition: ${media}`);
  return width <= Number(m[1]);
}

/**
 * The winning declaration for `prop` on `el` at `width`, or null.
 * `!important` first, then specificity, then source order — the cascade's own ladder.
 */
function winning(rules, el, prop, width) {
  let best = null;
  for (const r of rules) {
    if (r.prop !== prop) continue;
    if (!mediaApplies(r.media, width)) continue;
    if (!el.matches(r.selector)) continue;
    if (!best) { best = r; continue; }
    const rank = (x) => [x.important ? 1 : 0, specificity(x.selector), x.order];
    const [ai, as, ao] = rank(r), [bi, bs, bo] = rank(best);
    if (ai > bi || (ai === bi && (as > bs || (as === bs && ao > bo)))) best = r;
  }
  return best;
}
const value = (rules, el, prop, width) => { const w = winning(rules, el, prop, width); return w ? w.value : null; };

// ─── The shipped DOM ──────────────────────────────────────────────────────────

const dom = new JSDOM('<!DOCTYPE html><html><body><div id="app"></div></body></html>');
const document = dom.window.document;
mountTemplates(document.getElementById('app'));

// `#crafting-inv-grid` is filled at runtime by `InventoryScreen.js:70`
// (`div.className = 'inventory-slot' + (isHotbar ? ' hotbar' : '')`). Reproduce exactly
// that, plus one `.inventory-slot` OUTSIDE the grid, which is the control: the crafting
// exception must be local to the grid and must not shrink slots anywhere else.
const grid = document.getElementById('crafting-inv-grid');
for (let i = 0; i < 36; i++) {
  const d = document.createElement('div');
  d.className = 'inventory-slot' + (i >= 27 ? ' hotbar' : '');
  d.dataset.slot = String(i);
  grid.appendChild(d);
}
const looseSlot = document.createElement('div');
looseSlot.className = 'inventory-slot';
document.body.appendChild(looseSlot);

const RULES = loadStylesheet();
const PHONE = 600;    // the breakpoint itself — `max-width: 600px` includes it
const DESKTOP = 1200; // above every media query in the sheet

const q = (sel) => {
  const el = document.querySelector(sel);
  if (!el) throw new Error(`the shipped templates have no ${sel}`);
  return el;
};

describe('the stylesheet loads in the manifest order index.css declares', () => {
  it('parses all 32 files and keeps responsive.css ahead of utilities.css', () => {
    const order = importOrder();
    // 32 files: index.css is the manifest itself, so it imports the other 31.
    // S1 added overlays/quest-log.css, appended at the end of the manifest so it can
    // only override, never be silently overridden (D-52).
    eq(order.length, 31, 'index.css imports the other 31 files');
    eq(order.length + 1, fs.readdirSync(CSS_DIR, { recursive: true })
      .filter((f) => String(f).endsWith('.css')).length,
    'and every .css file on disk is in the manifest — an unimported file is dead style');
    is(RULES.length > 500, `the sheet parsed into declarations (${RULES.length})`);
    const at = (f) => order.indexOf(f);
    is(at('responsive.css') > at('overlays/inventory.css'),
      'responsive.css is after every component it overrides');
    is(at('responsive.css') < at('utilities.css'),
      'and before utilities.css, which owns `.hidden { display: none !important }`');
    // The one !important the whole hiding mechanism depends on must still be important.
    const hidden = RULES.find((r) => r.selector === '.overlay.hidden' && r.prop === 'display');
    is(!!hidden && hidden.important, '`.overlay.hidden { display: none !important }` is still !important');
  });
});

describe('D-81 (1) — the mobile equipment panel actually wins on a phone', () => {
  it('flex-direction, min-width and flex-wrap are the mobile values at 600px', () => {
    const panel = q('.equipment-panel');
    // THE DEFECT. Every one of these read the DESKTOP value at 600px, because the media
    // block sat in crafting.css — imported one line BEFORE equipment.css.
    eq(value(RULES, panel, 'flex-direction', PHONE), 'row', 'panel goes horizontal on a phone');
    eq(value(RULES, panel, 'min-width', PHONE), 'unset', 'and drops its 160px floor');
    eq(value(RULES, panel, 'flex-wrap', PHONE), 'wrap', 'and is allowed to wrap');
    eq(value(RULES, panel, 'gap', PHONE), 'var(--space-md)', 'mobile gap');
  });
  it('the slots, icons, labels and stats follow the panel', () => {
    const slot = q('.equipment-slot');
    eq(value(RULES, slot, 'height', PHONE), '64px', 'equipment slot is 64px tall on a phone, not 72px');
    eq(value(RULES, slot, 'width', PHONE), '56px', 'and 56px wide, not 100%');
    eq(value(RULES, q('.equipment-slot .equip-slot-icon'), 'width', PHONE), '36px', 'icon shrinks to 36px');
    eq(value(RULES, q('.equip-slot-label'), 'font-size', PHONE), '8px', 'label shrinks to 8px');
    eq(value(RULES, q('.equipment-stats'), 'font-size', PHONE), '11px', 'stats shrink to 11px');
    eq(value(RULES, q('.equipment-slots'), 'flex-direction', PHONE), 'row', 'the slot column becomes a row');
  });
  it('and the desktop rendering is untouched — the move changed one breakpoint, not two', () => {
    const panel = q('.equipment-panel'), slot = q('.equipment-slot');
    eq(value(RULES, panel, 'flex-direction', DESKTOP), 'column', 'desktop panel is still a column');
    eq(value(RULES, panel, 'min-width', DESKTOP), '160px', 'desktop min-width unchanged');
    eq(value(RULES, panel, 'gap', DESKTOP), '10px', 'desktop gap unchanged');
    eq(value(RULES, slot, 'height', DESKTOP), '72px', 'desktop slot height unchanged');
    eq(value(RULES, slot, 'width', DESKTOP), '100%', 'desktop slot width unchanged');
    eq(value(RULES, q('.equip-slot-label'), 'font-size', DESKTOP), '9px', 'desktop label unchanged');
  });
});

describe('D-81 (2) — the crafting grid fits on the screen', () => {
  const px = (v) => { const n = /^(-?[\d.]+)px$/.exec(v || ''); return n ? Number(n[1]) : null; };

  it('a crafting slot is 36px in every dimension that decides its used width', () => {
    const slot = grid.querySelector('.inventory-slot');
    eq(value(RULES, slot, 'width', PHONE), '36px', 'width');
    eq(value(RULES, slot, 'height', PHONE), '36px', 'height');
    // THE DEFECT: `min-width` resolved to `.inventory-slot { min-width: 48px }` from
    // responsive.css, which `width: 36px` cannot override — different property.
    eq(value(RULES, slot, 'min-width', PHONE), '36px', 'min-width — the property that actually decided the size');
    eq(value(RULES, slot, 'min-height', PHONE), '36px', 'min-height');
  });

  it('nine of them fit inside the declared grid, which is the whole point', () => {
    const slot = grid.querySelector('.inventory-slot');
    const used = Math.max(px(value(RULES, slot, 'min-width', PHONE)) ?? 0,
      px(value(RULES, slot, 'width', PHONE)) ?? 0);
    const track = value(RULES, grid, 'grid-template-columns', PHONE);
    const m = /repeat\((\d+),\s*(\d+)px\)/.exec(track);
    is(!!m, `the grid declares a repeat() track list at 600px (${track})`);
    const [cols, trackPx] = [Number(m[1]), Number(m[2])];
    eq(cols, 9, 'nine columns');
    eq(trackPx, 36, 'of 36px each');
    eq(used, trackPx, `a slot's used width (${used}px) equals its track (${trackPx}px)`);
    is(cols * used <= cols * trackPx,
      `${cols} slots at ${used}px fit in ${cols} tracks of ${trackPx}px — 9x48=432px in a 348px grid was the defect`);
  });

  it('the 48px touch floor still applies to every OTHER inventory slot', () => {
    // The control. If the fix had been "delete the 48px min-width", this goes red.
    eq(value(RULES, looseSlot, 'min-width', PHONE), '48px', 'a slot outside the crafting grid keeps its 48px floor');
    eq(value(RULES, looseSlot, 'min-height', PHONE), '48px', 'and its 48px height floor');
    eq(value(RULES, looseSlot, 'width', PHONE), '56px', 'and its 56px width');
    // And the crafting exception is scoped by an id, so it cannot leak.
    const w = winning(RULES, grid.querySelector('.inventory-slot'), 'min-width', PHONE);
    is(w.selector.includes('#crafting-inv-grid'),
      'the crafting override is id-scoped — it wins on specificity, not on source order');
  });

  it('a hotbar slot inside the grid is sized the same as a plain one', () => {
    const hot = grid.querySelector('.inventory-slot.hotbar');
    is(!!hot, 'the grid has hotbar slots (InventoryScreen.js:70 adds the class)');
    eq(value(RULES, hot, 'min-width', PHONE), '36px', 'hotbar slots shrink too — the selector matches both');
  });
});

describe('D-81 (3) — .host-select-row is declared once', () => {
  it('neither rule is duplicated anywhere in the stylesheet', () => {
    const blocks = (sel, prop) => RULES.filter((r) => r.selector === sel && r.prop === prop);
    // `gap` and `margin-bottom` were the two properties the duplicates disagreed about.
    eq(blocks('.host-select-row', 'gap').length, 1, 'exactly one `.host-select-row { gap }`');
    eq(blocks('.host-select-row', 'margin-bottom').length, 1, 'exactly one `.host-select-row { margin-bottom }`');
    eq(blocks('.host-select-row select', 'flex').length, 1, 'exactly one `.host-select-row select { flex }`');
  });
  it('and the surviving values are the ones that were already winning — this change renders identically', () => {
    const row = q('.host-select-row');
    eq(value(RULES, row, 'gap', DESKTOP), 'var(--space-md)', 'gap is the lower duplicate\'s, which won before');
    eq(value(RULES, row, 'margin-bottom', DESKTOP), 'var(--space-lg)', 'margin-bottom likewise');
    eq(value(RULES, row, 'align-items', DESKTOP), 'center', 'align-items was only ever in the survivor');
    eq(value(RULES, row, 'display', DESKTOP), 'flex', 'display: flex');
    eq(value(RULES, q('.host-select-row select'), 'flex', DESKTOP), '1', 'the select still stretches');
  });

  it('the 600px `.host-select-row button` rule is still reachable, and still loses to .compact', () => {
    // Not part of D-81's fix — banked because resolving the cascade turned it up and it
    // is the kind of thing that reads as a regression later if nobody wrote it down.
    //
    // All three buttons in a `.host-select-row` carry `.menu-btn.compact` (0,2,0), and
    // `screens/host-form.css`'s mobile `.host-select-row button` is (0,1,1). So `.compact`
    // wins `font-size` and `padding` on EVERY button the shipped markup actually has, and
    // the mobile rule changes nothing there. That is deliberate and documented at
    // `components/buttons.css:66-67`, which says in as many words that `.compact` must
    // stay ahead of "`.host-select-row button` in screens/host-form.css".
    const btn = document.querySelector('.host-select-row button');
    is(!!btn, 'the lobby markup has a button in a host-select-row');
    is(btn.classList.contains('compact'), 'and it carries .compact');
    eq(value(RULES, btn, 'font-size', PHONE), '13px', "`.menu-btn.compact` (0,2,0) wins, as buttons.css says it must");
    eq(winning(RULES, btn, 'font-size', PHONE).selector, '.menu-btn.compact', 'and it is that rule specifically');

    // The mobile rule is not dead in general, only outranked here: a bare button in the
    // same row gets it. Probe markup — deliberately NOT in any template — so the two
    // facts are separable and a future `.compact` removal cannot pass silently.
    const probeRow = document.createElement('div');
    probeRow.className = 'host-select-row';
    const bare = document.createElement('button');
    probeRow.appendChild(bare);
    document.body.appendChild(probeRow);
    eq(value(RULES, bare, 'font-size', PHONE), '12px',
      'a button with no .compact in a .host-select-row does get the 12px mobile rule');
    eq(winning(RULES, bare, 'font-size', PHONE).file, 'screens/host-form.css',
      'from the surviving copy of the file, at the 600px breakpoint');
  });
});
