/**
 * Cuubz — Item Texture Generator
 *
 * Draws the 21 item icons the texture pack does not supply. Two groups, found by two
 * different questions:
 *
 *   14 items had NO PNG at all (D-112). `NAMED_ITEMS` listed them, nothing on disk did,
 *   and the inventory slot came up empty. `iron_ingot` alone has nine call sites.
 *
 *   7 items had a PNG that was not an item icon (D-114). `coal`, `bone`, `rotten_flesh`,
 *   `rabbit_hide`, `rabbit_meat`, `raw_venison` and `corrupt_fang` were full-bleed
 *   gradient squares with a crude blob in the middle — the "coloured boxes" report,
 *   surviving the first fix because a file-existence audit cannot tell a placeholder
 *   from art. The tell was decisive: all 217 real pack items ship `_n`/`_s` companion
 *   maps and all seven of these shipped none.
 *
 * ─── Why 128×128 from a 16×16 design ─────────────────────────────────
 *
 * The pack is 128×128 (217 files; 7 more at 256). The first version of this script
 * emitted 16×16, which the atlas upscaled 4× into its 64px cell — technically fine, the
 * atlas normalises every source to `tileSize`, but visibly chunkier and flatter than the
 * art beside it.
 *
 * Emitting 128×128 does not by itself fix that: the same design in bigger blocks is
 * pixel-identical once the atlas samples it down to 64. What closes the gap is DETAIL —
 * the pack's icons carry per-pixel noise and directional shading, and flat colour fills
 * read as placeholder next to them. So the 16×16 grid stays the authoring format,
 * because it is what makes these editable by hand, and `shade()` adds the texture at
 * render time.
 *
 * Shape fidelity is still 16×16-derived and that is a real remaining difference — the
 * silhouettes are coarser than the pack's. Detail was the larger half of the gap.
 *
 * ─── Determinism ──────────────────────────────────────────────────────
 *
 * No `Math.random()`. All variation comes from `hash2(x, y, seed)`, seeded off the item
 * name, so re-running produces byte-identical PNGs. That is what keeps the script
 * idempotent and keeps a re-run out of `git status`.
 *
 * Alpha stays hard 0 or 255 — never partial. Crisp silhouettes, and it keeps the
 * alpha-coverage assertion in test/unit/meta/textureCoverage.test.js meaningful: that
 * test flags a full-bleed square as "not an item icon", which is how D-114 gets caught
 * next time rather than by eye.
 *
 * Usage: node scripts/generate-item-textures.js [--force]
 *
 * Existing files are skipped unless --force, so a hand-painted replacement is safe.
 *
 * Each sprite is 16 rows of 16 chars. `L` outline, `H` lit face, `M` body, `D` shaded
 * face, `.` transparent; a few shapes add their own letters. `validateShape` enforces
 * the 16×16 and that every letter used has a palette entry, rather than trusting it.
 */

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const ITEMS_DIR = path.join(__dirname, '..', 'textures', 'items');
const GRID = 16;   // authoring grid
const SCALE = 8;   // → 128×128 output, matching the pack
const OUT = GRID * SCALE;
const FORCE = process.argv.includes('--force');

// Shading strengths, as fractions of the base colour. Tuned to sit alongside the pack
// without turning the art muddy: the noise is what reads as "texture" at icon size.
const GRADIENT = 0.20; // top-left lit → bottom-right shaded, across the whole sprite
const CELL_JITTER = 0.05; // per design-cell brightness, so flat fills stop looking flat
const NOISE = 0.085; // per-output-pixel grain

// ─── Shapes ───────────────────────────────────────────────────────────

