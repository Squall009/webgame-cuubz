#!/usr/bin/env node
/**
 * test_pageLoad.js — Page Load & Structure Tests
 * 
 * Validates index.html structure, required elements, and script references.
 * Uses jsdom for DOM parsing without a full browser.
 */

const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const HTML_PATH = path.join(PROJECT_ROOT, 'index.html');

let passCount = 0;
let failCount = 0;

function assert(condition, message) {
  if (condition) {
    passCount++;
  } else {
    failCount++;
    console.error(`  ❌ FAIL — ${message}`);
  }
}

function assertTrue(val, message) { assert(val === true || val === 1, message); }
function assertFalse(val, message) { assert(val === false || val === 0 || val === null || val === undefined, message); }
function assertEquals(actual, expected, message) { assert(actual === expected, `${message} (expected ${expected}, got ${actual})`); }
function assertNotNull(val, message) { assert(val !== null && val !== undefined, message); }
function assertExists(element, message) { assert(element !== null, message); }

// ─── Load HTML ────────────────────────────────────────────────

console.log('Group 1: File existence & basic structure');

const htmlExists = fs.existsSync(HTML_PATH);
assert(htmlExists, `index.html exists at ${HTML_PATH}`);

if (!htmlExists) {
  console.error('Cannot continue — index.html not found.');
  process.exit(1);
}

const htmlContent = fs.readFileSync(HTML_PATH, 'utf-8');
assert(htmlContent.length > 1000, `index.html has substantial content (${htmlContent.length} chars)`);
assert(htmlContent.includes('<!DOCTYPE html>'), 'Has DOCTYPE declaration');
assert(htmlContent.includes('<html'), 'Has <html> element');
assert(htmlContent.includes('</html>'), 'Has closing </html>');

// ─── Parse with jsdom ─────────────────────────────────────────

console.log('\nGroup 2: DOM parsing & meta tags');

const dom = new JSDOM(htmlContent, { url: 'http://localhost:8177/' });
const document = dom.window.document;

assert(document.title === 'Cuubz — Voxel Survival', `Page title is correct (got "${document.title}")`);

// Viewport meta tag for mobile-first
const viewportMeta = document.querySelector('meta[name="viewport"]');
assertExists(viewportMeta, 'Viewport meta tag exists');
if (viewportMeta) {
  const content = viewportMeta.getAttribute('content') || '';
  assert(content.includes('width=device-width'), 'Viewport has width=device-width');
  assert(content.includes('user-scalable=no'), 'Viewport has user-scalable=no (prevents accidental zoom on mobile)');
}

// Charset
const charsetMeta = document.querySelector('meta[charset]');
assertExists(charsetMeta, 'Charset meta tag exists');
if (charsetMeta) assertEquals(charsetMeta.getAttribute('charset'), 'UTF-8', 'Charset is UTF-8');

// ─── Script References ────────────────────────────────────────

console.log('\nGroup 3: Script references');

const scripts = document.querySelectorAll('script[src]');
assert(scripts.length >= 2, `At least 2 external scripts (found ${scripts.length})`);

const scriptSrcs = Array.from(scripts).map(s => s.getAttribute('src'));
assert(scriptSrcs.some(src => src.includes('three.min.js')), 'Three.js local script included (js/three.min.js)');
assert(scriptSrcs.some(src => src.includes('js/main.js')), 'Main JS entry point included');

// ─── CSS References ───────────────────────────────────────────

console.log('\nGroup 4: CSS references');

const stylesheets = document.querySelectorAll('link[rel="stylesheet"]');
assert(stylesheets.length >= 1, `At least 1 stylesheet (found ${stylesheets.length})`);

const cssHrefs = Array.from(stylesheets).map(l => l.getAttribute('href'));
assert(cssHrefs.some(href => href.includes('css/style.css')), 'style.css referenced');

// ─── Game Container ──────────────────────────────────────────

console.log('\nGroup 5: Game container & rendering elements');

const gameContainer = document.getElementById('game-container');
assertExists(gameContainer, '#game-container exists for Three.js canvas');

const crosshair = document.getElementById('crosshair');
assertExists(crosshair, '#crosshair overlay exists');

