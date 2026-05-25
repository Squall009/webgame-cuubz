#!/usr/bin/env node
/**
 * Cuubz — Responsive HUD Tests
 * Tests mobile-first responsive CSS for survival meters, hotbar, inventory overlay, quest tracker.
 * Verifies CSS rules exist and touch targets meet minimum sizes.
 */

const fs = require('fs');
const path = require('path');

const cssPath = path.join(__dirname, '..', 'css', 'style.css');
const htmlPath = path.join(__dirname, '..', 'index.html');

let PASS = 0;
let FAIL = 0;
let TOTAL = 0;

function assert(condition, message) {
  TOTAL++;
  if (condition) {
    PASS++;
  } else {
    FAIL++;
    console.error(`  ❌ FAIL: ${message}`);
  }
}

// Load files
const cssContent = fs.readFileSync(cssPath, 'utf8');
const htmlContent = fs.readFileSync(htmlPath, 'utf8');

// ============================================================
// Group 1: Media query existence
// ============================================================
console.log('Group 1: Media query existence');
{
  assert(cssContent.includes('@media (max-width: 600px)'), 'Mobile breakpoint @media exists (600px)');
  assert(cssContent.includes('@media (max-width: 360px)'), 'Extra-small breakpoint @media exists (360px)');
  assert(cssContent.includes('@media (max-width: 768px)'), 'Tablet breakpoint @media exists (768px)');
}

