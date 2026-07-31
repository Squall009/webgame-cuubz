/**
 * Cuubz — the markup, and the one pass that mounts it (PR 26)
 *
 * ─── WHAT THIS IS ───────────────────────────────────────────────────────────
 *
 * `index.html` was 525 lines: 23 top-level `<body>` children carrying 157 unique `id`
 * attributes, plus one `<script>`. `refactor.md` §10 wants that file under 80 lines with
 * nothing in `<body>` but a mount point. The markup did not become smaller — it moved,
 * one module per screen or overlay, and this file is what puts it back on the page.
 *
 * ─── DECISION 53 — EVERY TEMPLATE MOUNTS EAGERLY, IN ONE PASS, BEFORE WIRING ─
 *
 * The obvious design is lazy: each screen injects its own markup the first time it is
 * shown. It is not available here, and the reason is measurable rather than aesthetic.
 *
 * `src/` performs **224 `getElementById` and 13 `querySelector` calls resolving to 141
 * distinct ids**, and they do not wait for a screen to be shown:
 * `UIManager`'s constructor alone captures 19 elements (`UIManager.js:45-76`) into
 * `screens`, `modals` and `sessionUI`, and every screen's `init()` captures more at wire
 * time — `UIManager.initNavigation()` calls `getElementById(...).addEventListener(...)`
 * **unguarded**, eleven times, before any screen has ever been shown. A lazily mounted
 * `#btn-survival` is `null` at that moment and the whole menu dies in
 * `initNavigation`'s catch.
 *
 * Making lazy mounting work therefore means rewriting all 141 lookups to resolve after a
 * show, in the same change that moves the markup. That is a second refactor smuggled into
 * this one. So: one `mountTemplates()`, called from the top of `Bootstrap.start()`, and
 * every lookup in `src/` keeps resolving exactly when it always has.
 *
 * ─── ORDER IS PART OF THE CONTRACT ──────────────────────────────────────────
 *
 * `TEMPLATES` below is in the DOM order of the old `index.html`, and it must stay that
 * way. Nothing in the cascade compensates for a reordering: `#hud` (z-index 150),
 * `.screen` (200) and `.modal` (300) are explicit, but the sibling overlays are not, and
 * `src/ui/css/index.css` is emphatic that source order is already load-bearing (D-52).
 * The blank line between blocks is reproduced too — the whitespace text nodes between the
 * top-level elements are the ones the parsed document had.
 */

import { STAGE_TEMPLATE } from './stage.js';
import { HUD_TEMPLATE } from './hud.js';
import { MAIN_MENU_TEMPLATE } from './mainMenu.js';
import { CHARACTER_SCREEN_TEMPLATE } from './characterScreen.js';
import { MODALS_TEMPLATE } from './modals.js';
import { WORLD_SCREEN_TEMPLATE } from './worldScreen.js';
import { MODE_SCREEN_TEMPLATE } from './modeScreen.js';
import { SETTINGS_SCREEN_TEMPLATE } from './settingsScreen.js';
import { LOBBY_SCREEN_TEMPLATE } from './lobbyScreen.js';
import { SESSION_HUD_TEMPLATE } from './sessionHud.js';
import { CRAFTING_SCREEN_TEMPLATE } from './craftingScreen.js';
import { DEBUG_STATS_TEMPLATE } from './debugStats.js';
import { PAUSE_MENU_TEMPLATE } from './pauseMenu.js';
import { TOUCH_CONTROLS_TEMPLATE } from './touchControls.js';
import { LOADING_SCREEN_TEMPLATE } from './loadingScreen.js';

/** The old `<body>`, in the old order. Do not sort this. */
const TEMPLATES = [
  STAGE_TEMPLATE, // #game-container #crosshair #day-night-indicator
  //                 #target-highlight #atlas-overlay #block-tooltip
  HUD_TEMPLATE, // #hud
  MAIN_MENU_TEMPLATE, // #main-menu
  CHARACTER_SCREEN_TEMPLATE, // #character-screen
  MODALS_TEMPLATE, // #create-char-modal #delete-char-modal #create-world-modal
  WORLD_SCREEN_TEMPLATE, // #world-screen
  MODE_SCREEN_TEMPLATE, // #mode-screen
  SETTINGS_SCREEN_TEMPLATE, // #settings-screen
  LOBBY_SCREEN_TEMPLATE, // #lobby-screen
  SESSION_HUD_TEMPLATE, // #connection-hud #player-list-overlay
  CRAFTING_SCREEN_TEMPLATE, // #crafting-screen
  DEBUG_STATS_TEMPLATE, // #debug-stats
  PAUSE_MENU_TEMPLATE, // #pause-menu
  TOUCH_CONTROLS_TEMPLATE, // #touch-controls
  LOADING_SCREEN_TEMPLATE, // #loading-screen
];

/** The one element `index.html` still ships. */
export const MOUNT_ID = 'app';

/**
 * Put every screen, overlay and HUD element on the page.
 *
 * Idempotent: a second call replaces the subtree rather than duplicating 157 ids, which
 * matters because `start()` is the only caller and a duplicated id is the failure mode
 * `getElementById` reports as "it works, but on the wrong element".
 *
 * @param {HTMLElement} [root] — defaults to `#app`.
 * @returns {HTMLElement} the mount point.
 */
export function mountTemplates(root) {
  const mount = root || document.getElementById(MOUNT_ID);
  if (!mount) {
    throw new Error(`[Cuubz] #${MOUNT_ID} is missing from index.html — nothing to mount the UI into`);
  }
  mount.innerHTML = TEMPLATES.join('\n\n');
  return mount;
}
