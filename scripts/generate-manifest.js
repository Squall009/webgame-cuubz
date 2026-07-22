/**
 * Cuubz — Manifest Generator
 * 
 * Scans textures/blocks/ for all diffuse PNGs, cross-references with
 * blockRegistry.js, and outputs textures/blocks/manifest.json.
 * 
 * Usage: node scripts/generate-manifest.js
 */

const fs = require('fs');
const path = require('path');

const BLOCKS_DIR = path.join(__dirname, '..', 'textures', 'blocks');
const OUTPUT_PATH = path.join(BLOCKS_DIR, 'manifest.json');

// ─── Load block registry ──────────────────────────────────────────────
// We can't use ES module imports in Node, so read and parse the file.
const registryPath = path.join(__dirname, '..', 'js', 'world', 'blockRegistry.js');
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
