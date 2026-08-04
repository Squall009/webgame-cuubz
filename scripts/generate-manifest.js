/**
 * Cuubz — Manifest Generator
 *
 * Writes TWO manifests, one per atlas:
 *
 *   textures/blocks/manifest.json — scans textures/blocks/ for diffuse PNGs and
 *     cross-references src/engine/world/BlockRegistry.js.
 *   textures/items/manifest.json  — scans textures/items/ and cross-references
 *     NAMED_ITEMS in src/game/data/ItemDefinitions.js.
 *
 * The items half is new. `ItemTextureAtlas` used to carry its own hand-maintained copy
 * of the item list, and the two drifted: fourteen NAMED_ITEMS entries had no atlas slot
 * at all and so rendered as an empty inventory tile. Deriving the manifest from
 * NAMED_ITEMS is what makes that class of drift impossible — adding an item to
 * ItemDefinitions.js now adds it to the atlas, and a missing PNG is reported here
 * instead of turning into a silent 404 at runtime.
 *
 * Usage: node scripts/generate-manifest.js
 */

const fs = require('fs');
const path = require('path');

const BLOCKS_DIR = path.join(__dirname, '..', 'textures', 'blocks');
const OUTPUT_PATH = path.join(BLOCKS_DIR, 'manifest.json');
const ITEMS_DIR = path.join(__dirname, '..', 'textures', 'items');
const ITEMS_OUTPUT_PATH = path.join(ITEMS_DIR, 'manifest.json');

/**
 * Item keys whose PNG is not named after the key.
 *
 * Kept deliberately small — every entry here is a place where the texture pack and the
 * game disagree on a name, and the fix for a new one is usually to rename the file
 * rather than to grow this table.
 */
const ITEM_TEXTURE_OVERRIDES = {
  quest_key: 'disc_fragment_5', // the pack has no key sprite; the disc fragment stands in
  compass: 'compass_00',        // compass_00..31 are spin frames; frame 0 is the icon
};

// ─── Load block registry ──────────────────────────────────────────────
// We can't use ES module imports in Node, so read and parse the file.
const registryPath = path.join(__dirname, '..', 'src', 'engine', 'world', 'BlockRegistry.js');
const registrySource = fs.readFileSync(registryPath, 'utf8');

// Extract BLOCK_REGISTRY array via eval (it's a const array of plain objects)
const BLOCK_REGISTRY = eval('(' + registrySource.match(/const BLOCK_REGISTRY = (\[.*?\]);/s)[1] + ')');

// ─── Scan textures/blocks/ for diffuse PNGs ───────────────────────────
const allFiles = fs.readdirSync(BLOCKS_DIR);
const diffuseFiles = new Set();

for (const file of allFiles) {
  if (!file.endsWith('.png')) continue;
  // Exclude normal maps (_n.png) and smoothness maps (_s.png)
  if (/_n\.png$/.test(file) || /_s\.png$/.test(file)) continue;
  // Exclude manifest.json itself
  if (file === 'manifest.json') continue;

  const base = file.replace('.png', '');
  diffuseFiles.add(base);
}

console.log(`Scanned ${BLOCKS_DIR}: ${diffuseFiles.size} diffuse textures found`);

// ─── Build manifest ───────────────────────────────────────────────────
const manifest = [];
const missingTextures = [];
const unusedTextures = new Set(diffuseFiles); // Track which textures are NOT used

