/**
 * Cuubz — ItemTextureAtlas build test
 *
 * test/unit/meta/textureCoverage.test.js checks that the FILES and MANIFESTS line up.
 * This checks the last seam neither of those can reach: that `buildAtlas()` actually
 * turns them into a slot with real pixels in it, for every id the inventory can hold.
 *
 * That seam is where the bug lived. Both manifests were fine; the atlas simply never
 * consulted them for blocks, and painted a flat coloured square from a stale hardcoded
 * id table instead. A file-level audit would have passed the whole time.
 *
 * ── The stubs ─────────────────────────────────────────────────────────
 *
 * `vitest.config.js` note 1 pins `environment: 'node'` on purpose and says the few files
 * needing a DOM build their own. This is one of them, and the stubs are chosen to make
 * the assertions mean something rather than to get the code to run:
 *
 *   canvas  — records every drawImage call instead of rasterising. What we need to know
 *             is WHICH source rect got copied WHERE, and a recorder answers that exactly
 *             where a pixel buffer would need decoding to answer it at all.
 *   Image   — resolves onload iff the PNG is really on disk under textures/items/, so a
 *             manifest entry pointing at a missing file takes the same onerror path it
 *             would take against a 404 in the browser.
 *   fetch   — serves the committed textures/items/manifest.json off disk.
 *
 * The block atlas is stubbed from the committed textures/blocks/manifest.json rather than
 * mocked by hand, so "every block gets an icon" is asserted against the real 192.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import path from 'path';
import { REPO_ROOT } from '../../helpers/paths.js';
import { ItemTextureAtlas } from '../../../src/engine/renderer/ItemTextureAtlas.js';
import { NAMED_ITEMS } from '../../../src/game/data/ItemDefinitions.js';

const ITEMS_DIR = path.join(REPO_ROOT, 'textures', 'items');
const BLOCKS_MANIFEST = path.join(REPO_ROOT, 'textures', 'blocks', 'manifest.json');
const ITEMS_MANIFEST = path.join(ITEMS_DIR, 'manifest.json');

const BLOCK_TILE = 32;
const BLOCK_GAP = 2;

/** A 2D context that records draws instead of performing them. */
function recordingContext() {
  return {
    draws: [],
    fills: [],
    texts: [],
    imageSmoothingEnabled: true,
    fillStyle: '',
    font: '',
    textAlign: '',
    textBaseline: '',
    drawImage(...args) { this.draws.push(args); },
    fillRect(...args) { this.fills.push(args); },
    fillText(...args) { this.texts.push(args); },
    clearRect() {},
  };
}

function fakeCanvas() {
  const ctx = recordingContext();
  return { width: 0, height: 0, ctx, getContext: () => ctx };
}

/**
 * A block atlas standing in for PBRTextureAtlas, with a tileMap built from the committed
 * block manifest so the block half is exercised against the real registry.
 */
function stubBlockAtlas() {
  const manifest = JSON.parse(fs.readFileSync(BLOCKS_MANIFEST, 'utf8'));
  const tileMap = {};
  let slot = 0;
  for (const block of manifest) {
    const tiles = {};
    for (const [face, entry] of Object.entries(block.textures)) {
      if (!entry.exists) continue;
      tiles[face] = { col: slot % 32, row: Math.floor(slot / 32) };
      slot++;
    }
    tileMap[block.id] = { tiles };
  }
  return {
    tileSize: BLOCK_TILE,
    _gap: BLOCK_GAP,
    diffuseCanvas: { __isBlockAtlasCanvas: true, width: 4096, height: 4096 },
    tileMap,
    manifest,
  };
}

