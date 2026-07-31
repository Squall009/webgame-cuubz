/**
 * Cuubz — markup template (PR 26)
 *
 * `#character-screen`. `#character-slots` is filled by
 * `src/ui/screens/CharacterScreen.js`; the e2e suite selects
 * `.char-slot[data-char-id] [data-action="edit"]`, so the action buttons must stay
 * descendants of their slot.
 *
 * Verbatim from `index.html`, which this replaces. Mounted eagerly by
 * `src/ui/templates/index.js` before anything wires a listener — decision 53.
 * The indentation is load-bearing only in that it reproduces the original
 * document's whitespace text nodes exactly; nothing here may gain or lose a
 * text node without checking `test/e2e/saveLoad.js` first.
 */

export const CHARACTER_SCREEN_TEMPLATE = `  <!-- Character Selection Screen -->
  <div id="character-screen" class="screen hidden">
    <h2>Select Character</h2>
    <p id="char-slot-info" class="slot-info"></p>
    <div id="character-slots"></div>
    <div class="menu-buttons">
      <button id="btn-create-char" class="menu-btn primary">Create Character</button>
      <button id="btn-back-char" class="menu-btn secondary">Back</button>
    </div>
  </div>`;
