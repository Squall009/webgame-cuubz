/**
 * Cuubz — Texture Coverage Audit
 *
 * Every block and every item must have a texture that exists on disk and reaches the
 * atlas that draws it. This file is the gate that keeps that true.
 *
 * It exists because both halves of the item atlas had silently drifted from the data
 * they were copies of, and neither drift was detectable from anything but a screenshot:
 *
 *   - 14 of the 104 `NAMED_ITEMS` had no atlas entry AND no PNG, so their inventory
 *     slot rendered empty. Nine crafting recipes reference `iron_ingot` alone.
 *   - `ItemTextureAtlas` carried 29 hardcoded block ids from a registry generation that
 *     no longer existed, painting each as a flat coloured square with the wrong name's
 *     initial on it. Those ids also shadowed the block-atlas fallback in
 *     `Hotbar.renderItemIcon`, so they were the only blocks that COULDN'T self-correct.
 *
 * So the assertions here are deliberately about the seams rather than about the files:
 * a PNG existing is not the property that matters, a PNG existing *and being reachable
 * from the id the inventory holds* is. Four seams, in the order a texture crosses them:
 *
 *   1. BLOCK_REGISTRY → textures/blocks/*.png
 *   2. blocks/manifest.json → an icon face the item atlas can pick
 *   3. NAMED_ITEMS → items/manifest.json (no key added to one and not the other)
 *   4. items/manifest.json → textures/items/*.png
 *
 * Seam 2 is the one that would have caught the coloured-box bug. Seams 3 and 4 are the
 * ones that would have caught the 14 blank items.
 *
 * These read the two manifests as committed rather than regenerating them, on purpose:
 * a stale manifest in the working tree is itself a bug (it is what ships), and
 * regenerating first would hide it. test/unit/meta/manifestGenerator.test.js is the
 * file that checks the generator still produces them correctly.
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { REPO_ROOT } from '../../helpers/paths.js';
import { BLOCK_REGISTRY } from '../../../src/engine/world/BlockRegistry.js';
import { NAMED_ITEMS } from '../../../src/game/data/ItemDefinitions.js';

/** The atlas cell size — `initScene.js` builds `ItemTextureAtlas` with `tileSize: 64`. */
const ATLAS_TILE = 64;

/**
 * Above this fraction of opaque pixels, the image is not an item icon.
 *
 * D-114. Seven items shipped a full-bleed gradient square with a crude blob in the
 * middle — placeholders, not art, and they rendered in the hotbar as the "coloured
 * boxes" that started this whole investigation. They were 100.0% opaque while every real
 * icon in the pack has a transparent margin; the widest genuine silhouette is `leather`
 * at 56.6%. 90% is therefore not a tuned threshold, it is a wide gap in a bimodal
 * distribution — nothing legitimate is anywhere near it.
 */
const MAX_OPAQUE_FRACTION = 0.9;

/** { width, height, opaqueFraction } for a PNG. */
function imageStats(file) {
  const png = PNG.sync.read(fs.readFileSync(file));
  let opaque = 0;
  const total = png.width * png.height;
  for (let i = 0; i < total; i++) {
    if (png.data[(i << 2) + 3] > 0) opaque++;
  }
  return { width: png.width, height: png.height, opaqueFraction: opaque / total };
}

const BLOCKS_DIR = path.join(REPO_ROOT, 'textures', 'blocks');
const ITEMS_DIR = path.join(REPO_ROOT, 'textures', 'items');

/** Diffuse PNGs in a texture directory — normal (`_n`) and smoothness (`_s`) maps excluded. */
function diffuseNames(dir) {
  return new Set(
    fs.readdirSync(dir)
      .filter((f) => f.endsWith('.png') && !/_[ns]\.png$/.test(f))
      .map((f) => f.replace(/\.png$/, '')),
  );
}

