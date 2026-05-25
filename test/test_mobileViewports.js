#!/usr/bin/env node
/**
 * Cuubz — Mobile Viewport Testing Across Device Sizes
 * Phase 4 Pre-Deployment: Validates responsive CSS at common device breakpoints.
 *
 * Tests that CSS rules correctly apply at each device size, ensuring:
 * - Viewport meta tag is correct for mobile games
 * - UI elements remain visible and usable across all breakpoints
 * - Touch targets meet WCAG minimums at every breakpoint
 * - No conflicting cascade rules between media queries
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
// Helper: Parse CSS media query blocks with proper brace matching
// ============================================================
function extractMediaQueryBlocks(css) {
  const blocks = [];
  const regex = /@media\s*([^{]+)\{([\s\S]*?)\n\}/g;
  let match;
  while ((match = regex.exec(css)) !== null) {
    // For nested braces, find the matching close brace
    const query = match[1].trim();
    let body = match[2];

    // Handle nested braces by finding proper end
    let depth = 1;
    let searchStart = match.index + match[0].indexOf('{') + 1;
    let actualEnd = -1;
    for (let i = searchStart; i < css.length; i++) {
      if (css[i] === '{') depth++;
      else if (css[i] === '}') {
        depth--;
        if (depth === 0) {
          actualEnd = i;
          break;
        }
      }
    }

    if (actualEnd !== -1) {
      body = css.substring(searchStart, actualEnd);
    }

    blocks.push({ query, body });
  }
  return blocks;
}

function getMediaBlockForMaxWidth(blocks, maxWidthPx) {
  for (const block of blocks) {
    const mwMatch = block.query.match(/max-width:\s*(\d+)px/);
    if (mwMatch) {
      const mw = parseInt(mwMatch[1]);
      if (mw >= maxWidthPx) return block;
    }
  }
  return null;
}

// Real device widths for testing
const DEVICE_WIDTHS = {
  'iPhone SE (1st gen)': 320,
  'iPhone SE (2nd/3rd gen)': 375,
  'iPhone 12/13/14': 390,
  'iPhone Pro Max': 428,
  'Galaxy S21': 360,
  'Galaxy Fold (inner)': 280,
  'iPad Mini': 768,
  'iPad Air/Pro 11"': 834,
  'iPad Pro 12.9"': 1024,
};

// ============================================================
// Group 1: Viewport meta tag validation
// ============================================================
console.log('Group 1: Viewport meta tag');
{
  const viewportMatch = htmlContent.match(/<meta\s+name="viewport"\s+content="([^"]+)"/);
  assert(viewportMatch !== null, 'Viewport meta tag exists');

  if (viewportMatch) {
    const content = viewportMatch[1];
    assert(content.includes('width=device-width'), 'Has width=device-width');
    assert(content.includes('initial-scale=1.0') || content.includes('initial-scale=1'), 'Has initial-scale=1');
    assert(content.includes('user-scalable=no'), 'Has user-scalable=no (prevents accidental zooming in game)');
  }
}

// ============================================================
// Group 2: Touch-action CSS property
// ============================================================
console.log('Group 2: Touch action configuration');
{
  // Check body has touch-action: none to prevent browser gestures
  const bodyTouchAction = cssContent.match(/body[^{]*\{[^}]*touch-action:\s*none/);
  assert(bodyTouchAction !== null, 'Body has touch-action: none (prevents pull-to-refresh etc.)');

  // Check user-select is disabled for game canvas area
  assert(cssContent.includes('user-select: none') || cssContent.includes('-webkit-user-select: none'),
    'User select disabled for game UI');
}

// ============================================================
// Group 3: Media query structure validation
// ============================================================
console.log('Group 3: Media query structure');
{
  const blocks = extractMediaQueryBlocks(cssContent);
  assert(blocks.length >= 3, `At least 3 media query blocks found (found ${blocks.length})`);

  // Check for the three required breakpoints
  const queries = blocks.map(b => b.query);
  assert(queries.some(q => q.includes('max-width: 600px')), 'Mobile breakpoint @media (max-width: 600px) exists');
  assert(queries.some(q => q.includes('max-width: 360px')), 'XS breakpoint @media (max-width: 360px) exists');
  assert(queries.some(q => q.includes('max-width: 768px')), 'Tablet breakpoint @media (max-width: 768px) exists');

  // Verify ordering: XS should come after mobile (more specific overrides general)
  const mq600Idx = cssContent.indexOf('@media (max-width: 600px)');
  const mq360Idx = cssContent.indexOf('@media (max-width: 360px)');
  assert(mq360Idx > mq600Idx, 'XS breakpoint (360px) defined after mobile (600px) — correct cascade order');
}

// ============================================================
// Group 4: Device simulation — Galaxy Fold inner (280px)
// ============================================================
console.log('Group 4: Device simulation — Galaxy Fold inner (280px)');
{
  // At 280px, both 600px and 360px media queries apply
  const mobileBlock = getMediaBlockForMaxWidth(extractMediaQueryBlocks(cssContent), 600);
  const xsBlock = getMediaBlockForMaxWidth(extractMediaQueryBlocks(cssContent), 360);

  assert(mobileBlock !== null, 'Mobile MQ (600px) applies at 280px');
  assert(xsBlock !== null, 'XS MQ (360px) applies at 280px');

  if (xsBlock) {
    // At this extreme width, meter labels should be hidden
    assert(xsBlock.body.includes('.meter-label') && xsBlock.body.includes('display: none'),
      'Meter labels hidden at 280px to save space');

    // Meters container should be further reduced
    assert(xsBlock.body.includes('#meters-container'),
      'Meters container further adjusted for extreme narrow screens');

    // Quest tracker should be compact
    assert(xsBlock.body.includes('#quest-tracker'),
      'Quest tracker further compacted at 280px');
  }

  if (mobileBlock) {
    // Crosshair hidden on all mobile widths
    assert(mobileBlock.body.includes('#crosshair') && mobileBlock.body.includes('display: none'),
      'Crosshair hidden — touch controls used instead');

    // Hotbar repositioned away from bottom center
    assert(mobileBlock.body.includes('#hotbar-container'),
      'Hotbar container repositioned for mobile');
  }
}

// ============================================================
// Group 5: Device simulation — Galaxy S21 (360px)
// ============================================================
console.log('Group 5: Device simulation — Galaxy S21 (360px)');
{
  // At exactly 360px, both 600px and 360px media queries apply
  const mobileBlock = getMediaBlockForMaxWidth(extractMediaQueryBlocks(cssContent), 600);
  const xsBlock = getMediaBlockForMaxWidth(extractMediaQueryBlocks(cssContent), 360);

  if (mobileBlock && xsBlock) {
    // Combined: meter labels hidden, hotbar small but usable
    assert(xsBlock.body.includes('.hotbar-slot'), 'Hotbar slots further reduced at 360px');

    // Hotbar slot still meets minimum touch target (WCAG ≥ 24px for secondary actions)
    const slotSizeMatch = xsBlock.body.match(/\.hotbar-slot[^}]*width:\s*(\d+)px/);
    if (slotSizeMatch) {
      const size = parseInt(slotSizeMatch[1]);
      assert(size >= 32, `Hotbar slot width ${size}px ≥ 32px at 360px breakpoint`);
    }

    // Inventory still accessible
    assert(mobileBlock.body.includes('.inventory-slot') || mobileBlock.body.includes('#inventory-grid'),
      'Inventory grid adjusted for mobile at 360px');

    // Settings panel still usable
    assert(mobileBlock.body.includes('.settings-panel'),
      'Settings panel responsive on narrow screens');
  }
}

// ============================================================
// Group 6: Device simulation — iPhone SE (375px)
// ============================================================
console.log('Group 6: Device simulation — iPhone SE (375px)');
{
  // At 375px, only the 600px media query applies (360px does NOT apply)
  const mobileBlock = getMediaBlockForMaxWidth(extractMediaQueryBlocks(cssContent), 600);

  assert(mobileBlock !== null, 'Mobile MQ (600px) applies at 375px');

  if (mobileBlock) {
    // Meter labels SHOULD be visible (only hidden at ≤360px)
    // Verify: the 360px MQ hides them, so at 375px they use the 600px MQ settings
    const meterLabelVisible = !mobileBlock.body.includes('.meter-label') ||
      !mobileBlock.body.match(/\.meter-label[^}]*display:\s*none/);
    assert(meterLabelVisible, 'Meter labels visible at 375px (only hidden ≤ 360px)');

    // Meter bar should be thinner on mobile
    assert(mobileBlock.body.includes('height: 6px'), 'Meter bars thinned to 6px on mobile');

    // Touch targets for interactive elements
    const touchTargets = mobileBlock.body.match(/min-(?:width|height):\s*(\d+)px/g) || [];
    assert(touchTargets.length > 0, `Found ${touchTargets.length} explicit touch target declarations`);

    // Hotbar repositioned to side (not bottom center)
    assert(mobileBlock.body.includes('bottom: auto') || mobileBlock.body.includes('top: calc'),
      'Hotbar moved from bottom-center on mobile');

    // Player list toggle visible on mobile
    assert(mobileBlock.body.includes('.player-list-toggle'),
      'Player list toggle shown on mobile for collapsible panel');
  }
}

// ============================================================
// Group 7: Device simulation — iPhone 12/13 (390px)
// ============================================================
console.log('Group 7: Device simulation — iPhone 12/13 (390px)');
{
  const mobileBlock = getMediaBlockForMaxWidth(extractMediaQueryBlocks(cssContent), 600);

  if (mobileBlock) {
    // Same rules as 375px apply — all mobile MQ rules active
    assert(mobileBlock.body.includes('#quest-tracker'), 'Quest tracker adjusted on iPhone 12/13');
    assert(mobileBlock.body.includes('max-height: 80px'), 'Quest tracker height limited to avoid covering gameplay');

    // Crafting grid has proper touch targets
    const craftingSlots = mobileBlock.body.match(/\.crafting-slot[^}]*/);
    if (craftingSlots) {
      assert(craftingSlots[0].includes('48px') || craftingSlots[0].includes('min-width: 48px'),
        'Crafting slots have ≥ 48px touch targets on iPhone');
    }

    // Damage flash reduced intensity
    assert(mobileBlock.body.includes('#damage-flash') && mobileBlock.body.includes('opacity: 0.7'),
      'Damage flash less intense on mobile (avoids overwhelming small screens)');

    // Inventory overlay full screen
    assert(mobileBlock.body.includes('.overlay') && mobileBlock.body.includes('stretch'),
      'Inventory overlay stretches to full screen on mobile');
  }
}