// ─── HUD Elements ─────────────────────────────────────────────

console.log('\nGroup 6: HUD — Survival meters');

const hud = document.getElementById('hud');
assertExists(hud, '#hud container exists');
if (hud) {
  // Check all 5 survival meters
  const meterIds = ['health-meter', 'hunger-meter', 'thirst-meter', 'sleep-meter', 'stamina-meter'];
  for (const id of meterIds) {
    const meter = document.getElementById(id);
    assertExists(meter, `#${id} exists in HUD`);
    if (meter) {
      const fill = meter.querySelector('.meter-fill');
      assertExists(fill, `#${id} has .meter-fill element`);
      const label = meter.querySelector('.meter-label');
      assertExists(label, `#${id} has .meter-label element`);
    }
  }
}

// ─── Hotbar ───────────────────────────────────────────────────

console.log('\nGroup 7: HUD — Hotbar');

const hotbar = document.getElementById('hotbar');
assertExists(hotbar, '#hotbar exists');
if (hotbar) {
  const slots = hotbar.querySelectorAll('.hotbar-slot');
  assertEquals(slots.length, 9, `Hotbar has exactly 9 slots`);
  
  // Check slot data attributes
  for (let i = 0; i < 9; i++) {
    assertEquals(slots[i].getAttribute('data-slot'), String(i), `Slot ${i} has data-slot="${i}"`);
  }
}

// ─── Quest Tracker ────────────────────────────────────────────

console.log('\nGroup 8: HUD — Quest tracker');

const questTracker = document.getElementById('quest-tracker');
assertExists(questTracker, '#quest-tracker exists');
if (questTracker) {
  assertExists(document.getElementById('quest-name'), '#quest-name exists');
  assertExists(document.getElementById('quest-objective'), '#quest-objective exists');
  assertExists(document.getElementById('quest-progress'), '#quest-progress exists');
}

// ─── Damage Flash ─────────────────────────────────────────────

console.log('\nGroup 9: HUD — Damage flash effect');

const damageFlash = document.getElementById('damage-flash');
assertExists(damageFlash, '#damage-flash element exists for screen-edge damage feedback');

// ─── Menu Screens ─────────────────────────────────────────────

console.log('\nGroup 10: Menu screens');

const mainMenu = document.getElementById('main-menu');
assertExists(mainMenu, '#main-menu screen exists');
if (mainMenu) {
  assert(mainMenu.classList.contains('screen'), 'Main menu has "screen" class');
  
  const title = mainMenu.querySelector('.game-title');
  assertExists(title, 'Game title element exists in main menu');
  if (title) assertEquals(title.textContent.trim(), 'CUUBZ', 'Title text is "CUUBZ"');
  
  const subtitle = mainMenu.querySelector('.game-subtitle');
  assertExists(subtitle, 'Game subtitle element exists');
}

// Menu buttons
const menuButtons = ['btn-play-solo', 'btn-host', 'btn-join', 'btn-settings'];
for (const btnId of menuButtons) {
  const btn = document.getElementById(btnId);
  assertExists(btn, `#${btnId} button exists in main menu`);
}

// ─── Character Screen ─────────────────────────────────────────

console.log('\nGroup 11: Character selection screen');

const charScreen = document.getElementById('character-screen');
assertExists(charScreen, '#character-screen exists');
if (charScreen) {
  assert(charScreen.classList.contains('hidden'), 'Character screen starts hidden');
  assertExists(document.getElementById('character-slots'), '#character-slots container exists');
  assertExists(document.getElementById('btn-create-char'), '#btn-create-char button exists');
  assertExists(document.getElementById('btn-back-char'), '#btn-back-char button exists');
}

// Character modal
const charModal = document.getElementById('create-char-modal');
assertExists(charModal, '#create-char-modal exists');
if (charModal) {
  assert(charModal.classList.contains('hidden'), 'Character modal starts hidden');
  assertExists(document.getElementById('char-name'), '#char-name input exists');
  assertExists(document.getElementById('char-color'), '#char-color input exists');
  const nameInput = document.getElementById('char-name');
  if (nameInput) assertEquals(nameInput.getAttribute('maxlength'), '16', 'Character name max length is 16');
}