function readManifest(file) {
  expect(fs.existsSync(file), `${path.relative(REPO_ROOT, file)} is committed`).toBe(true);
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

describe('texture coverage — blocks', () => {
  const blockPngs = diffuseNames(BLOCKS_DIR);
  const manifest = readManifest(path.join(BLOCKS_DIR, 'manifest.json'));

  // ── Seam 1: registry → disk ────────────────────────────────────────
  it('every texture named by BLOCK_REGISTRY exists on disk', () => {
    const missing = [];
    for (const block of BLOCK_REGISTRY) {
      if (!block.texture) continue; // air
      for (const [face, base] of Object.entries(block.texture)) {
        if (!blockPngs.has(base)) missing.push(`${block.name} (${face}): ${base}.png`);
      }
      for (const [face, base] of Object.entries(block.overlay || {})) {
        if (!blockPngs.has(base)) missing.push(`${block.name} overlay (${face}): ${base}.png`);
      }
    }
    expect(missing, `blocks referencing a texture that is not in textures/blocks/:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('the committed block manifest covers every textured registry block', () => {
    const textured = BLOCK_REGISTRY.filter((b) => b.texture).map((b) => b.id).sort((a, b) => a - b);
    const inManifest = manifest.map((e) => e.id).sort((a, b) => a - b);
    expect(inManifest, 'textures/blocks/manifest.json is stale — run `npm run generate-manifest`').toEqual(textured);
  });

  it('no manifest entry records a texture that failed to resolve', () => {
    const unresolved = manifest.flatMap((e) =>
      Object.entries(e.textures)
        .filter(([, f]) => !f.exists)
        .map(([face, f]) => `${e.name} (${face}): ${f.base}.png`),
    );
    expect(unresolved, `manifest faces with exists:false:\n  ${unresolved.join('\n  ')}`).toEqual([]);
  });

  // ── Seam 2: manifest → an icon the item atlas can actually pick ────
  //
  // This mirrors ItemTextureAtlas._pickIconTile. A block whose only face is one that
  // method does not consider would build a mesh correctly and still show an empty
  // inventory slot, which is the failure mode that is invisible outside the UI.
  it('every block offers a face the inventory icon picker will find', () => {
    const ICON_FACES = ['all', 'side', 'top', 'front', 'bottom'];
    const iconless = manifest
      .filter((e) => {
        const faces = Object.keys(e.textures).filter((f) => e.textures[f].exists);
        return faces.length > 0 && !ICON_FACES.some((f) => faces.includes(f));
      })
      .map((e) => `${e.name}: only [${Object.keys(e.textures).join(', ')}]`);
    expect(iconless, `blocks with no icon-able face:\n  ${iconless.join('\n  ')}`).toEqual([]);
  });

  it('every block declares at least one resolvable face', () => {
    const empty = manifest
      .filter((e) => !Object.values(e.textures).some((f) => f.exists))
      .map((e) => e.name);
    expect(empty, `blocks with no usable texture at all: ${empty.join(', ')}`).toEqual([]);
  });
});

describe('texture coverage — items', () => {
  const itemPngs = diffuseNames(ITEMS_DIR);
  const manifest = readManifest(path.join(ITEMS_DIR, 'manifest.json'));

  // ── Seam 3: NAMED_ITEMS → manifest ─────────────────────────────────
  // Set equality both ways. One direction catches an item added to ItemDefinitions.js
  // without regenerating; the other catches an item deleted from it, which would leave a
  // manifest entry pointing at a key the inventory can never hold.
  it('the item manifest and NAMED_ITEMS name exactly the same items', () => {
    const defined = Object.keys(NAMED_ITEMS).sort();
    const manifested = manifest.map((e) => e.key).sort();
    expect(manifested, 'textures/items/manifest.json is stale — run `npm run generate-manifest`').toEqual(defined);
  });

  it('every manifest entry carries the display name from NAMED_ITEMS', () => {
    const wrong = manifest
      .filter((e) => NAMED_ITEMS[e.key] && e.name !== NAMED_ITEMS[e.key].name)
      .map((e) => `${e.key}: manifest "${e.name}" vs definition "${NAMED_ITEMS[e.key].name}"`);
    expect(wrong, `display names out of sync:\n  ${wrong.join('\n  ')}`).toEqual([]);
  });

  // ── Seam 4: manifest → disk ────────────────────────────────────────
  it('every item texture exists on disk', () => {
    const missing = manifest
      .filter((e) => !itemPngs.has(e.texture))
      .map((e) => `${e.key} → ${e.texture}.png`);
    expect(missing, `items whose PNG is missing from textures/items/:\n  ${missing.join('\n  ')}`).toEqual([]);
  });

  it('no manifest entry records a texture that failed to resolve', () => {
    const unresolved = manifest.filter((e) => !e.exists).map((e) => `${e.key} → ${e.texture}.png`);
    expect(unresolved, `manifest entries with exists:false:\n  ${unresolved.join('\n  ')}`).toEqual([]);
  });

  // Two items intentionally borrow a texture whose name is not their key
  // (see ITEM_TEXTURE_OVERRIDES in scripts/generate-manifest.js). Everything else must
  // match by name, so a typo in a new item's key surfaces here rather than as a 404.
  // ── Seam 5: the file is an item ICON, not merely a file ────────────
  //
  // Seams 1-4 all ask "does a texture exist and resolve". All seven D-114 placeholders
  // passed every one of them. These two ask what the earlier seams cannot: is the thing
  // on the other end actually usable as an icon?

  it('no item texture fills its whole tile — that is a block texture, not an icon', () => {
    const filled = manifest
      .map((e) => ({ key: e.key, ...imageStats(path.join(ITEMS_DIR, `${e.texture}.png`)) }))
      .filter((s) => s.opaqueFraction > MAX_OPAQUE_FRACTION)
      .map((s) => `${s.key}: ${(s.opaqueFraction * 100).toFixed(1)}% opaque`);
    expect(filled, `item textures with no transparent margin:\n  ${filled.join('\n  ')}`).toEqual([]);
  });

  // Resolution is not cosmetic here. `_loadItemTexture` draws every source into a
  // 64×64 cell, so anything smaller is UPSCALED — the atlas still works, but the icon
  // is visibly chunkier than the 128px art beside it. Asserting ">= the atlas tile"
  // states the rule that actually matters and stays true if the tile size changes,
  // where asserting "== 128" would just encode today's pack.
  it('every item texture is square and at least the atlas tile size', () => {
    const bad = manifest
      .map((e) => ({ key: e.key, ...imageStats(path.join(ITEMS_DIR, `${e.texture}.png`)) }))
      .filter((s) => s.width !== s.height || s.width < ATLAS_TILE)
      .map((s) => `${s.key}: ${s.width}×${s.height} (atlas cell is ${ATLAS_TILE}×${ATLAS_TILE})`);
    expect(bad, `item textures the atlas would upscale or distort:\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('item textures are named after their key, apart from the two known overrides', () => {
    const OVERRIDDEN = new Set(['quest_key', 'compass']);
    const renamed = manifest
      .filter((e) => e.texture !== e.key && !OVERRIDDEN.has(e.key))
      .map((e) => `${e.key} → ${e.texture}.png`);
    expect(renamed, `unexpected texture aliases:\n  ${renamed.join('\n  ')}`).toEqual([]);
  });
});