for (const block of BLOCK_REGISTRY) {
  // Skip air
  if (!block.texture) continue;

  const entry = {
    id: block.id,
    name: block.name,
    textures: {}
  };

  // Pass through color multiplier (per-face RGB: [r, g, b] where 0-1)
  if (block.color) {
    entry.color = block.color; // Single [r,g,b] for all faces
  }

  // Pass through overlay texture definitions
  if (block.overlay) {
    entry.overlay = block.overlay;
    // Register overlay textures so they're included in the atlas
    for (const [face, overlayBase] of Object.entries(block.overlay)) {
      const exists = diffuseFiles.has(overlayBase);
      if (exists) unusedTextures.delete(overlayBase);
      if (!exists) missingTextures.push(`${block.name} overlay (${face}): ${overlayBase}.png`);
    }
  }

  // Handle { all: 'name' } format
  if (block.texture.all) {
    const base = block.texture.all;
    const exists = diffuseFiles.has(base);
    entry.textures.all = { base, exists };
    if (exists) unusedTextures.delete(base);
    if (!exists) missingTextures.push(`${block.name}: ${base}.png`);
    manifest.push(entry);
    continue;
  }

  // Handle per-face format: { top, side, bottom, front, back, left, right }
  const faceKeys = ['top', 'side', 'bottom', 'front', 'back', 'left', 'right'];
  for (const face of faceKeys) {
    if (block.texture[face]) {
      const base = block.texture[face];
      const exists = diffuseFiles.has(base);
      entry.textures[face] = { base, exists };
      if (exists) unusedTextures.delete(base);
      if (!exists) missingTextures.push(`${block.name} (${face}): ${base}.png`);
    }
  }

  manifest.push(entry);
}

// ─── Report ────────────────────────────────────────────────────────────
console.log(`\nManifest: ${manifest.length} block entries`);

if (missingTextures.length > 0) {
  console.warn(`\n⚠  Missing textures (${missingTextures.length}):`);
  for (const m of missingTextures.slice(0, 20)) {
    console.warn(`   - ${m}`);
  }
  if (missingTextures.length > 20) {
    console.warn(`   ... and ${missingTextures.length - 20} more`);
  }
} else {
  console.log('✓ All registry textures found');
}

if (unusedTextures.size > 0) {
  console.log(`\nℹ  Unused textures in blocks/ (${unusedTextures.size} diffuse files not referenced by registry)`);
  console.log('   These are available for future block definitions.');
}

// ─── Write manifest.json ──────────────────────────────────────────────
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(manifest, null, 2), 'utf8');
console.log(`\n✓ Written: ${OUTPUT_PATH}`);

// ══ Items ═════════════════════════════════════════════════════════════
// ItemDefinitions.js is an ES module and this script is CommonJS, so it comes in via a
// dynamic import rather than the eval-scrape used for the block registry above. It can:
// that file imports nothing (its own header makes that a hard rule), so importing it has
// no side effects and pulls in no transitive graph. The block registry is left on the
// scrape because test/unit/meta/manifestGenerator.test.js guards that parse specifically.

(async () => {
  const itemDefsPath = path.join(__dirname, '..', 'src', 'game', 'data', 'ItemDefinitions.js');
  const { NAMED_ITEMS } = await import(`file://${itemDefsPath.replace(/\\/g, '/')}`);

  // Scan textures/items/ for diffuse PNGs, on the same rules as blocks/.
  const itemDiffuse = new Set();
  for (const file of fs.readdirSync(ITEMS_DIR)) {
    if (!file.endsWith('.png')) continue;
    if (/_n\.png$/.test(file) || /_s\.png$/.test(file)) continue;
    itemDiffuse.add(file.replace('.png', ''));
  }

  console.log(`\nScanned ${ITEMS_DIR}: ${itemDiffuse.size} diffuse textures found`);

  const itemManifest = [];
  const missingItems = [];

  for (const [key, def] of Object.entries(NAMED_ITEMS)) {
    const texture = ITEM_TEXTURE_OVERRIDES[key] || key;
    const exists = itemDiffuse.has(texture);
    if (!exists) missingItems.push(`${key}: ${texture}.png`);
    itemManifest.push({ key, name: def.name, texture, exists });
  }

  console.log(`\nItem manifest: ${itemManifest.length} item entries`);

  if (missingItems.length > 0) {
    console.warn(`\n⚠  Missing item textures (${missingItems.length}):`);
    for (const m of missingItems) console.warn(`   - ${m}`);
    console.warn('   Run: node scripts/generate-item-textures.js');
  } else {
    console.log('✓ All NAMED_ITEMS textures found');
  }

  fs.writeFileSync(ITEMS_OUTPUT_PATH, JSON.stringify(itemManifest, null, 2), 'utf8');
  console.log(`\n✓ Written: ${ITEMS_OUTPUT_PATH}`);
})();