// Character delete modal
const deleteCharModal = document.getElementById('delete-char-modal');
assertExists(deleteCharModal, '#delete-char-modal exists');
if (deleteCharModal) {
  assert(deleteCharModal.classList.contains('hidden'), 'Delete character modal starts hidden');
  assertExists(document.getElementById('btn-confirm-delete-char'), 'Delete confirm button exists');
}

// ─── World Screen ─────────────────────────────────────────────

console.log('\nGroup 12: World selection screen');

const worldScreen = document.getElementById('world-screen');
assertExists(worldScreen, '#world-screen exists');
if (worldScreen) {
  assert(worldScreen.classList.contains('hidden'), 'World screen starts hidden');
  assertExists(document.getElementById('world-slots'), '#world-slots container exists');
  assertExists(document.getElementById('btn-create-world'), '#btn-create-world button exists');
  assertExists(document.getElementById('btn-back-world'), '#btn-back-world button exists');
}

// ─── Mode Screen ──────────────────────────────────────────────

console.log('\nGroup 13: Game mode selection screen');

const modeScreen = document.getElementById('mode-screen');
assertExists(modeScreen, '#mode-screen exists');
if (modeScreen) {
  assert(modeScreen.classList.contains('hidden'), 'Mode screen starts hidden');
  assertExists(document.getElementById('btn-survival'), '#btn-survival button exists');
  assertExists(document.getElementById('btn-creative'), '#btn-creative button exists');
  assertExists(document.getElementById('btn-back-mode'), '#btn-back-mode button exists');
}

// ─── Settings Screen ──────────────────────────────────────────

console.log('\nGroup 14: Settings screen');

const settingsScreen = document.getElementById('settings-screen');
assertExists(settingsScreen, '#settings-screen exists');
if (settingsScreen) {
  assert(settingsScreen.classList.contains('hidden'), 'Settings screen starts hidden');
  
  // Render distance slider
  const renderDist = document.getElementById('render-distance');
  assertExists(renderDist, '#render-distance slider exists');
  if (renderDist) {
    assertEquals(renderDist.getAttribute('min'), '3', 'Render distance min is 3');
    assertEquals(renderDist.getAttribute('max'), '12', 'Render distance max is 12');
    assertEquals(renderDist.getAttribute('value'), '6', 'Render distance default is 6');
  }
  
  // Volume sliders
  assertExists(document.getElementById('volume-slider'), '#volume-slider exists');
  assertExists(document.getElementById('music-volume'), '#music-volume slider exists');
  
  // Controls hint
  const controlsHint = settingsScreen.querySelector('.controls-hint');
  assertExists(controlsHint, 'Controls hint section exists in settings');
}

// ─── Multiplayer Lobby Screen ─────────────────────────────────

console.log('\nGroup 15: Multiplayer lobby screen');

const lobbyScreen = document.getElementById('lobby-screen');
assertExists(lobbyScreen, '#lobby-screen exists');
if (lobbyScreen) {
  assert(lobbyScreen.classList.contains('hidden'), 'Lobby screen starts hidden');
  // Connection status indicator
  assertExists(document.getElementById('connection-status'), '#connection-status exists');
  // Tab navigation
  assertExists(document.getElementById('tab-browse'), '#tab-browse tab exists');
  assertExists(document.getElementById('tab-host'), '#tab-host tab exists');
  // Browse panel
  assertExists(document.getElementById('browse-panel'), '#browse-panel exists');
  assertExists(document.getElementById('session-list'), '#session-list container exists');
  assertExists(document.getElementById('no-sessions-msg'), '#no-sessions-msg exists');
  assertExists(document.getElementById('btn-refresh-sessions'), '#btn-refresh-sessions exists');
  // Host panel
  assertExists(document.getElementById('host-panel'), '#host-panel exists');
  assertExists(document.getElementById('host-session-name'), '#host-session-name input exists');
  assertExists(document.getElementById('host-world-select'), '#host-world-select exists');
  assertExists(document.getElementById('host-mode-select'), '#host-mode-select exists');
  assertExists(document.getElementById('host-max-players'), '#host-max-players slider exists');
  assertExists(document.getElementById('btn-start-hosting'), '#btn-start-hosting button exists');
  // Connection HUD (in-game)
  assertExists(document.getElementById('connection-hud'), '#connection-hud exists');
  // Player list overlay (in-game)
  assertExists(document.getElementById('player-list-overlay'), '#player-list-overlay exists');
  assertExists(document.getElementById('player-count'), '#player-count exists');
  assertExists(document.getElementById('player-list-items'), '#player-list-items exists');
}

