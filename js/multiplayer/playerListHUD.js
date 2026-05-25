/**
 * Cuubz — Player List HUD Module
 *
 * Manages the in-game player list overlay: rendering players with name, color dot,
 * and health bar. Features a collapsible panel on mobile viewports.
 *
 * Architecture:
 *   - Pure DOM manipulation (no Three.js dependency)
 *   - Testable in Node.js via browser context guards
 *   - Mobile detection triggers collapsible behavior
 *   - Health bars color-coded: green (>60%), yellow (>30%), red (≤30%)
 */

'use strict';

// ─── Constants ──────────────────────────────────────────────────────

const HUD_CONFIG = {
  overlayId: 'player-list-overlay',
  countId: 'player-count',
  itemsId: 'player-list-items',
  toggleId: 'player-list-toggle',
  mobileBreakpoint: 600,       // px — below this width = mobile
  collapsedClass: 'collapsed',
  hiddenClass: 'hidden',
  healthGreenThreshold: 60,    // % — above = green
  healthYellowThreshold: 30,   // % — above = yellow, else red
};

/**
 * Escape HTML to prevent XSS in player names.
 * @param {string} text
 * @returns {string}
 */
function escapeHtml(text) {
  if (typeof text !== 'string') return '';
  const div = typeof document !== 'undefined' ? document.createElement('div') : null;
  // Node.js fallback: manual escaping
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Get health bar color based on percentage.
 * @param {number} percent — 0-100
 * @returns {string} CSS color
 */
function getHealthColor(percent) {
  const p = Math.max(0, Math.min(100, percent));
  if (p > HUD_CONFIG.healthGreenThreshold) return '#4CAF50';
  if (p > HUD_CONFIG.healthYellowThreshold) return '#f1c40f';
  return '#e74c3c';
}

/**
 * Check if current viewport is mobile-sized.
 * @returns {boolean}
 */
function isMobileViewport() {
  if (typeof window === 'undefined' || !window.innerWidth) return false;
  return window.innerWidth <= HUD_CONFIG.mobileBreakpoint;
}

// ─── Player List HUD Class ──────────────────────────────────────────

/**
 * Manages the player list HUD overlay.
 * Handles rendering, toggling (mobile), and state management.
 */
class PlayerListHUD {
  /**
   * @param {Object} elements — DOM element references
   * @param {HTMLElement} elements.overlay — The overlay container
   * @param {HTMLElement} elements.count — Player count display
   * @param {HTMLElement} elements.items — Items container
   */
  constructor(elements) {
    this._overlay = elements && elements.overlay ? elements.overlay : null;
    this._count = elements && elements.count ? elements.count : null;
    this._items = elements && elements.items ? elements.items : null;
    this._toggleBtn = null;
    this._players = [];
    this._collapsed = false;
    this._visible = false;

    // Callbacks
    this.onToggle = null;

    // Setup toggle button for mobile
    if (this._overlay && typeof document !== 'undefined') {
      this._setupToggle();
    }
  }

  /**
   * Set up the collapse toggle button on the header.
   * Only active on mobile viewports.
   */
  _setupToggle() {
    const header = this._overlay.querySelector('.player-list-header');
    if (!header) return;

    // Create toggle button
    const btn = document.createElement('button');
    btn.id = HUD_CONFIG.toggleId;
    btn.className = 'player-list-toggle';
    btn.type = 'button';
    btn.innerHTML = '&#9662;'; // Down arrow (collapsed state)
    btn.style.cssText = 'background:none;border:none;color:#f1c40f;cursor:pointer;font-size:10px;padding:2px 4px;margin-left:4px;line-height:1;';

    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleCollapse();
    });

    header.appendChild(btn);
    this._toggleBtn = btn;

    // Update toggle visibility based on viewport
    this._updateToggleVisibility();

    // Listen for resize events
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', () => {
        this._updateToggleVisibility();
        // If resized to desktop, auto-expand
        if (!isMobileViewport() && this._collapsed) {
          this.setCollapsed(false);
        }
      });
    }
  }

  /**
   * Show/hide toggle button based on viewport size.
   */
  _updateToggleVisibility() {
    if (!this._toggleBtn) return;
    if (isMobileViewport()) {
      this._toggleBtn.style.display = 'inline';
    } else {
      this._toggleBtn.style.display = 'none';
      // Auto-expand on desktop
      if (this._collapsed) {
        this.setCollapsed(false);
      }
    }
  }

  /**
   * Show the player list overlay.
   */
  show() {
    this._visible = true;
    if (!this._overlay) return;
    this._overlay.classList.remove(HUD_CONFIG.hiddenClass);
  }

  /**
   * Hide the player list overlay.
   */
  hide() {
    this._visible = false;
    if (!this._overlay) return;
    this._overlay.classList.add(HUD_CONFIG.hiddenClass);
  }

  /**
   * Toggle collapse state (mobile only).
   */
  toggleCollapse() {
    this.setCollapsed(!this._collapsed);
  }

  /**
   * Set collapsed state explicitly.
   * @param {boolean} collapsed
   */
  setCollapsed(collapsed) {
    this._collapsed = collapsed;

    if (this._items) {
      if (collapsed) {
        this._items.classList.add(HUD_CONFIG.collapsedClass);
      } else {
        this._items.classList.remove(HUD_CONFIG.collapsedClass);
      }
    }

    // Update toggle button arrow
    if (this._toggleBtn) {
      this._toggleBtn.innerHTML = collapsed ? '&#9650;' : '&#9662;'; // Up or down arrow
    }

    if (this.onToggle) {
      this.onToggle(collapsed);
    }
  }

  /**
   * Check if HUD is currently collapsed.
   * @returns {boolean}
   */
  getCollapsed() {
    return this._collapsed;
  }

  /**
   * Check if HUD is visible (not hidden).
   * @returns {boolean}
   */
  getVisible() {
    return this._visible;
  }

  /**
   * Update the player list with new player data.
   * @param {Array} players — Array of {id, name, color, health} objects
   */
  updatePlayers(players) {
    this._players = players || [];
    this._render();
  }

  /**
   * Add a single player to the list.
   * @param {Object} player — {id, name, color, health}
   */
  addPlayer(player) {
    if (!player) return;
    // Check if already exists
    const existing = this._players.find(p => p.id === player.id);
    if (existing) {
      Object.assign(existing, player);
    } else {
      this._players.push({ ...player });
    }
    this._render();
  }

  /**
   * Remove a player by ID.
   * @param {string} playerId
   */
  removePlayer(playerId) {
    this._players = this._players.filter(p => p.id !== playerId);
    this._render();
  }

  /**
   * Get the current player count.
   * @returns {number}
   */
  getPlayerCount() {
    return this._players.length;
  }

  /**
   * Get all players as an array.
   * @returns {Array}
   */
  getPlayers() {
    return [...this._players];
  }

  /**
   * Clear all players.
   */
  clear() {
    this._players = [];
    this._visible = false;
    this._render();
  }

  /**
   * Render the player list to DOM.
   */
  _render() {
    // Auto-show if players exist (state tracking independent of DOM)
    if (this._players.length > 0) {
      this.show();
    }

    if (!this._items) return;

    // Update count
    if (this._count) {
      this._count.textContent = this._players.length;
    }

    // Clear existing items
    this._items.innerHTML = '';

    // Render each player
    this._players.forEach(player => {
      const item = document.createElement('div');
      item.className = 'player-list-item';
      item.dataset.playerId = player.id || '';

      const healthPercent = player.health !== undefined
        ? Math.max(0, Math.min(100, player.health))
        : 100;
      const healthColor = getHealthColor(healthPercent);
      const name = escapeHtml(player.name || 'Player');
      const color = escapeHtml(player.color || '#ffffff');

      item.innerHTML = `
        <span class="player-color-dot" style="background:${color}"></span>
        <span class="player-name-text">${name}</span>
        <div class="player-health-bar">
          <div class="player-health-fill" style="width:${healthPercent}%;background:${healthColor};"></div>
        </div>
      `;

      this._items.appendChild(item);
    });
  }

  /**
   * Destroy the HUD and clean up event listeners.
   */
  destroy() {
    if (this._toggleBtn && this._overlay) {
      this._toggleBtn.removeEventListener('click', () => {});
      if (this._toggleBtn.parentNode) {
        this._toggleBtn.parentNode.removeChild(this._toggleBtn);
      }
    }
    this._players = [];
    this._overlay = null;
    this._count = null;
    this._items = null;
    this._toggleBtn = null;
  }
}

