/**
 * Cuubz — the connection indicator, in the lobby and in game (PR 16)
 *
 * This was `updateConnectionStatus(status)` in `src/main.js`, called from twelve places
 * inside `SessionManager`. It writes **two** elements that carry the same state at
 * different moments — `#connection-status` in the lobby and `#connection-hud` over the
 * game — and that is why it is one object rather than two.
 *
 * `refactor.md` §4.1 already names `src/ui/hud/ConnectionHUD.js`, so this is its slot.
 * The former `hidePlayerList()` in `main.js` hid `#connection-hud` as well as the player
 * list, which put a connection control inside a roster function; the two halves are split
 * here and **both call sites call both**, so the visible behaviour is unchanged.
 */
const STATUS_TEXT = {
  disconnected: 'Disconnected',
  connecting: 'Connecting...',
  connected: 'Connected',
  reconnecting: 'Reconnecting...',
};

export class ConnectionHUD {
  /**
   * @param {Object} sessionUI — `UIManager`'s element bag.
   */
  constructor(sessionUI) {
    this.sessionUI = sessionUI;
  }

  /**
   * @param {'disconnected'|'connecting'|'connected'|'reconnecting'} status
   */
  set(status) {
    const text = STATUS_TEXT[status] || status;

    if (this.sessionUI.connectionStatus) {
      this.sessionUI.connectionStatus.className = `connection-status ${status}`;
      const textEl = this.sessionUI.connectionStatus.querySelector('.status-text');
      if (textEl) textEl.textContent = text;
    }

    if (this.sessionUI.connectionHud) {
      this.sessionUI.connectionHud.className = `connection-hud ${status}`;
      const hudText = this.sessionUI.connectionHud.querySelector('.status-text');
      if (hudText) hudText.textContent = text;
    }
  }

  /** Hide the in-game indicator. The lobby one is hidden by leaving the lobby. */
  hide() {
    if (this.sessionUI.connectionHud) {
      this.sessionUI.connectionHud.classList.add('hidden');
    }
  }
}