describe('ItemTextureAtlas.buildAtlas', () => {
  const originals = {};
  let atlas;
  let blockAtlas;
  let requestedUrls;

  beforeAll(async () => {
    originals.document = globalThis.document;
    originals.Image = globalThis.Image;
    originals.fetch = globalThis.fetch;
    requestedUrls = [];

    globalThis.document = { createElement: (tag) => (tag === 'canvas' ? fakeCanvas() : {}) };

    globalThis.Image = class {
      set src(url) {
        requestedUrls.push(url);
        // `/textures/items/foo.png` → does textures/items/foo.png exist?
        const file = path.join(REPO_ROOT, url.replace(/^\//, ''));
        queueMicrotask(() => (fs.existsSync(file) ? this.onload() : this.onerror()));
      }
    };

    globalThis.fetch = async (url) => {
      if (url !== '/textures/items/manifest.json') throw new Error(`unexpected fetch: ${url}`);
      return { ok: true, json: async () => JSON.parse(fs.readFileSync(ITEMS_MANIFEST, 'utf8')) };
    };

    blockAtlas = stubBlockAtlas();
    atlas = new ItemTextureAtlas({ tileSize: 64, blockAtlas });
    await atlas.buildAtlas();
  });

  afterAll(() => {
    globalThis.document = originals.document;
    globalThis.Image = originals.Image;
    globalThis.fetch = originals.fetch;
  });

  it('builds', () => {
    expect(atlas.loaded).toBe(true);
    expect(atlas.canvas.width).toBeGreaterThan(0);
  });

  // ── The 14 blank items ─────────────────────────────────────────────
  it('gives every NAMED_ITEMS entry a slot', () => {
    const unslotted = Object.keys(NAMED_ITEMS).filter((k) => !atlas.slotMap[k]);
    expect(unslotted, `named items with no atlas slot: ${unslotted.join(', ')}`).toEqual([]);
  });

  it('resolves every named item to a PNG that loaded — no placeholders', () => {
    expect(atlas.missingTextures).toEqual([]);
  });

  it('requests one image per named item, all under /textures/items/', () => {
    expect(requestedUrls.length).toBe(Object.keys(NAMED_ITEMS).length);
    expect(requestedUrls.every((u) => u.startsWith('/textures/items/'))).toBe(true);
  });

  // ── The coloured boxes ─────────────────────────────────────────────
  it('gives every block in the block atlas a slot', () => {
    const unslotted = Object.keys(blockAtlas.tileMap).filter((id) => !atlas.slotMap[id]);
    expect(unslotted, `block ids with no atlas slot: ${unslotted.join(', ')}`).toEqual([]);
  });

  it('draws every block icon FROM the block atlas canvas, never from a fill', () => {
    const ctx = atlas.canvas.ctx;
    const fromBlockAtlas = ctx.draws.filter((d) => d[0] && d[0].__isBlockAtlasCanvas);
    expect(fromBlockAtlas.length).toBe(Object.keys(blockAtlas.tileMap).length);
  });

  // The old `_drawBlockPlaceholder` was a fillRect plus a fillText of the block name's
  // first letter. Asserting there is no text on this canvas is the most direct statement
  // that the lettered coloured box is gone and cannot come back unnoticed.
  it('paints no lettered placeholder squares', () => {
    const ctx = atlas.canvas.ctx;
    expect(ctx.texts, `placeholder glyphs drawn: ${JSON.stringify(ctx.texts)}`).toEqual([]);
    expect(ctx.fills, `placeholder rects drawn: ${JSON.stringify(ctx.fills)}`).toEqual([]);
  });

  it('copies each block icon from an in-bounds source rect', () => {
    const ctx = atlas.canvas.ctx;
    const bad = ctx.draws
      .filter((d) => d[0] && d[0].__isBlockAtlasCanvas)
      .filter(([, sx, sy, sw, sh]) =>
        sx < BLOCK_GAP || sy < BLOCK_GAP || sw !== BLOCK_TILE || sh !== BLOCK_TILE
        || (sx - BLOCK_GAP) % (BLOCK_TILE + BLOCK_GAP) !== 0
        || (sy - BLOCK_GAP) % (BLOCK_TILE + BLOCK_GAP) !== 0);
    expect(bad, `block blits not aligned to a tile: ${JSON.stringify(bad.slice(0, 3))}`).toEqual([]);
  });

  // ── Regression: the specific ids that used to be wrong ─────────────
  //
  // These are the stale hardcoded ids. Every one of them named a different block in the
  // old table than it does in BLOCK_REGISTRY, so each is both a "has an icon now" check
  // and a "the icon belongs to the right block" check.
  it('the formerly-hardcoded block ids map to their real registry blocks', () => {
    const EXPECTED = {
      4: 'andesite',        // was labelled "Grass Block"
      32: 'deepslate_gold_ore', // was "Wood Log"
      33: 'deepslate_diamond_ore', // was "Leaves"
      34: 'deepslate_copper_ore',  // was "Planks"
      45: 'raw_iron_block', // was "Glowstone"
    };
    for (const [id, name] of Object.entries(EXPECTED)) {
      expect(atlas.slotMap[id], `block ${id} (${name}) has no slot`).toBeDefined();
      expect(atlas.itemRegistry[id].name, `block ${id} display name`).toBe(name);
    }
  });

  it('every slot is unique — no two items share an atlas cell', () => {
    const cells = Object.values(atlas.slotMap).map((s) => `${s.col},${s.row}`);
    expect(new Set(cells).size).toBe(cells.length);
  });

  it('getItemUV resolves for both string and numeric keys', () => {
    expect(atlas.getItemUV('iron_ingot')).not.toBeNull();
    expect(atlas.getItemUV(49)).not.toBeNull();   // grass_block
    expect(atlas.getItemUV('nope')).toBeNull();
  });
});

describe('ItemTextureAtlas without a block atlas', () => {
  // The degraded path is real — `Hotbar.renderItemIcon` keeps its block-atlas fallback
  // for exactly this case — so it must not throw, and must not invent block icons.
  it('builds named items only and registers no blocks', async () => {
    const originals = { document: globalThis.document, Image: globalThis.Image, fetch: globalThis.fetch };
    globalThis.document = { createElement: () => fakeCanvas() };
    globalThis.Image = class { set src(_u) { queueMicrotask(() => this.onload()); } };
    globalThis.fetch = async () => ({ ok: true, json: async () => JSON.parse(fs.readFileSync(ITEMS_MANIFEST, 'utf8')) });

    try {
      const atlas = new ItemTextureAtlas({ tileSize: 64 });
      await atlas.buildAtlas();
      expect(atlas.loaded).toBe(true);
      expect(Object.keys(atlas.slotMap).length).toBe(Object.keys(NAMED_ITEMS).length);
      expect(Object.keys(atlas.slotMap).filter((k) => /^\d+$/.test(k))).toEqual([]);
    } finally {
      globalThis.document = originals.document;
      globalThis.Image = originals.Image;
      globalThis.fetch = originals.fetch;
    }
  });
});