const SHAPES = {
  ingot: [
    '................',
    '................',
    '................',
    '.....LLLLLLL....',
    '....LHHHHHHHL...',
    '...LHHHHHHHHL...',
    '..LHHHHHHHHML...',
    '..LHMMMMMMMML...',
    '..LMMMMMMMMDL...',
    '..LMMMMMMMDDL...',
    '...LDDDDDDDL....',
    '....LLLLLLL.....',
    '................',
    '................',
    '................',
    '................',
  ],

  gem: [
    '................',
    '................',
    '.....LLLLLL.....',
    '....LHHHHHHL....',
    '...LHHHHHHHHL...',
    '..LHHMMMMMMHL...',
    '..LHMMMMMMMML...',
    '..LMMMMMMMMML...',
    '..LMMMMMMMMDL...',
    '...LMMMMMMDL....',
    '....LMMMMDL.....',
    '.....LMMDL......',
    '......LDL.......',
    '.......L........',
    '................',
    '................',
  ],

  apple: [
    '................',
    '.......S........',
    '.......S.GG.....',
    '......SS.GG.....',
    '....LLLLLL......',
    '...LHHMMMMLL....',
    '..LHHMMMMMMML...',
    '..LHMMMMMMMML...',
    '..LMMMMMMMMDL...',
    '..LMMMMMMMMDL...',
    '..LMMMMMMMDDL...',
    '...LMMMMMDDL....',
    '...LMMMMMDDL....',
    '....LLMMDDL.....',
    '......LLL.......',
    '................',
  ],

  loaf: [
    '................',
    '................',
    '...LLLLLLLLLL...',
    '..LHHHHHHHHHHL..',
    '..LHMHMHMHMHHL..',
    '..LMMMMMMMMMML..',
    '..LMHMHMHMHMML..',
    '..LMMMMMMMMMML..',
    '..LMHMHMHMHMML..',
    '..LMMMMMMMMDML..',
    '..LDMMMMMMMDDL..',
    '...LDDDDDDDDL...',
    '....LLLLLLLL....',
    '................',
    '................',
    '................',
  ],

  berry: [
    '................',
    '................',
    '.......G........',
    '......GG........',
    '.....LLLL.......',
    '....LHHMMLL.....',
    '...LHMMMMMML....',
    '...LMMMMMMML....',
    '..LHMMMMMMMML...',
    '..LMMMMMMMMDL...',
    '..LMMMMMMMMDL...',
    '..LMMMMMMMDDL...',
    '...LMMMMMDDL....',
    '....LMMMDDL.....',
    '.....LLLLL......',
    '................',
  ],

  // Large cut of meat. Cooked and raw share it; only the palette differs.
  steak: [
    '................',
    '................',
    '....LLLLLL......',
    '...LHHHMMMLL....',
    '..LHHMMMMMMML...',
    '..LHMMMDDMMMDL..',
    '.LHMMMDDDDMMDL..',
    '.LMMMMDDDDMMDL..',
    '.LMMMMMDDMMMDL..',
    '.LMMMMMMMMMDDL..',
    '..LMMMMMMMMDDL..',
    '..LDMMMMMMDDL...',
    '...LDDMMMDDL....',
    '....LLDDDLL.....',
    '......LLL.......',
    '................',
  ],

  // Smaller cut, for rabbit — reads as a different portion beside `steak`.
  meatChunk: [
    '................',
    '................',
    '.....LLLL.......',
    '....LHHMMLL.....',
    '...LHMMMMMML....',
    '..LHMMDDMMMDL...',
    '..LMMDDDDMMDL...',
    '..LMMDDDDMMDL...',
    '..LMMMDDMMMDL...',
    '...LMMMMMMDL....',
    '....LMMMMDL.....',
    '.....LDDDL......',
    '......LLL.......',
    '................',
    '................',
    '................',
  ],

  hide: [
    '................',
    '..LL........LL..',
    '..LHL......LHL..',
    '..LHHLLLLLLHHL..',
    '..LHHHHHHHHHHL..',
    '.LHHMMMMMMMMHHL.',
    '.LHMMMMMMMMMMHL.',
    '.LMMMMMMMMMMMML.',
    '.LMMMMMMMMMMMDL.',
    '.LMMMMMMMMMMDDL.',
    '..LMMMMMMMMMDL..',
    '..LMMMMMMMMDL...',
    '...LDL....LDL...',
    '...LDL....LDL...',
    '...LLL....LLL...',
    '................',
  ],

  // Narrower pelt, for rabbit — same idiom as `hide`, smaller animal.
  pelt: [
    '................',
    '................',
    '...LL......LL...',
    '...LHL....LHL...',
    '...LHHLLLLHHL...',
    '...LHHHHHHHHL...',
    '..LHMMMMMMMMHL..',
    '..LMMMMMMMMMDL..',
    '..LMMMMMMMMDDL..',
    '..LMMMMMMMMMDL..',
    '...LMMMMMMMDL...',
    '...LDL....LDL...',
    '...LDL....LDL...',
    '...LLL....LLL...',
    '................',
    '................',
  ],

  shard: [
    '................',
    '.........L......',
    '........LHL.....',
    '.......LHML.....',
    '.....L.LHMDL....',
    '....LHLLHMDL....',
    '....LHMLHMDL....',
    '...LHMMLHMDL....',
    '...LHMMLHMDL....',
    '...LHMMLMMDL....',
    '...LHMMMMMDL....',
    '....LHMMMDDL....',
    '....LMMMMDL.....',
    '.....LMMDL......',
    '......LLL.......',
    '................',
  ],

  // Raw ore chunk. `O` is the ore inclusion, `M` the surrounding stone.
  rawOre: [
    '................',
    '................',
    '.....LLLL.......',
    '....LHHMMLL.....',
    '...LHMMMMMML....',
    '..LHMMOOMMMML...',
    '..LMMOOOOMMDL...',
    '..LMMOOOOMMDL...',
    '..LMMMOOMMMDL...',
    '..LMMMMMMMMDL...',
    '...LMMMMMMDL....',
    '...LMMMMMDDL....',
    '....LDDDDDL.....',
    '.....LLLLL......',
    '................',
    '................',
  ],

  // Irregular lump, for coal — deliberately less symmetric than `rawOre`.
  lump: [
    '................',
    '................',
    '.....LLLL.......',
    '....LHHMLL......',
    '...LHMMMMML.....',
    '..LHMMMMMMML....',
    '..LMMMDMMMDL....',
    '..LMMDDMMDDL....',
    '..LMMMMMMMDL....',
    '...LMMMMMDDL....',
    '...LMDDMMDDL....',
    '....LDDDDDL.....',
    '.....LLLLL......',
    '................',
    '................',
    '................',
  ],

  bone: [
    '................',
    '.....LL..LL.....',
    '....LHHLLHHL....',
    '....LHHHHHHL....',
    '....LHMMMMHL....',
    '.....LLMMLL.....',
    '......LMML......',
    '......LMML......',
    '......LMML......',
    '......LMML......',
    '.....LLMMLL.....',
    '....LHMMMMHL....',
    '....LHHHHHHL....',
    '....LHHLLHHL....',
    '.....LL..LL.....',
    '................',
  ],

  // Ragged edge, for rotten flesh — the silhouette is the whole point.
  ragged: [
    '................',
    '................',
    '....LLL.LL......',
    '...LHMMLHML.....',
    '..LHMMMMMMML....',
    '..LMMDMMMDML....',
    '.LHMMMMDMMMML...',
    '.LMMMDMMMMMDL...',
    '.LMMMMMMDMMML...',
    '..LMMDMMMMMDL...',
    '..LMMMMDMMML....',
    '...LMDMMMMDL....',
    '....LMMMDML.....',
    '.....LLDLL......',
    '......LL........',
    '................',
  ],

  fang: [
    '................',
    '.......LL.......',
    '......LHHL......',
    '......LHHL......',
    '......LHML......',
    '......LHML......',
    '.....LHHML......',
    '.....LHMML......',
    '.....LMMDL......',
    '....LHMMDL......',
    '....LMMDDL......',
    '....LMDDL.......',
    '....LDDL........',
    '....LDL.........',
    '....LL..........',
    '................',
  ],
};