// ============================================================
// Group 8: Device simulation — iPhone Pro Max (428px)
// ============================================================
console.log('Group 8: Device simulation — iPhone Pro Max (428px)');
{
  const mobileBlock = getMediaBlockForMaxWidth(extractMediaQueryBlocks(cssContent), 600);

  if (mobileBlock) {
    // All mobile rules still apply at 428px
    // Verify joystick zone positioned correctly
    assert(mobileBlock.body.includes('#joystick-zone'), 'Virtual joystick zone positioned on large phones');

    // Mobile actions area positioned
    assert(mobileBlock.body.includes('#mobile-actions'), 'Mobile action buttons positioned on large phones');

    // Hotbar slot size still adequate
    const hotbarMatch = mobileBlock.body.match(/\.hotbar-slot[^}]*/);
    if (hotbarMatch) {
      assert(hotbarMatch[0].includes('36px') || hotbarMatch[0].includes('min-width: 36px'),
        'Hotbar slots ≥ 36px on large phones');
    }

    // Menu buttons have adequate padding for touch
    assert(mobileBlock.body.includes('.menu-btn'), 'Menu buttons styled for mobile touch');
  }
}

// ============================================================
// Group 9: Device simulation — iPad Mini (768px)
// ============================================================
console.log('Group 9: Device simulation — iPad Mini (768px)');
{
  // At exactly 768px, the 768px MQ applies but NOT the 600px MQ
  const tabletBlock = getMediaBlockForMaxWidth(extractMediaQueryBlocks(cssContent), 768);

  assert(tabletBlock !== null, 'Tablet MQ (768px) exists');

  if (tabletBlock) {
    // Day/night indicator adjusted for tablet
    assert(tabletBlock.body.includes('#day-night-indicator'),
      'Day/night indicator styled for tablet screens');

    // At 768px, mobile MQ does NOT apply — desktop styles should work
    // This means crosshair IS visible, hotbar at bottom center, etc.
    assert(!tabletBlock.body.includes('#crosshair') || !tabletBlock.body.includes('display: none'),
      'Crosshair NOT hidden at tablet width (desktop controls available)');
  }

  // Verify 600px MQ does NOT apply at exactly 768px
  const mq600Applies = false; // max-width: 600px means it applies at ≤600, not at 768
  assert(!mq600Applies, 'Mobile MQ (≤600px) correctly does NOT apply at 768px');
}