// ─── State Machine (for testing without DOM) ────────────────────────

/**
 * Pure state machine for player list HUD logic.
 * No DOM dependencies — fully testable in Node.js.
 */
class PlayerListState {
  constructor() {
    this.players = [];
    this.collapsed = false;
    this.visible = false;
  }

  addPlayer(player) {
    if (!player || !player.id) return false;
    const existing = this.players.find(p => p.id === player.id);
    if (existing) {
      Object.assign(existing, player);
      return false; // updated, not added
    }
    this.players.push({ ...player });
    this.visible = true;
    return true;
  }

  removePlayer(playerId) {
    const before = this.players.length;
    this.players = this.players.filter(p => p.id !== playerId);
    if (this.players.length === 0) {
      this.visible = false;
    }
    return before !== this.players.length;
  }

  clear() {
    this.players = [];
    this.visible = false;
  }

  toggleCollapse() {
    this.collapsed = !this.collapsed;
  }

  setCollapsed(collapsed) {
    this.collapsed = collapsed;
  }

  getHealthColor(health) {
    const p = health !== undefined ? Math.max(0, Math.min(100, health)) : 100;
    return getHealthColor(p);
  }

  getPlayerCount() {
    return this.players.length;
  }

  getPlayer(playerId) {
    return this.players.find(p => p.id === playerId) || null;
  }

  getStateSummary() {
    return {
      playerCount: this.players.length,
      collapsed: this.collapsed,
      visible: this.visible,
      players: this.players.map(p => ({ id: p.id, name: p.name, health: p.health })),
    };
  }
}

// ─── Exports (Node.js / browser compat) ──────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    HUD_CONFIG,
    escapeHtml,
    getHealthColor,
    isMobileViewport,
    PlayerListHUD,
    PlayerListState,
  };
}
