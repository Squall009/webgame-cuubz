import { escapeHtml } from '../../util/HTMLUtils.js';

/**
 * Cuubz — the in-game player list (`#player-list-overlay`) — PR 16
 *
 * ─── WHY THIS IS NOT `src/multiplayer/PlayerListHUD.js` ──────────────────────
 *
 * `refactor.md` §4.1 sends "player list" to `src/multiplayer/PlayerListHUD.js`, and that
 * file **already exists, is imported by `main.js`, and is a different thing**: it is
 * instantiated inside `startGame()` and driven from the render loop, it owns
 * `#player-list` and per-player DOM it updates every thirtieth frame, and it knows about
 * positions in world space.
 *
 * These two functions were `renderPlayerList` / `hidePlayerList` in `main.js` and they are
 * the `#player-list-overlay` element, redrawn wholesale from `SessionManager`'s
 * `PLAYER_JOINED` / `PLAYER_LEFT` events — a lobby-side roster, not a HUD widget. Merging
 * them into `PlayerListHUD` would put two unrelated update cadences and two unrelated DOM
 * subtrees behind one name. **`BUGS.md` decision 28**: they get their own file under
 * `src/ui/hud/`, named for the element id so the collision cannot recur.
 *
 * `hide()` deliberately does **not** also hide the connection HUD, which the former
 * `hidePlayerList()` did. That is `ConnectionHUD.hide()`'s job now and both call sites
 * call both — see `ConnectionHUD.js`.
 */
export class PlayerListOverlay {
  /**
   * @param {Object} sessionUI — `UIManager`'s element bag. Elements are looked up once at
   *   `UIManager` construction, which is before any of them can be populated; every method
   *   here guards for a missing node exactly as the `main.js` originals did.
   */
  constructor(sessionUI) {
    this.sessionUI = sessionUI;
  }

  /**
   * Redraw the roster.
   * @param {Array<{id:string,name:string,color:string,health:number,position:Object}>} players
   */
  render(players) {
    const overlay = this.sessionUI.playerListOverlay;
    const itemsContainer = this.sessionUI.playerListItems;
    const countEl = this.sessionUI.playerCount;

    if (!overlay || !itemsContainer) return;

    // Showing the overlay is a side effect of rendering it, as it always has been: the
    // only caller is a PLAYER_JOINED / PLAYER_LEFT handler, so a render means multiplayer.
    overlay.classList.remove('hidden');
    itemsContainer.innerHTML = '';

    if (countEl) {
      countEl.textContent = players ? players.length : 0;
    }

    if (!players || players.length === 0) return;

    players.forEach(player => {
      const item = document.createElement('div');
      item.className = 'player-list-item';

      // D-85: `!= null`, not `!== undefined`. `Math.min(100, null)` is 0, so a literal
      // `health: null` — which `SessionManager` used to pass straight through — drew a
      // 0%, red bar for a player at full health. Same guard, same default, on both sides.
      const healthPercent = player.health != null ? Math.max(0, Math.min(100, player.health)) : 100;
      const healthColor = healthPercent > 60 ? '#4CAF50' : healthPercent > 30 ? '#f1c40f' : '#e74c3c';

      let posHtml = '';
      if (player.position) {
        const px = Math.round(player.position.x);
        const py = Math.round(player.position.y);
        const pz = Math.round(player.position.z);
        posHtml = `<span class="player-list-item-pos">(${px}, ${py}, ${pz})</span>`;
      }

      item.innerHTML = `
        <div class="player-list-item-header">
          <span class="player-color-dot" style="background:${escapeHtml(player.color || '#ffffff')}"></span>
          <span class="player-name-text">${escapeHtml(player.name || 'Player')}</span>
          <div class="player-health-bar">
            <div class="player-health-fill" style="width:${healthPercent}%;background:${healthColor};"></div>
          </div>
        </div>
        ${posHtml}
      `;

      itemsContainer.appendChild(item);
    });
  }

  /** Hide the overlay. */
  hide() {
    if (this.sessionUI.playerListOverlay) {
      this.sessionUI.playerListOverlay.classList.add('hidden');
    }
  }
}
