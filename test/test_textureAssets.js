#!/usr/bin/env node
/**
 * Cuubz — Texture Asset Verification Tests
 * Phase 4 Pre-Deployment: Verify all texture PNGs are present and correctly sized.
 */

const fs = require('fs');
const path = require('path');

// We use Node.js to verify textures without needing PIL
// Read PNG header to extract dimensions (first 24 bytes of a PNG file)
function getPngDimensions(filePath) {
  const buf = fs.readFileSync(filePath);
  // PNG signature check
  if (buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) {
    return { error: 'Not a valid PNG file' };
  }

  // Find IHDR chunk (always the first chunk after signature)
  // Offset 8 = length (4 bytes), type (4 bytes = "IHDR"), then width (4 bytes big-endian), height (4 bytes big-endian)
  if (buf.length < 24) {
    return { error: 'PNG file too small' };
  }

  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);

  // Sanity check for obviously wrong dimensions
  if (width === 0 || height === 0 || width > 4096 || height > 4096) {
    return { error: `Suspicious dimensions: ${width}x${height}` };
  }

  return { width, height };
}

let PASS = 0;
let FAIL = 0;
let TOTAL = 0;

function assert(condition, message) {
  TOTAL++;
  if (condition) {
    PASS++;
  } else {
    FAIL++;
    console.error(`  FAIL: ${message}`);
  }
}

const texDir = path.join(__dirname, '..', 'textures');

// Expected textures from todo.md Block Type Registry + Phase 3 additions
const EXPECTED_TEXTURES = [
  // Core block textures (Phase 1)
  'grass_top', 'grass_side', 'dirt', 'stone', 'sand', 'gravel',
  'water', 'wood_log', 'leaves', 'snow', 'ice', 'bedrock',
  'planks', 'obsidian', 'blackstone', 'lava', 'corrupt_stone',
  'toxic_slime', 'coal_ore', 'iron_ore', 'gold_ore', 'diamond_ore',
  'corrupt_cry', 'apple', 'quest_key', 'bed',
  // Phase 3 additions (biome visual polish)
  'red_flower', 'yellow_flower', 'cave_torch', 'glowstone'
];

// ============================================================
// Group 1: Texture directory exists
// ============================================================
console.log('Group 1: Texture directory');
{
  const dirExists = fs.existsSync(texDir);
  assert(dirExists, `textures/ directory exists at ${texDir}`);
}

// ============================================================
// Group 2: All expected textures present
// ============================================================
console.log('Group 2: Expected textures present');
{
  const actualFiles = new Set();
  if (fs.existsSync(texDir)) {
    for (const f of fs.readdirSync(texDir)) {
      if (f.endsWith('.png')) {
        actualFiles.add(f.replace('.png', ''));
      }
    }
  }

  const missing = EXPECTED_TEXTURES.filter(t => !actualFiles.has(t));
  assert(missing.length === 0, `All ${EXPECTED_TEXTURES.length} expected textures present (missing: ${missing.join(', ') || 'none'})`);

  // Check each individually for clear reporting
  for (const tex of EXPECTED_TEXTURES) {
    const fpath = path.join(texDir, `${tex}.png`);
    assert(fs.existsSync(fpath), `${tex}.png exists in textures/`);
  }
}

// ============================================================
// Group 3: All PNGs are valid and 32x32
// ============================================================
console.log('Group 3: PNG validity and dimensions');
{
  const pngFiles = [];
  if (fs.existsSync(texDir)) {
    for (const f of fs.readdirSync(texDir)) {
      if (f.endsWith('.png')) {
        pngFiles.push(f);
      }
    }
  }

  assert(pngFiles.length >= EXPECTED_TEXTURES.length, `At least ${EXPECTED_TEXTURES.length} PNG files found (found ${pngFiles.length})`);

  let all32x32 = true;
  let validPngs = 0;

  for (const f of pngFiles.sort()) {
    const fpath = path.join(texDir, f);
    try {
      const dims = getPngDimensions(fpath);
      if (dims.error) {
        console.error(`  FAIL: ${f} — ${dims.error}`);
        all32x32 = false;
      } else {
        validPngs++;
        if (dims.width === 32 && dims.height === 32) {
          assert(true, `${f}: valid PNG at 32x32`);
        } else {
          console.error(`  FAIL: ${f}: ${dims.width}x${dims.height} (expected 32x32)`);
          all32x32 = false;
        }
      }
    } catch (e) {
      console.error(`  FAIL: ${f} — ${e.message}`);
      all32x32 = false;
    }
  }

  assert(validPngs === pngFiles.length, `All ${pngFiles.length} PNG files are valid`);
  assert(all32x32, 'All textures are exactly 32x32 pixels');
}