// ─── Inventory Screen ─────────────────────────────────────────

console.log('\nGroup 16: Inventory overlay screen');

const inventoryScreen = document.getElementById('inventory-screen');
assertExists(inventoryScreen, '#inventory-screen exists');
if (inventoryScreen) {
  assert(inventoryScreen.classList.contains('hidden'), 'Inventory starts hidden');
  assert(inventoryScreen.classList.contains('overlay'), 'Inventory has "overlay" class');
  assertExists(document.getElementById('inventory-grid'), '#inventory-grid container exists');
  assertExists(document.getElementById('btn-close-inventory'), '#btn-close-inventory button exists');
}

// ─── Touch Controls (Mobile-First) ────────────────────────────

console.log('\nGroup 17: Mobile touch controls');

const touchControls = document.getElementById('touch-controls');
assertExists(touchControls, '#touch-controls container exists');
if (touchControls) {
  assert(touchControls.classList.contains('hidden'), 'Touch controls start hidden (shown on mobile detection)');
  
  // Virtual joystick
  const joystickZone = document.getElementById('joystick-zone');
  assertExists(joystickZone, '#joystick-zone exists for virtual joystick');
  if (joystickZone) {
    assertExists(document.getElementById('joystick-base'), '#joystick-base exists');
    assertExists(document.getElementById('joystick-thumb'), '#joystick-thumb exists');
  }
  
  // Look zone (swipe-to-look on right side)
  const lookZone = document.getElementById('look-zone');
  assertExists(lookZone, '#look-zone exists for swipe-to-look');
  
  // Mobile action buttons
  const mobileActions = document.getElementById('mobile-actions');
  assertExists(mobileActions, '#mobile-actions container exists');
  if (mobileActions) {
    assertExists(document.getElementById('btn-jump-mobile'), 'Mobile jump button exists');
    assertExists(document.getElementById('btn-break-mobile'), 'Mobile break button exists');
    assertExists(document.getElementById('btn-place-mobile'), 'Mobile place button exists');
    assertExists(document.getElementById('btn-inventory-mobile'), 'Mobile inventory button exists');
  }
}

// ─── Loading Screen ───────────────────────────────────────────

console.log('\nGroup 18: Loading screen');

const loadingScreen = document.getElementById('loading-screen');
assertExists(loadingScreen, '#loading-screen exists');
if (loadingScreen) {
  assert(loadingScreen.classList.contains('hidden'), 'Loading screen starts hidden');
  assertExists(document.getElementById('loading-status'), '#loading-status text exists');
  assertExists(document.getElementById('loading-progress'), '#loading-progress bar exists');
}

// ─── Screen Management ────────────────────────────────────────

console.log('\nGroup 19: Screen management validation');

const allScreens = document.querySelectorAll('.screen');
assert(allScreens.length >= 5, `At least 5 screen elements (found ${allScreens.length})`);

// All screens except main-menu should start hidden
const visibleScreens = Array.from(allScreens).filter(s => !s.classList.contains('hidden'));
assertEquals(visibleScreens.length, 1, 'Exactly 1 screen visible on load (main menu)');
if (visibleScreens.length === 1) {
  assertEquals(visibleScreens[0].id, 'main-menu', 'The only visible screen is main-menu');
}

// ─── File Existence Checks ────────────────────────────────────

console.log('\nGroup 20: Required file existence');