// ============================================================
// Group 2: Survival meters mobile visibility
// ============================================================
console.log('Group 2: Survival meters — mobile viewport');
{
  // Check meters container is responsive in 600px media query
  const mobileMQ = cssContent.match(/@media \(max-width: 600px\)\s*\{([\s\S]*?)(?=@media)/);
  assert(mobileMQ !== null, '600px media query block found');

  if (mobileMQ) {
    const mqContent = mobileMQ[1];

    // Meters container width adjustment
    assert(mqContent.includes('#meters-container'), 'meters-container targeted in mobile MQ');

    // Meter bar height reduction
    assert(mqContent.includes('.meter-bar') || cssContent.includes('height: 6px'), 'meter-bar adjusted for mobile');

    // Font size reduction for labels
    assert(mqContent.includes('.meter-label') || cssContent.includes('font-size: 8px'), 'meter-label font reduced on mobile');

    // Gap reduction
    assert(mqContent.includes('gap: 2px') || mqContent.includes('gap: 3px'), 'meters gap reduced on mobile');
  }

  // Extra small screens: labels hidden
  const xsMQ = cssContent.match(/@media \(max-width: 360px\)\s*\{([\s\S]*?)(?=@media)/);
  if (xsMQ) {
    assert(xsMQ[1].includes('.meter-label') && xsMQ[1].includes('display: none'), 'meter labels hidden on XS screens');
  }

  // HTML elements exist for meters
  assert(htmlContent.includes('meters-container') || htmlContent.includes('id="meters-container"'), 'HTML has meters-container element');
}

// ============================================================
// Group 3: Hotbar positioning on mobile
// ============================================================
console.log('Group 3: Hotbar — positioned below joystick on mobile');
{
  const mobileMQ = cssContent.match(/@media \(max-width: 600px\)\s*\{([\s\S]*?)(?=@media)/);

  if (mobileMQ) {
    const mqContent = mobileMQ[1];

    // Hotbar container repositioning
    assert(mqContent.includes('#hotbar-container'), 'hotbar-container targeted in mobile MQ');

    // Position change from bottom to top-based
    assert(mqContent.includes('bottom: auto') || mqContent.includes('top: calc'), 'hotbar position changed on mobile');

    // Hotbar slot sizing
    assert(mqContent.includes('.hotbar-slot'), 'hotbar-slot targeted in mobile MQ');

    // Touch target minimum size (≥ 36px)
    assert(mqContent.includes('min-width: 36px') || mqContent.includes('width: 36px'), 'hotbar slot min-width ≥ 36px on mobile');
    assert(mqContent.includes('min-height: 36px') || mqContent.includes('height: 36px'), 'hotbar slot min-height ≥ 36px on mobile');
  }

  // HTML has hotbar elements
  assert(htmlContent.includes('hotbar-container') || htmlContent.includes('id="hotbar-container"'), 'HTML has hotbar-container element');
}

// ============================================================
// Group 4: Inventory overlay — full-screen on mobile
// ============================================================
console.log('Group 4: Inventory overlay — full-screen on mobile');
{
  const mobileMQ = cssContent.match(/@media \(max-width: 600px\)\s*\{([\s\S]*?)(?=@media)/);

  if (mobileMQ) {
    const mqContent = mobileMQ[1];

    // Overlay stretch to full screen
    assert(mqContent.includes('.overlay'), 'overlay targeted in mobile MQ');

    // Inventory grid responsive layout
    assert(mqContent.includes('#inventory-grid'), 'inventory-grid targeted in mobile MQ');

    // Flex-wrap or auto-fill for responsive grid
    assert(mqContent.includes('flex-wrap') || mqContent.includes('auto-fill'), 'inventory grid uses flex/auto-fill on mobile');

    // Inventory slot sizing with touch targets ≥ 48px
    assert(mqContent.includes('.inventory-slot') || mqContent.includes('56px'), 'inventory-slot sized for mobile');

    // Close button larger touch target
    assert(mqContent.includes('.overlay-close'), 'overlay-close targeted in mobile MQ');
    assert(mqContent.includes('min-width: 48px') || mqContent.includes('min-height: 48px'), 'close button has ≥ 48px touch target');
  }

  // HTML has inventory overlay
  assert(htmlContent.includes('overlay') || htmlContent.includes('inventory'), 'HTML has inventory/overlay elements');
}

// ============================================================
// Group 5: Quest tracker — compact on mobile
// ============================================================
console.log('Group 5: Quest tracker — compact on mobile');
{
  const mobileMQ = cssContent.match(/@media \(max-width: 600px\)\s*\{([\s\S]*?)(?=@media)/);

  if (mobileMQ) {
    const mqContent = mobileMQ[1];

    // Quest tracker repositioned to bottom-right
    assert(mqContent.includes('#quest-tracker'), 'quest-tracker targeted in mobile MQ');

    // Reduced size
    assert(mqContent.includes('min(160px') || mqContent.includes('45vw'), 'quest-tracker width reduced on mobile');

    // Max-height to prevent covering gameplay
    assert(mqContent.includes('max-height: 80px'), 'quest-tracker has max-height limit on mobile');

    // Font size reductions
    assert(mqContent.includes('.quest-header') || mqContent.includes('font-size: 9px'), 'quest header font reduced on mobile');
    assert(mqContent.includes('.quest-current') || mqContent.includes('font-size: 10px'), 'quest current font reduced on mobile');
    assert(mqContent.includes('.quest-objective') || mqContent.includes('font-size: 8px'), 'quest objective font reduced on mobile');

    // Text overflow handling
    assert(mqContent.includes('text-overflow: ellipsis') || mqContent.includes('overflow: hidden'), 'quest text has overflow handling');
  }

  // HTML has quest tracker
  assert(htmlContent.includes('quest-tracker') || htmlContent.includes('id="quest-tracker"'), 'HTML has quest-tracker element');
}

// ============================================================
// Group 6: Touch target compliance (WCAG ≥ 48px)
// ============================================================
console.log('Group 6: Touch target compliance — WCAG minimum sizes');
{
  const mobileMQ = cssContent.match(/@media \(max-width: 600px\)\s*\{([\s\S]*?)(?=@media)/);

  if (mobileMQ) {
    const mqContent = mobileMQ[1];

    // Interactive elements should have ≥ 48px touch targets
    // Check for min-width/min-height declarations with values ≥ 48
    const touchTargets = mqContent.match(/min-(?:width|height):\s*(\d+)px/g);
    assert(touchTargets !== null, 'Touch target size declarations found');

    if (touchTargets) {
      let has48pxTarget = false;
      for (const match of touchTargets) {
        const size = parseInt(match.match(/\d+/)[0]);
        if (size >= 48) {
          has48pxTarget = true;
          break;
        }
      }
      assert(has48pxTarget, 'At least one interactive element has ≥ 48px touch target');
    }

    // Menu buttons have adequate size
    assert(mqContent.includes('.menu-btn') || cssContent.includes('padding: 12px'), 'menu buttons have adequate padding on mobile');

    // Settings sliders have larger touch targets
    assert(mqContent.includes('input[type="range"]') || mqContent.includes('height: 24px'), 'settings sliders have larger touch targets');
  }
}

// ============================================================
// Group 7: Crosshair hidden on mobile
// ============================================================
console.log('Group 7: Crosshair — hidden on mobile (touch controls)');
{
  const mobileMQ = cssContent.match(/@media \(max-width: 600px\)\s*\{([\s\S]*?)(?=@media)/);

  if (mobileMQ) {
    assert(mobileMQ[1].includes('#crosshair') && mobileMQ[1].includes('display: none'), 'crosshair hidden on mobile');
  }
}

// ============================================================
// Group 8: Damage flash adjusted on mobile
// ============================================================
console.log('Group 8: Damage flash — reduced intensity on mobile');
{
  const mobileMQ = cssContent.match(/@media \(max-width: 600px\)\s*\{([\s\S]*?)(?=@media)/);

  if (mobileMQ) {
    assert(mobileMQ[1].includes('#damage-flash'), 'damage-flash targeted in mobile MQ');
    assert(mobileMQ[1].includes('opacity: 0.7'), 'damage-flash opacity reduced on mobile');
  }
}

// ============================================================
// Group 9: Crafting UI mobile adjustments
// ============================================================
console.log('Group 9: Crafting UI — mobile touch targets');
{
  const mobileMQ = cssContent.match(/@media \(max-width: 600px\)\s*\{([\s\S]*?)(?=@media)/);

  if (mobileMQ) {
    assert(mobileMQ[1].includes('#crafting-grid'), 'crafting grid targeted in mobile MQ');
    assert(mobileMQ[1].includes('.crafting-slot'), 'crafting slots targeted in mobile MQ');
    assert(mobileMQ[1].includes('48px'), 'crafting elements have ≥ 48px touch targets');
  }
}

// ============================================================
// Group 10: Settings panel mobile adjustments
// ============================================================
console.log('Group 10: Settings panel — mobile responsive');
{
  const mobileMQ = cssContent.match(/@media \(max-width: 600px\)\s*\{([\s\S]*?)(?=@media)/);

  if (mobileMQ) {
    assert(mobileMQ[1].includes('.settings-panel'), 'settings panel targeted in mobile MQ');
    assert(mobileMQ[1].includes('90vw') || mobileMQ[1].includes('min(300px'), 'settings panel width responsive on mobile');
  }
}

// ============================================================
// Group 11: Extra small screens (360px) refinements
// ============================================================
console.log('Group 11: Extra small screens — 360px breakpoint');
{
  // Find the 360px media query block more robustly
  const xsMatch = cssContent.indexOf('@media (max-width: 360px)');
  let mqContent = '';
  if (xsMatch !== -1) {
    // Extract content from opening brace to the matching closing brace
    const startBrace = cssContent.indexOf('{', xsMatch);
    let depth = 0;
    let endBrace = -1;
    for (let i = startBrace; i < cssContent.length; i++) {
      if (cssContent[i] === '{') depth++;
      if (cssContent[i] === '}') {
        depth--;
        if (depth === 0) { endBrace = i; break; }
      }
    }
    if (endBrace !== -1) {
      mqContent = cssContent.substring(startBrace + 1, endBrace);
    }
  }

  assert(mqContent.length > 0, '360px media query block found');

  if (mqContent.length > 0) {
    assert(mqContent.includes('#meters-container'), 'meters container refined for XS screens');
    assert(mqContent.includes('.meter-label') && mqContent.includes('display: none'), 'meter labels hidden on XS');

    // Smaller hotbar slots
    assert(mqContent.includes('.hotbar-slot'), 'hotbar slots resized for XS screens');

    // More compact quest tracker
    assert(mqContent.includes('#quest-tracker'), 'quest tracker further compacted for XS');
  }
}

// ============================================================
// Group 12: Player list HUD mobile (already existing, verify preserved)
// ============================================================
console.log('Group 12: Player list HUD — mobile adjustments preserved');
{
  const mobileMQ = cssContent.match(/@media \(max-width: 600px\)\s*\{([\s\S]*?)(?=@media)/);

  if (mobileMQ) {
    assert(mobileMQ[1].includes('.player-list-overlay'), 'player list overlay targeted on mobile');
    assert(mobileMQ[1].includes('.player-list-toggle'), 'player list toggle visible on mobile');
    assert(mobileMQ[1].includes('display: inline'), 'toggle shown on mobile via display: inline');
  }
}

// ============================================================
// Group 13: Base CSS structure verification
// ============================================================
console.log('Group 13: Base CSS structure — required elements exist');
{
  // Desktop/base styles exist
  assert(cssContent.includes('#hud'), '#hud base style exists');
  assert(cssContent.includes('#meters-container'), '#meters-container base style exists');
  assert(cssContent.includes('.meter'), '.meter class exists');
  assert(cssContent.includes('.meter-bar'), '.meter-bar class exists');
  assert(cssContent.includes('.meter-fill'), '.meter-fill class exists');
  assert(cssContent.includes('#hotbar-container'), '#hotbar-container base style exists');
  assert(cssContent.includes('#hotbar'), '#hotbar base style exists');
  assert(cssContent.includes('.hotbar-slot'), '.hotbar-slot class exists');
  assert(cssContent.includes('.overlay'), '.overlay class exists');
  assert(cssContent.includes('#quest-tracker'), '#quest-tracker base style exists');
  assert(cssContent.includes('.quest-header'), '.quest-header class exists');
  assert(cssContent.includes('.quest-current'), '.quest-current class exists');
}

// ============================================================
// Group 14: HTML structure verification
// ============================================================
console.log('Group 14: HTML structure — required HUD elements');
{
  assert(htmlContent.includes('id="hud"') || htmlContent.includes('id="game-container"'), 'HTML has game container/hud element');

  // Touch controls exist for mobile
  assert(htmlContent.includes('touch-controls') || htmlContent.includes('joystick'), 'HTML has touch control elements');

  // Settings screen exists
  assert(htmlContent.includes('settings-screen') || htmlContent.includes('settings-panel'), 'HTML has settings panel');
}

// ============================================================
// Group 15: CSS specificity and cascade safety
// ============================================================
console.log('Group 15: CSS cascade safety — !important usage check');
{
  // Count !important usage in mobile MQ (should be minimal)
  const mobileMQ = cssContent.match(/@media \(max-width: 600px\)\s*\{([\s\S]*?)(?=@media)/);
  if (mobileMQ) {
    const importantCount = (mobileMQ[1].match(/!important/g) || []).length;
    // Allow up to 8 for pre-existing player-list-toggle declarations + essential overrides
    assert(importantCount <= 8, `Only ${importantCount} !important declarations in mobile MQ (≤ 8 expected)`);
  }

  // Verify no conflicting rules between breakpoints
  assert(cssContent.includes('@media (max-width: 768px)'), '768px breakpoint exists for tablet');
}

// ============================================================
// Results
// ============================================================
console.log('');
console.log(`===================================`);
console.log(`  Results: ${PASS}/${TOTAL} passed, ${FAIL} failed`);
console.log(`===================================`);

if (FAIL > 0) {
  console.error('❌ Some tests failed!');
  process.exit(1);
} else {
  console.log('🎉 All responsive HUD tests passing!');
  process.exit(0);
}
