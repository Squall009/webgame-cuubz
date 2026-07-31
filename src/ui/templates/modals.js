/**
 * Cuubz — markup template (PR 26)
 *
 * The three `.modal`s: create/edit character, the **shared** delete confirmation
 * (`UIManager` dispatches it on `dataset.worldId` / `dataset.charId`) and create
 * world.
 *
 * Four inline styles came off here: two typography ones on the delete modal's two
 * `<p>`s and `#btn-confirm-delete-char`'s red theming, now `.menu-btn.danger`.
 *
 * Verbatim from `index.html`, which this replaces. Mounted eagerly by
 * `src/ui/templates/index.js` before anything wires a listener — decision 53.
 * The indentation is load-bearing only in that it reproduces the original
 * document's whitespace text nodes exactly; nothing here may gain or lose a
 * text node without checking `test/e2e/saveLoad.js` first.
 */

export const MODALS_TEMPLATE = `  <!-- Character Create/Edit Modal -->
  <div id="create-char-modal" class="modal hidden">
    <div class="modal-content">
      <h3 id="char-modal-title">Create New Character</h3>
      <label for="char-name">Name:</label>
      <input type="text" id="char-name" maxlength="16" placeholder="Enter name...">
      <label for="char-color">Color:</label>
      <input type="color" id="char-color" value="#4CAF50">
      <div id="char-error" class="modal-error hidden"></div>
      <div class="modal-buttons">
        <button id="btn-save-char" class="menu-btn primary">Create</button>
        <button id="btn-cancel-char" class="menu-btn secondary">Cancel</button>
      </div>
    </div>
  </div>

  <!-- Character Delete Confirmation Modal -->
  <div id="delete-char-modal" class="modal hidden">
    <div class="modal-content">
      <h3>Delete Character?</h3>
      <p id="delete-char-name"></p>
      <p class="modal-note">This action cannot be undone. All progress for this character will be lost.</p>
      <div class="modal-buttons">
        <button id="btn-confirm-delete-char" class="menu-btn danger">Delete</button>
        <button id="btn-cancel-delete-char" class="menu-btn secondary">Cancel</button>
      </div>
    </div>
  </div>

  <!-- World Create Modal -->
  <div id="create-world-modal" class="modal hidden">
    <div class="modal-content">
      <h3>Create New World</h3>
      <label for="world-name">World Name:</label>
      <input type="text" id="world-name" maxlength="32" placeholder="Enter world name...">
      <!-- D-62: the field is prefilled with a random seed when the modal opens and it is
           REQUIRED. Blank used to draw a second, different random seed, which made a
           cleared field indistinguishable from a chosen one. The label said so; it does
           not any more. -->
      <label for="world-seed">Seed:</label>
      <input type="text" id="world-seed" maxlength="15" placeholder="A random seed is filled in for you">
      <div id="world-error" class="modal-error hidden"></div>
      <div class="modal-buttons">
        <button id="btn-save-world" class="menu-btn primary">Create World</button>
        <button id="btn-cancel-world" class="menu-btn secondary">Cancel</button>
      </div>
    </div>
  </div>`;