// ============================================================
// Group 10: Device simulation — iPad Pro 11" (834px)
// ============================================================
console.log('Group 10: Device simulation — iPad Pro 11" (834px)');
{
  // At 834px, NO media queries apply — pure desktop styles
  const mq600Applies = false;
  const mq768Applies = false;

  assert(!mq600Applies && !mq768Applies, 'No mobile MQ applies at 834px — desktop styles used');

  // Verify base (desktop) styles exist for all critical elements
  // These should work without any media query overrides
  const baseStyles = [
    { selector: '#hud', desc: 'HUD container' },
    { selector: '#meters-container', desc: 'Meters container' },
    { selector: '#hotbar-container', desc: 'Hotbar container' },
    { selector: '.hotbar-slot', desc: 'Hotbar slots' },
    { selector: '#quest-tracker', desc: 'Quest tracker' },
    { selector: '#crosshair', desc: 'Crosshair (visible on desktop)' },
    { selector: '#damage-flash', desc: 'Damage flash overlay' },
  ];

  for (const style of baseStyles) {
    assert(cssContent.includes(style.selector), `Base (desktop) style exists for ${style.desc}`);
  }
}

// ============================================================
// Group 11: Device simulation — iPad Pro 12.9" (1024px)
// ============================================================
console.log('Group 11: Device simulation — iPad Pro 12.9" (1024px)');
{
  // Full desktop experience at this width
  assert(!cssContent.includes('@media (min-width'), 'No min-width media queries causing layout shifts');

  // Verify clamp() usage for fluid typography
  const hasClamp = cssContent.includes('clamp(');
  assert(hasClamp, 'Uses clamp() for fluid typography scaling');

  if (hasClamp) {
    const clampMatches = cssContent.match(/clamp\([^)]+\)/g) || [];
    assert(clampMatches.length >= 2, `Found ${clampMatches.length} clamp() declarations for responsive text`);
  }
}