// ============================================================
// Group 4: File size sanity check
// ============================================================
console.log('Group 4: File size sanity check');
{
  if (fs.existsSync(texDir)) {
    for (const f of fs.readdirSync(texDir).sort()) {
      if (!f.endsWith('.png')) continue;

      const fpath = path.join(texDir, f);
      const stats = fs.statSync(fpath);
      const size = stats.size;

      // PNG files should be between 100 bytes and 10KB for 32x32 textures
      assert(size > 100, `${f}: file size ${size}B > 100B minimum (not empty/corrupt)`);
      assert(size < 10240, `${f}: file size ${size}B < 10KB maximum (reasonable for 32x32)`);
    }
  }
}

// ============================================================
// Group 5: No unexpected files in textures directory
// ============================================================
console.log('Group 5: Directory cleanliness');
{
  if (fs.existsSync(texDir)) {
    const allFiles = fs.readdirSync(texDir);
    const nonPng = allFiles.filter(f => !f.endsWith('.png'));
    assert(nonPng.length === 0, `No non-PNG files in textures/ (found: ${nonPng.join(', ') || 'none'})`);

    // Check for hidden files or temp files
    const hidden = allFiles.filter(f => f.startsWith('.'));
    assert(hidden.length === 0, `No hidden files in textures/ (found: ${hidden.join(', ') || 'none'})`);
  }
}

// ============================================================
// Group 6: Texture generator script exists
// ============================================================
console.log('Group 6: Texture generator script');
{
  const genScript = path.join(__dirname, '..', 'scripts', 'generate_textures.py');
  assert(fs.existsSync(genScript), 'scripts/generate_textures.py exists for texture regeneration');

  if (fs.existsSync(genScript)) {
    const content = fs.readFileSync(genScript, 'utf8');
    assert(content.includes('PIL') || content.includes('Image'), 'Generator uses PIL/Pillow for image creation');
    assert(content.includes('32'), 'Generator references 32x32 resolution');
  }
}

// ============================================================
// Group 7: Block registry consistency
// ============================================================
console.log('Group 7: Block registry consistency');
{
  // Check multiple possible locations for block type definitions
  const possiblePaths = [
    path.join(__dirname, '..', 'js', 'world', 'chunkData.js'),
    path.join(__dirname, '..', 'js', 'systems', 'inventory.js'),
    path.join(__dirname, '..', 'js', 'entities', 'blockTypes.js'),
  ];

  let foundBlockRegistry = false;
  for (const bp of possiblePaths) {
    if (fs.existsSync(bp)) {
      const content = fs.readFileSync(bp, 'utf8');
      // Check that block types reference texture names
      const hasBlockProps = content.includes('BLOCK_PROPERTIES') ||
                            content.includes('blockType') ||
                            content.includes('SOLID') ||
                            content.includes('TRANSPARENT');
      if (hasBlockProps) {
        foundBlockRegistry = true;
        assert(content.includes('grass') || content.includes('GRASS'), 'Block registry references grass texture');
        assert(content.includes('dirt') || content.includes('DIRT'), 'Block registry references dirt texture');
        assert(content.includes('stone') || content.includes('STONE'), 'Block registry references stone texture');
        break;
      }
    }
  }

  assert(foundBlockRegistry, 'Block type registry found in project files');
}

// ============================================================
// Results
// ============================================================
console.log('');
console.log('===================================');
console.log(`  Results: ${PASS}/${TOTAL} passed, ${FAIL} failed`);
console.log('===================================');

if (FAIL > 0) {
  console.error('Some texture asset tests failed!');
  process.exit(1);
} else {
  console.log('All texture asset verification tests passing!');
  process.exit(0);
}
