/**
 * Cuubz — fallback colours for dropped-item cubes (PR 17)
 *
 * The dropped-item mesh is a plain `MeshLambertMaterial` cube, not a textured block, so
 * it needs a colour per type id. This table was a function declared inside
 * `startGame()`'s step 13; `refactor.md` §4.1 puts data tables under `src/game/data/`
 * and this is one.
 *
 * **It is a fallback, and it is stale.** The ids are hand-written and predate the block
 * renumbering: **3 is cobblestone and this table paints it dirt-brown, 4 is andesite and
 * this table paints it grass-green**, 148 of the registry's 162 ids are absent (so every
 * one of them drops a grey cube), and 21 of the 34 ids here no longer exist at all. Same
 * class as PR 4's "andesite dropped cobblestone" — a pre-renumbering id table nothing
 * regenerated. `BUGS.md` **D-51**, owned by **PR 23**, which is the pass that gives block
 * visuals one source of truth. **Not fixed here**: PR 17 is an extraction, and picking
 * the 162 colours is a content change with no test that can tell right from wrong.
 */

const BLOCK_DROP_COLORS = {
  0: '#888888', 1: '#333333', 2: '#808080', 3: '#8B4513', 4: '#228B22',
  5: '#F4A460', 6: '#808080', 7: '#4169E1', 8: '#2c2c2c', 9: '#CD853F',
  10: '#FFD700', 11: '#00CED1', 12: '#888888', 13: '#FFFFFF', 14: '#DCDCDC',
  15: '#FF4500', 16: '#B22222', 17: '#FF6347', 18: '#87CEEB', 19: '#B0C4DE',
  32: '#8B4513', 33: '#228B22', 34: '#DEB887', 35: '#1a0a2e', 36: '#36454F',
  37: '#32CD32', 38: '#9400D3', 39: '#8B0000', 40: '#FF0000', 41: '#FFD700',
  42: '#FF69B4', 43: '#FFD700', 44: '#FFA500', 45: '#FFFF00',
};

const NAMED_DROP_COLORS = {
  coal: '#2c2c2c', iron_ore: '#CD853F', gold_ore: '#FFD700',
  diamond: '#00CED1', corrupt_crystal: '#9400D3',
  apple: '#FF0000', cooked_meat: '#8B4513', berry: '#8B008B',
  bread: '#DEB887', golden_apple: '#FFD700',
};

/**
 * @param {number|string} blockType — a block id, or a named item id
 * @returns {string} a CSS colour; `#888888` for anything unlisted
 */
export function getBlockColor(blockType) {
  if (typeof blockType === 'string') {
    return NAMED_DROP_COLORS[blockType] || '#888888';
  }
  return BLOCK_DROP_COLORS[blockType] || '#888888';
}