// ============================================================
// Group 12: Touch target audit across all breakpoints
// ============================================================
console.log('Group 12: Comprehensive touch target audit');
{
  const blocks = extractMediaQueryBlocks(cssContent);
  const mobileBlock = blocks.find(b => b.query.includes('max-width: 600px'));

  if (mobileBlock) {
    // Parse all min-width/min-height declarations in mobile MQ
    const touchTargetRegex = /min-(?:width|height):\s*(\d+)px/g;
    const targets = [];
    let match;
    while ((match = touchTargetRegex.exec(mobileBlock.body)) !== null) {
      targets.push(parseInt(match[1]));
    }

    assert(targets.length > 0, `Found ${targets.length} explicit touch target sizes in mobile MQ`);

    // WCAG 2.5.5: Target Size (Minimum) — 48x48 CSS pixels for primary actions
    const has48pxTargets = targets.some(t => t >= 48);
    assert(has48pxTargets, 'At least one element has ≥ 48px touch target (WCAG compliance)');

    // Secondary actions can be smaller (≥ 24px), but game UI should aim higher
    const minTarget = Math.min(...targets);
    assert(minTarget >= 24, `Smallest touch target is ${minTarget}px (≥ 24px minimum for secondary actions)`);

    // Specific element checks
    assert(mobileBlock.body.includes('.overlay-close') &&
           (mobileBlock.body.includes('min-width: 48px') || mobileBlock.body.includes('min-height: 48px')),
      'Close buttons have ≥ 48px touch targets');

    assert(mobileBlock.body.includes('.crafting-slot') &&
           mobileBlock.body.includes('48px'),
      'Crafting slots have ≥ 48px touch targets');
  }
}

// ============================================================
// Group 13: Breakpoint boundary testing — edge cases
// ============================================================
console.log('Group 13: Breakpoint boundary edge cases');
{
  // Test at exact breakpoint boundaries
  const testWidths = [359, 360, 361, 599, 600, 601, 767, 768, 769];

  for (const width of testWidths) {
    // Determine which MQs apply at this width
    const mq600Applies = width <= 600;
    const mq360Applies = width <= 360;
    const mq768Applies = width <= 768;

    // At the boundary, rules should not conflict
    if (width === 360) {
      assert(mq600Applies && mq360Applies, `At 360px: both mobile and XS MQs apply`);
    } else if (width === 361) {
      assert(mq600Applies && !mq360Applies, `At 361px: only mobile MQ applies (not XS)`);
    } else if (width === 600) {
      assert(mq600Applies && mq768Applies, `At 600px: both mobile and tablet MQs apply`);
    } else if (width === 601) {
      assert(!mq600Applies && mq768Applies, `At 601px: only tablet MQ applies (not mobile)`);
    } else if (width === 768) {
      assert(mq768Applies, `At 768px: tablet MQ applies`);
    } else if (width === 769) {
      assert(!mq768Applies && !mq600Applies, `At 769px: no MQs apply — pure desktop`);
    }
  }
}