// ─── Items ────────────────────────────────────────────────────────────

const STONE = { L: '#3b3b3b', H: '#a8a8a8', M: '#8a8a8a', D: '#6b6b6b' };

const ITEMS = [
  // ── D-112: had no PNG at all ──────────────────────────────────────
  { name: 'copper_ingot',    shape: 'ingot', palette: { L: '#4a2412', H: '#e5a06a', M: '#c1663a', D: '#8a4423' } },
  { name: 'iron_ingot',      shape: 'ingot', palette: { L: '#4a4a4a', H: '#f0f0f0', M: '#d8d8d8', D: '#a0a0a0' } },
  { name: 'gold_ingot',      shape: 'ingot', palette: { L: '#6b4a08', H: '#ffe97a', M: '#f5c518', D: '#b8890c' } },
  { name: 'netherite_ingot', shape: 'ingot', palette: { L: '#141014', H: '#6b5f5c', M: '#4a403f', D: '#2b2426' } },

  { name: 'diamond',         shape: 'gem',   palette: { L: '#1a5c63', H: '#b8f7ee', M: '#5ce2d4', D: '#2ea79c' } },

  { name: 'apple',           shape: 'apple', palette: { L: '#4a0f0f', H: '#f07070', M: '#d02b2b', D: '#8f1a1a', S: '#6b4a20', G: '#3f8f2a' } },
  { name: 'golden_apple',    shape: 'apple', palette: { L: '#6b4a08', H: '#ffe97a', M: '#f5c518', D: '#b8890c', S: '#6b4a20', G: '#3f8f2a' } },

  { name: 'bread',           shape: 'loaf',  palette: { L: '#4a2e10', H: '#e8b464', M: '#c88f3c', D: '#8f6023' } },
  { name: 'berry',           shape: 'berry', palette: { L: '#3f0a18', H: '#f07a92', M: '#c4213f', D: '#8a132a', G: '#3f8f2a' } },
  { name: 'cooked_meat',     shape: 'steak', palette: { L: '#3a1a0c', H: '#c98552', M: '#9c5a30', D: '#68371c' } },
  { name: 'leather',         shape: 'hide',  palette: { L: '#4a3418', H: '#c9a06a', M: '#a67c47', D: '#7a5730' } },
  { name: 'corrupt_crystal', shape: 'shard', palette: { L: '#2a0f3f', H: '#d9a0ff', M: '#9b3fd9', D: '#63219c' } },

  { name: 'iron_ore',        shape: 'rawOre', palette: { ...STONE, O: '#d8af93' } },
  { name: 'gold_ore',        shape: 'rawOre', palette: { ...STONE, O: '#f5c518' } },

  // ── D-114: had a PNG, but it was a full-bleed placeholder square ───
  { name: 'coal',         shape: 'lump',      palette: { L: '#0a0a0a', H: '#4a4a4a', M: '#2c2c2c', D: '#171717' } },
  { name: 'bone',         shape: 'bone',      palette: { L: '#8a8570', H: '#fffdf0', M: '#e8e4d0', D: '#bfb9a0' } },
  { name: 'rotten_flesh', shape: 'ragged',    palette: { L: '#3a1f28', H: '#a4707a', M: '#7d4a55', D: '#54303a' } },
  { name: 'rabbit_hide',  shape: 'pelt',      palette: { L: '#5a4a38', H: '#d4bb96', M: '#b09270', D: '#856b4e' } },
  { name: 'rabbit_meat',  shape: 'meatChunk', palette: { L: '#5a2028', H: '#f0a0a8', M: '#d4666f', D: '#a03c46' } },
  { name: 'raw_venison',  shape: 'steak',     palette: { L: '#4a1218', H: '#d4707a', M: '#a83440', D: '#75202a' } },
  { name: 'corrupt_fang', shape: 'fang',      palette: { L: '#2a0f3f', H: '#f0e0ff', M: '#c9a0e0', D: '#8f5fb0' } },
];

