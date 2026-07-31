/**
 * Cuubz — markup template (PR 26)
 *
 * `#hud` — the pointer-transparent in-game overlay root and everything inside it:
 * the five survival meters, the hotbar, the quest tracker, the fly-mode and armor
 * indicators and the damage flash.
 *
 * **The `*-meter` family and `quest-*` are referenced from nowhere in `src/`.** They
 * are PR 34's (D-25 / D-69), not dead markup, and deleting them is that PR's call.
 * The five `.meter-fill` divs carried `style="width:100%"`; that lives in
 * `src/ui/css/hud/meters.css` now — nothing in `src/` ever writes the property.
 *
 * Verbatim from `index.html`, which this replaces. Mounted eagerly by
 * `src/ui/templates/index.js` before anything wires a listener — decision 53.
 * The indentation is load-bearing only in that it reproduces the original
 * document's whitespace text nodes exactly; nothing here may gain or lose a
 * text node without checking `test/e2e/saveLoad.js` first.
 */

export const HUD_TEMPLATE = `  <!-- HUD: Survival Meters -->
  <div id="hud" class="hidden">
    <div id="meters-container">
      <div class="meter" id="health-meter" data-meter="health">
        <div class="meter-bar"><div class="meter-fill"></div></div>
        <span class="meter-label">❤️ Health</span>
      </div>
      <div class="meter" id="hunger-meter" data-meter="hunger">
        <div class="meter-bar"><div class="meter-fill"></div></div>
        <span class="meter-label">🍎 Hunger</span>
      </div>
      <div class="meter" id="thirst-meter" data-meter="thirst">
        <div class="meter-bar"><div class="meter-fill"></div></div>
        <span class="meter-label">💧 Thirst</span>
      </div>
      <div class="meter" id="sleep-meter" data-meter="sleep">
        <div class="meter-bar"><div class="meter-fill"></div></div>
        <span class="meter-label">😴 Sleep</span>
      </div>
      <div class="meter" id="stamina-meter" data-meter="stamina">
        <div class="meter-bar"><div class="meter-fill"></div></div>
        <span class="meter-label">⚡ Stamina</span>
      </div>
    </div>

    <!-- Hotbar -->
    <div id="hotbar-container">
      <div id="hotbar">
        <!-- 9 hotbar slots, filled by inventory system -->
        <div class="hotbar-slot active" data-slot="0"></div>
        <div class="hotbar-slot" data-slot="1"></div>
        <div class="hotbar-slot" data-slot="2"></div>
        <div class="hotbar-slot" data-slot="3"></div>
        <div class="hotbar-slot" data-slot="4"></div>
        <div class="hotbar-slot" data-slot="5"></div>
        <div class="hotbar-slot" data-slot="6"></div>
        <div class="hotbar-slot" data-slot="7"></div>
        <div class="hotbar-slot" data-slot="8"></div>
      </div>
    </div>

    <!-- Quest Tracker -->
    <div id="quest-tracker" class="hidden">
      <div class="quest-header">📜 Quest</div>
      <div class="quest-current" id="quest-name"></div>
      <div class="quest-objective" id="quest-objective"></div>
      <div class="quest-progress" id="quest-progress"></div>
    </div>

    <!-- Fly Mode Indicator -->
    <div id="fly-mode-indicator" class="hidden">🚀 FLY MODE — Space=Up, Shift/S=Down</div>

    <!-- Armor Indicator (HUD) -->
    <div id="armor-indicator" class="hidden">🛡️ <span id="hud-defense">0</span></div>

    <!-- Damage Flash -->
    <div id="damage-flash"></div>
  </div>`;