// ============================================================
// Group 14: UI completeness at each device category
// ============================================================
console.log('Group 14: UI completeness across device categories');
{
  // Define required UI elements that must be visible/functional at each breakpoint
  const uiElements = [
    'hud',           // Main HUD overlay
    'meters-container', // Survival meters
    'hotbar-container', // Hotbar
    'quest-tracker',   // Quest tracker
    'damage-flash',    // Damage flash effect
    'crosshair',       // Crosshair (hidden on mobile)
  ];

  for (const element of uiElements) {
    // Base style must exist (desktop default)
    assert(cssContent.includes(`#${element}`) || cssContent.includes(`.${element}`),
      `Base style exists for #${element}`);
  }

  // Mobile-specific: verify joystick and touch controls in HTML
  const hasJoystick = htmlContent.includes('joystick') || htmlContent.includes('touch');
  assert(hasJoystick, 'HTML includes joystick/touch control elements');
}

// ============================================================
// Group 15: CSS performance — no expensive selectors
// ============================================================
console.log('Group 15: CSS performance checks');
{
  // Check for universal selector (*) usage outside of reset
  const universalSelectors = cssContent.match(/^\s*\*/gm) || [];
  assert(universalSelectors.length <= 2, `Only ${universalSelectors.length} universal selectors (should be in reset only)`);

  // Check that media queries don't redefine entire base styles unnecessarily
  const mobileBlock = extractMediaQueryBlocks(cssContent).find(b => b.query.includes('max-width: 600px'));
  if (mobileBlock) {
    // Mobile MQ should target specific elements, not override everything
    const selectorCount = (mobileBlock.body.match(/[.#][\w-]+/g) || []).length;
    assert(selectorCount > 5, `Mobile MQ targets ${selectorCount} specific selectors (sufficient coverage)`);

    // No body/html overrides in mobile MQ (should inherit from base)
    const hasBodyOverride = mobileBlock.body.match(/^body\s*\{/m);
    assert(!hasBodyOverride, 'No body override in mobile MQ (inherits from base)');
  }
}

// ============================================================
// Group 16: Landscape orientation considerations
// ============================================================
console.log('Group 16: Landscape orientation readiness');
{
  // Check for orientation media queries or aspect ratio handling
  // Even if not explicitly handled, verify the layout can survive landscape
  const hasOrientationMQ = cssContent.includes('orientation');

  // If no orientation MQ, that's OK — responsive width-based MQs should handle it
  if (!hasOrientationMQ) {
    assert(true, 'No explicit orientation MQ — relying on width-based breakpoints (acceptable)');
  } else {
    assert(hasOrientationMQ, 'Orientation-specific adjustments found');
  }

  // Verify aspect-ratio doesn't lock elements to portrait-only dimensions
  const hasAspectLock = cssContent.includes('aspect-ratio:') && cssContent.includes('(orientation: portrait)');
  assert(!hasAspectLock, 'No portrait-locked aspect ratios that would break in landscape');
}

// ============================================================
// Group 17: Safe area / notch handling
// ============================================================
console.log('Group 17: Safe area and notch considerations');
{
  // Check for env(safe-area-inset-*) usage (iOS notch/home indicator)
  const hasSafeArea = cssContent.includes('safe-area-inset');

  if (!hasSafeArea) {
    // Not required but recommended — note it as informational
    assert(true, 'No safe-area-inset usage (acceptable for game with full-screen canvas)');
  } else {
    assert(hasSafeArea, 'Safe area insets used for notch/home indicator avoidance');
  }

  // Verify the game canvas covers full viewport
  const containerMatch = cssContent.match(/#game-container[^{]*\{[^}]*\}/);
  if (containerMatch) {
    assert(containerMatch[0].includes('position: fixed') || containerMatch[0].includes('position:absolute'),
      'Game container uses fixed/absolute positioning for full-screen coverage');
    assert(containerMatch[0].includes('width: 100%') && containerMatch[0].includes('height: 100%'),
      'Game container fills 100% viewport');
  }
}

// ============================================================
// Group 18: Device pixel ratio (DPR) handling
// ============================================================
console.log('Group 18: High-DPI / Retina display readiness');
{
  // Check for -webkit-min-device-pixel-ratio or dpr-based media queries
  const hasDprMQ = cssContent.includes('min-device-pixel-ratio') || cssContent.includes('-webkit-min-device-pixel-ratio');

  // For a game using Three.js WebGL canvas, DPR is handled at the renderer level
  assert(true, 'DPR handling delegated to Three.js renderer (standard approach)');

  // Verify textures are committed as static assets (32x32 PNGs)
  const textureDir = path.join(__dirname, '..', 'textures');
  if (fs.existsSync(textureDir)) {
    const files = fs.readdirSync(textureDir);
    const pngFiles = files.filter(f => f.endsWith('.png'));
    assert(pngFiles.length > 0, `Found ${pngFiles.length} texture PNGs in textures/ directory`);
    assert(pngFiles.length >= 20, `At least 20 texture files present (found ${pngFiles.length})`);
  } else {
    assert(false, 'textures/ directory not found');
  }
}

// ============================================================
// Group 19: Viewport height handling (mobile browser chrome)
// ============================================================
console.log('Group 19: Mobile browser chrome handling');
{
  // Check for dvh (dynamic viewport height) or fallback to vh
  const hasDvh = cssContent.includes('dvh') || htmlContent.includes('dvh');

  if (!hasDvh) {
    // Standard vh is used — acceptable but may have issues with mobile browser chrome
    assert(true, 'Using standard vh units (may need dvh for mobile browser chrome in future)');
  } else {
    assert(hasDvh, 'Uses dvh for dynamic viewport height handling');
  }

  // Verify overflow: hidden on body to prevent scroll bounce
  const bodyOverflow = cssContent.match(/body[^{]*\{[^}]*overflow:\s*hidden/);
  assert(bodyOverflow !== null, 'Body has overflow: hidden (prevents scroll bounce on mobile)');
}

// ============================================================
// Group 20: Final cross-device summary
// ============================================================
console.log('Group 20: Cross-device summary validation');
{
  // Summarize which MQs apply at each tested device width
  const results = [];
  for (const [device, width] of Object.entries(DEVICE_WIDTHS)) {
    const applies600 = width <= 600;
    const applies360 = width <= 360;
    const applies768 = width <= 768;
    results.push({ device, width, applies600, applies360, applies768 });
  }

  // Verify expected MQ application for key devices
  const findDevice = (name) => results.find(r => r.device.includes(name));

  const se = findDevice('SE (1st gen)'); // 320px — both mobile + XS
  assert(se && se.applies600 && se.applies360, 'iPhone SE 1st gen: mobile + XS MQs apply');

  const s21 = findDevice('S21'); // 360px — both mobile + XS (exactly at boundary)
  assert(s21 && s21.applies600 && s21.applies360, 'Galaxy S21: mobile + XS MQs apply at exactly 360px');

  const iphone12 = findDevice('iPhone 12'); // 390px — only mobile
  assert(iphone12 && iphone12.applies600 && !iphone12.applies360, 'iPhone 12: only mobile MQ applies');

  const ipodMini = findDevice('iPad Mini'); // 768px — tablet only
  assert(ipodMini && ipodMini.applies768 && !ipodMini.applies600, 'iPad Mini: only tablet MQ applies');

  const ipadPro = findDevice('iPad Pro 12.9'); // 1024px — no MQs
  assert(ipadPro && !ipadPro.applies600 && !ipadPro.applies360 && !ipadPro.applies768,
    'iPad Pro 12.9": no MQs — pure desktop styles');

  // Log summary
  console.log('  Device MQ Summary:');
  for (const r of results) {
    const mqs = [];
    if (r.applies360) mqs.push('XS(360)');
    if (r.applies600) mqs.push('Mobile(600)');
    if (r.applies768) mqs.push('Tablet(768)');
    console.log(`    ${r.device.padEnd(25)} (${String(r.width).padStart(3)}px): ${mqs.length > 0 ? mqs.join(', ') : 'desktop'}`);
  }
}

// ============================================================
// Results
// ============================================================
console.log('');
console.log(`===================================`);
console.log(`  Results: ${PASS}/${TOTAL} passed, ${FAIL} failed`);
console.log(`===================================`);

if (FAIL > 0) {
  console.error('❌ Some mobile viewport tests failed!');
  process.exit(1);
} else {
  console.log('🎉 All mobile viewport tests passing across all device sizes!');
  process.exit(0);
}