// ─── Generation ───────────────────────────────────────────────────────

function validateShape(itemName, shapeName, rows, palette) {
  if (rows.length !== GRID) {
    throw new Error(`${shapeName}: ${rows.length} rows, expected ${GRID}`);
  }
  for (let y = 0; y < GRID; y++) {
    if (rows[y].length !== GRID) {
      throw new Error(`${shapeName} row ${y}: ${rows[y].length} chars, expected ${GRID}`);
    }
    for (const ch of rows[y]) {
      if (ch !== '.' && !palette[ch]) {
        throw new Error(`${itemName}: shape ${shapeName} uses '${ch}', missing from its palette`);
      }
    }
  }
}

function hexToRGB(hex) {
  return [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
}

/** Stable [0,1) from three integers. Replaces Math.random() so output is reproducible. */
function hash2(x, y, seed) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 2246822519);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Item name → integer seed, so two items never share a noise field. */
function seedFor(name) {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));

/**
 * Brightness multiplier for one output pixel.
 *
 * Three layers, each doing a different job: `grad` puts a light direction on the whole
 * sprite, `jitter` varies whole design-cells so a flat fill stops reading as flat, and
 * `noise` is the per-pixel grain that makes this sit next to the pack's art.
 */
function shade(x, y, bx, by, seed) {
  const t = (x + y) / (2 * (OUT - 1));            // 0 at top-left → 1 at bottom-right
  const grad = GRADIENT * (0.5 - t);
  const jitter = (hash2(bx, by, seed) - 0.5) * CELL_JITTER;
  const noise = (hash2(x, y, seed ^ 0x9e3779b9) - 0.5) * NOISE;
  return 1 + grad + jitter + noise;
}

function renderItem(item) {
  const rows = SHAPES[item.shape];
  if (!rows) throw new Error(`${item.name}: unknown shape '${item.shape}'`);
  validateShape(item.name, item.shape, rows, item.palette);

  const seed = seedFor(item.name);
  const rgbCache = {};
  for (const [ch, hex] of Object.entries(item.palette)) rgbCache[ch] = hexToRGB(hex);

  const png = new PNG({ width: OUT, height: OUT });
  for (let y = 0; y < OUT; y++) {
    for (let x = 0; x < OUT; x++) {
      const idx = (y * OUT + x) << 2;
      const bx = (x / SCALE) | 0;
      const by = (y / SCALE) | 0;
      const ch = rows[by][bx];

      if (ch === '.') {
        png.data[idx] = png.data[idx + 1] = png.data[idx + 2] = png.data[idx + 3] = 0;
        continue;
      }

      const [r, g, b] = rgbCache[ch];
      const f = shade(x, y, bx, by, seed);
      png.data[idx] = clamp255(r * f);
      png.data[idx + 1] = clamp255(g * f);
      png.data[idx + 2] = clamp255(b * f);
      png.data[idx + 3] = 255; // hard alpha — see the header
    }
  }
  return PNG.sync.write(png);
}

let written = 0;
let skipped = 0;

for (const item of ITEMS) {
  const outPath = path.join(ITEMS_DIR, `${item.name}.png`);
  if (fs.existsSync(outPath) && !FORCE) {
    skipped++;
    continue;
  }
  fs.writeFileSync(outPath, renderItem(item));
  console.log(`  ✓ ${item.name}.png  ${OUT}×${OUT}`);
  written++;
}

console.log(`\n${written} written, ${skipped} already present (pass --force to overwrite)`);
