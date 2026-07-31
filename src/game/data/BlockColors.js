/**
 * Cuubz — colours for dropped-item cubes (PR 17, fixed in PR 23 — BUGS.md D-51)
 *
 * The dropped-item mesh is a plain `MeshLambertMaterial` cube, not a textured block, so
 * it needs one colour per type id.
 *
 * ─── WHAT WAS HERE, AND WHY IT WAS DELETED ──────────────────────────────────
 *
 * A hand-written 34-entry `BLOCK_DROP_COLORS` table of id → hex, written before the block
 * renumbering and never regenerated. Measured against the live 193-entry registry:
 * **id 3 is `cobblestone` and the table painted it dirt-brown; id 4 is `andesite` and the
 * table painted it grass-green**; 148+ registry ids were absent, so every one of them
 * dropped a grey cube; and **21 of the table's 34 ids do not exist in the registry at
 * all**. Same class as PR 4's "andesite dropped cobblestone".
 *
 * ─── WHY THE FIX IS A PIXEL READBACK AND NOT A BIGGER TABLE (decision 47) ───
 *
 * There is nothing to generate a colour FROM. Registry entries are
 * `{id, name, texture, category, hardness, tool}`; `color:` appears on exactly 2 of 193
 * (float RGB triples used as a mesh tint for two flowers that share one texture). Writing
 * 193 hex codes by hand would produce the same table with a longer shelf life — the defect
 * is the hand-writing, not the length.
 *
 * So the colour is DERIVED FROM THE ATLAS TILE the block is already drawn with: the mean
 * RGB of its diffuse tile's pixels, computed on first use and cached per id. A block's
 * dropped cube is now, by construction, the average colour of that block. `TextureAtlas`
 * already exposes `diffuseCanvas` and per-block `tileMap` coordinates, and
 * `src/ui/hud/Hotbar.js:renderItemIcon` already samples them exactly this way — this
 * follows that access pattern rather than inventing a second one.
 *
 * ─── THE FALLBACK IS LOAD-BEARING ───────────────────────────────────────────
 *
 * `#888888` is returned, and NOT cached, whenever: no atlas has been registered yet, the
 * atlas has not finished building, the block has no tile, the tile has no opaque pixels,
 * or `getImageData` throws. That last one is not hypothetical — a canvas tainted by a
 * cross-origin draw throws `SecurityError` on readback, and the dropped-item cube must
 * never be the thing that breaks a frame. Not caching the fallback is what lets the real
 * colour appear once the atlas finishes loading.
 *
 * In Node (`test/`) no atlas is ever registered, so the fallback path is the only one that
 * runs and nothing here touches the DOM.
 */

import { BLOCK_BY_ID } from '../../engine/world/BlockRegistry.js';

/** The colour for "we do not know" — unchanged from the original table's default. */
export const FALLBACK_COLOR = '#888888';

/**
 * Named (non-block) items have no tile in the BLOCK atlas, and their keys are NAMES, not
 * ids — so this table cannot rot the way an id table does. It is kept, and kept small,
 * deliberately: renaming an item is a rename across the whole codebase, while renumbering
 * blocks is a one-line edit in the registry. D-51 is about the latter.
 */
const NAMED_DROP_COLORS = {
  coal: '#2c2c2c', iron_ore: '#CD853F', gold_ore: '#FFD700',
  diamond: '#00CED1', corrupt_crystal: '#9400D3',
  apple: '#FF0000', cooked_meat: '#8B4513', berry: '#8B008B',
  bread: '#DEB887', golden_apple: '#FFD700',
};

/** The live block texture atlas, or null before one is built. */
let _atlas = null;

/** blockId → '#rrggbb'. Only ever holds successfully derived colours. */
const _cache = new Map();

/**
 * Point this module at the live `PBRTextureAtlas`.
 *
 * Called from `src/core/init/initScene.js` once the atlas is built, and again from
 * `src/core/Bootstrap.js` when a texture-resolution change rebuilds it — the cache is
 * cleared on every call, because a new atlas is a new pixel layout.
 *
 * @param {object|null} atlas
 */
export function registerBlockColorAtlas(atlas) {
  _atlas = atlas || null;
  _cache.clear();
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
const toHex = (r, g, b) =>
  '#' + [r, g, b].map((c) => clamp255(c).toString(16).padStart(2, '0')).join('');

/**
 * Mean RGB of a block's atlas tile, or null if it cannot be read.
 * @param {number} blockId
 * @returns {string|null}
 */
function deriveFromAtlas(blockId) {
  const atlas = _atlas;
  if (!atlas || !atlas.loaded || !atlas.diffuseCanvas || !atlas.tileMap) return null;

  const entry = atlas.tileMap[blockId];
  if (!entry || !entry.tiles) return null;
  // The same face preference Hotbar.renderItemIcon uses: the top face is what an item
  // icon and a dropped cube both read as "the colour of this block".
  const tile = entry.tiles.top || entry.tiles.side || entry.tiles.all;
  if (!tile) return null;

  let data;
  try {
    const ctx = atlas.diffuseCanvas.getContext('2d');
    if (!ctx) return null;
    const cell = atlas.tileSize + atlas._gap;
    const x = atlas._gap + tile.col * cell;
    const y = atlas._gap + tile.row * cell;
    data = ctx.getImageData(x, y, atlas.tileSize, atlas.tileSize).data;
  } catch {
    // Tainted canvas, zero-size canvas, out-of-bounds tile — any of these must degrade to
    // grey rather than throw into the render loop.
    return null;
  }

  // Alpha-weighted mean. Cutout tiles (leaves, flowers, torches) are mostly transparent,
  // and a straight mean would drag every one of them toward black.
  let r = 0, g = 0, b = 0, weight = 0;
  for (let i = 0; i < data.length; i += 4) {
    const a = data[i + 3] / 255;
    if (a <= 0.03) continue;
    r += data[i] * a;
    g += data[i + 1] * a;
    b += data[i + 2] * a;
    weight += a;
  }
  if (weight <= 0) return null; // fully transparent tile — nothing to average

  r /= weight; g /= weight; b /= weight;

  // The two registry entries that carry an explicit `color:` triple WIN — as a multiplier,
  // which is exactly what the mesh builder does with the same field. red_flower and
  // yellow_flower share ONE texture, so the derived mean alone would give both flowers an
  // identical colour, erasing the distinction that field exists to express. Multiplying
  // keeps the texture's own value AND the distinction.
  const block = BLOCK_BY_ID[blockId];
  if (block && Array.isArray(block.color)) {
    r *= block.color[0];
    g *= block.color[1];
    b *= block.color[2];
  }

  return toHex(r, g, b);
}

/**
 * @param {number|string} blockType — a block id, or a named item id
 * @returns {string} a CSS colour; `#888888` when nothing can be derived
 */
export function getBlockColor(blockType) {
  if (typeof blockType === 'string') {
    return NAMED_DROP_COLORS[blockType] || FALLBACK_COLOR;
  }

  const cached = _cache.get(blockType);
  if (cached) return cached;

  const derived = deriveFromAtlas(blockType);
  if (derived) {
    _cache.set(blockType, derived); // at most one readback per block type per session
    return derived;
  }
  // Deliberately NOT cached — the atlas may simply not be loaded yet.
  return FALLBACK_COLOR;
}
