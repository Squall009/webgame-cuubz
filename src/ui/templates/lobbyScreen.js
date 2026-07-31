/**
 * Cuubz — markup template (PR 26)
 *
 * `#lobby-screen` — the largest single block in the old `index.html` at 109 lines:
 * the connection indicator, the browse/host tabs, the rejoin panel, the session list
 * and the host form with its two inline character/world creation forms.
 *
 * **Thirteen of the twenty-four inline styles were in here**, six of them nothing but
 * two repeated declarations: `.menu-btn.compact` (the three `+ New` toggles) and
 * `.menu-btn.inline-submit` (the three inline-form submits). Both are in
 * `src/ui/css/components/buttons.css`; the rest are in `src/ui/css/screens/lobby.css`.
 *
 * Verbatim from `index.html`, which this replaces. Mounted eagerly by
 * `src/ui/templates/index.js` before anything wires a listener — decision 53.
 * The indentation is load-bearing only in that it reproduces the original
 * document's whitespace text nodes exactly; nothing here may gain or lose a
 * text node without checking `test/e2e/saveLoad.js` first.
 */

export const LOBBY_SCREEN_TEMPLATE = `  <!-- Multiplayer Lobby Screen -->
  <div id="lobby-screen" class="screen hidden">
    <h2>Multiplayer Lobby</h2>
    <!-- Connection Status Indicator -->
    <div id="connection-status" class="connection-status disconnected">
      <span class="status-dot"></span>
      <span class="status-text">Disconnected</span>
    </div>
    <!-- Tab Navigation: Browse / Host -->
    <div class="lobby-tabs">
      <button id="tab-browse" class="lobby-tab active">Browse Sessions</button>
      <button id="tab-host" class="lobby-tab">Host Session</button>
    </div>
    <!-- Rejoin Session Button (shown when there's a recent session) -->
    <div id="rejoin-panel" class="lobby-panel hidden">
      <div class="rejoin-row">
        <div>
          <span class="rejoin-title">⚡ Rejoin Session</span>
          <span id="rejoin-session-name"></span>
        </div>
        <div>
          <button id="btn-rejoin-session" class="menu-btn primary">Rejoin</button>
          <button id="btn-clear-rejoin" class="menu-btn secondary">✕</button>
        </div>
      </div>
    </div>
    <!-- Browse Tab: Session List -->
    <div id="browse-panel" class="lobby-panel">
      <!-- Character selection for joining -->
      <div class="browse-character-picker">
        <label for="browse-character-select">Play as:</label>
        <div class="host-select-row">
          <select id="browse-character-select"></select>
          <button id="btn-browse-create-char" class="menu-btn compact">+ New</button>
        </div>
        <!-- Inline character creation for browse -->
        <div id="browse-create-char-form" class="host-inline-form hidden">
          <div class="host-inline-form-row">
            <input type="text" id="browse-char-name" maxlength="16" placeholder="Character name...">
            <input type="color" id="browse-char-color" value="#4CAF50" title="Character color">
          </div>
          <div id="browse-char-error" class="modal-error hidden"></div>
          <button id="btn-browse-save-char" class="menu-btn primary inline-submit">Create Character</button>
        </div>
      </div>
      <div id="session-list"></div>
      <p id="no-sessions-msg" class="lobby-empty hidden">No sessions available. Be the first to host!</p>
      <button id="btn-refresh-sessions" class="menu-btn secondary">Refresh</button>
    </div>
    <!-- Host Tab: Session Creation -->
    <div id="host-panel" class="lobby-panel hidden">
      <div class="host-form">
        <!-- Session Name -->
        <label for="host-session-name">Session Name:</label>
        <input type="text" id="host-session-name" maxlength="32" placeholder="My Awesome World">

        <!-- Character Selection -->
        <label for="host-character-select">Your Character:</label>
        <div class="host-select-row">
          <select id="host-character-select"></select>
          <button id="btn-host-create-char" class="menu-btn compact">+ New</button>
        </div>
        <!-- Inline character creation form (collapsed by default) -->
        <div id="host-create-char-form" class="host-inline-form hidden">
          <div class="host-inline-form-row">
            <input type="text" id="host-char-name" maxlength="16" placeholder="Character name...">
            <input type="color" id="host-char-color" value="#4CAF50" title="Character color">
          </div>
          <div id="host-char-error" class="modal-error hidden"></div>
          <button id="btn-host-save-char" class="menu-btn primary inline-submit">Create Character</button>
        </div>

        <!-- World Selection -->
        <label for="host-world-select">World:</label>
        <div class="host-select-row">
          <select id="host-world-select"></select>
          <button id="btn-host-create-world" class="menu-btn compact">+ New</button>
        </div>
        <!-- Inline world creation form (collapsed by default) -->
        <div id="host-create-world-form" class="host-inline-form hidden">
          <div class="host-inline-form-row">
            <input type="text" id="host-world-name" maxlength="32" placeholder="World name...">
            <!-- D-62: prefilled on open and required — not optional. See createEntity.js. -->
            <input type="text" id="host-world-seed" maxlength="15" placeholder="Seed">
          </div>
          <div id="host-world-error" class="modal-error hidden"></div>
          <button id="btn-host-save-world" class="menu-btn primary inline-submit">Create World</button>
        </div>

        <!-- Game Mode -->
        <label for="host-mode-select">Game Mode:</label>
        <select id="host-mode-select">
          <option value="survival">Survival</option>
          <option value="creative">Creative</option>
        </select>

        <!-- Max Players -->
        <label for="host-max-players">Max Players:</label>
        <input type="range" id="host-max-players" min="2" max="4" value="4">
        <span id="host-max-players-value">4</span>

        <div id="host-error" class="modal-error hidden"></div>
      </div>
      <div class="menu-buttons">
        <button id="btn-start-hosting" class="menu-btn primary">Start Hosting</button>
      </div>
    </div>
    <div class="menu-buttons">
      <button id="btn-back-lobby" class="menu-btn secondary">Back</button>
    </div>
  </div>`;