const requiredFiles = [
  'css/style.css',
  'js/three.min.js',
  'js/main.js',
  'js/game.js',
  'js/world/noise.js',
  'js/world/chunkData.js',
  'js/world/chunkGrid.js',
  'js/world/biomeSystem.js',
  'js/world/worldGenerator.js',
  'js/world/caveGenerator.js',
  'js/world/oreGenerator.js',
  'js/world/featurePlacer.js',
  'js/world/persistence.js',
  'js/world/spawnManager.js',
  'js/renderer/voxelRenderer.js',
  'js/renderer/chunkMeshBuilder.js',
  'js/renderer/chunkManager.js',
  'js/renderer/skybox.js',
  'js/renderer/crosshair.js',
  'js/input/keyboard.js',
  'js/input/mouse.js',
  'js/input/touch.js',
  'js/input/interaction.js',
  'js/entities/player.js',
  'js/entities/characterManager.js',
  'js/entities/worldManager.js',
  'js/entities/boss.js',
  'js/entities/questMarker.js',
  'js/systems/survival.js',
  'js/systems/inventory.js',
  'js/systems/damageSystem.js',
  'js/systems/questSystem.js',
  'js/audio/sfx.js',
  'js/audio/ambient.js',
];

for (const file of requiredFiles) {
  const filePath = path.join(PROJECT_ROOT, file);
  assert(fs.existsSync(filePath), `${file} exists`);
}

// ─── Texture Files ────────────────────────────────────────────

console.log('\nGroup 21: Texture files');

const textureFiles = [
  'grass_top.png', 'grass_side.png', 'dirt.png', 'stone.png', 'sand.png',
  'gravel.png', 'water.png', 'wood_log.png', 'leaves.png', 'snow.png',
  'ice.png', 'bedrock.png', 'planks.png', 'obsidian.png', 'blackstone.png',
  'lava.png', 'corrupt_stone.png', 'toxic_slime.png', 'coal_ore.png',
  'iron_ore.png', 'gold_ore.png', 'diamond_ore.png', 'corrupt_cry.png',
  'apple.png', 'quest_key.png', 'bed.png'
];

for (const tex of textureFiles) {
  const filePath = path.join(PROJECT_ROOT, 'textures', tex);
  assert(fs.existsSync(filePath), `textures/${tex} exists`);
}

// ─── No Inline Event Handlers / HTML Validation ───────────────

console.log('\nGroup 22: HTML structure validation');

// Check no inline event handlers on non-script elements (script onerror is OK for load failure detection)
const inlineHandlers = document.querySelectorAll('script:not([onerror])[onclick], script:not([onerror])[onload], *:not(script)[onclick], *:not(script)[onload], *:not(script)[onerror]');
assert(inlineHandlers.length === 0, `No inline event handlers found (found ${inlineHandlers.length})`);

// Check all IDs are unique
const allElements = document.querySelectorAll('[id]');
const ids = Array.from(allElements).map(el => el.id);
const uniqueIds = new Set(ids);
assertEquals(ids.length, uniqueIds.size, `All element IDs are unique (${ids.length} elements, ${uniqueIds.size} unique)`);

// ─── Three.js Local Reference Validation ──────────────────────

console.log('\nGroup 23: Three.js local reference');

const threeScript = Array.from(scripts).find(s => s.getAttribute('src').includes('three.min.js'));
assertExists(threeScript, 'Three.js script tag found');
if (threeScript) {
  const src = threeScript.getAttribute('src');
  assertEquals(src, 'js/three.min.js', 'Three.js loaded from local file (not CDN)');
  assert(threeScript.hasAttribute('onerror'), 'Three.js script has onerror handler for load failure detection');
}

// ─── No CDN Dependencies ──────────────────────────────────────

console.log('\nGroup 24: No external CDN dependencies');

const cdnScripts = Array.from(scripts).filter(s => {
  const src = s.getAttribute('src') || '';
  return src.startsWith('http://') || src.startsWith('https://');
});
assert(cdnScripts.length === 0, `No CDN scripts found (found ${cdnScripts.length})`);

// ─── Summary ──────────────────────────────────────────────────

console.log('\n===================================');
console.log(`Results: ${passCount} passed, ${failCount} failed`);
console.log('===================================');

if (failCount > 0) {
  console.error(`\n❌ ${failCount} test(s) failed!`);
  process.exit(1);
} else {
  console.log('\n🎉 All page load tests passed!');
  process.exit(0);
}
