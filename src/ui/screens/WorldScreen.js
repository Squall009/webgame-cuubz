/**
 * Cuubz — WorldScreen (PR 15)
 *
 * `refactor.md` §8.2: `renderWorldSlots`, `createWorldSlotElement`,
 * `openCreateWorldModal`, `closeCreateWorldModal`, `openDeleteWorldModal` and the world
 * half of `initMenuNavigation`, moved out of `main.js`.
 *
 * The delete modal is **shared with `CharacterScreen`** — one `#delete-char-modal` serves
 * both — and its confirm/cancel handler lives in `UIManager`. This screen exposes
 * `openDeleteModal`, `closeDeleteModal` and `confirmDelete` for it to call.
 *
 * `confirmDelete` is where the D-18 / H-3 chunk cleanup is reached from:
 * `WorldManager.deleteWorld` → `PersistenceManager.deleteWorld` → the IndexedDB key range.
 * `test/e2e/saveLoad.js` drives this exact path through this exact button (PR 14).
 */

import { MAX_WORLDS, WorldManager } from '../../game/entities/WorldManager.js';
import { escapeHtml } from '../../util/HTMLUtils.js';

/**
 * Swatch colour per dominant biome.
 *
 * **D-39:** this table used to key on the eight names `BrowserWorldManager` invented
 * (`Plains Forest Desert Tundra Mountains Ocean Lava Corrupt`), two of which — Lava and
 * Corrupt — are not biomes this game has. These are the real ten from `BiomeSystem.js`
 * and the colours are that file's own `color:` fields.
 */
const BIOME_COLORS = {
  'Deep Ocean': '#051d3b', 'Ocean': '#1565C0', 'Beach': '#d4b483', 'Plains': '#5a8a3c',
  'Forest': '#2d6e2d', 'Badlands': '#b5623e', 'Tundra': '#c8dde8', 'Desert': '#d1b247',
  'Mountains': '#607d8b', 'Frozen Peaks': '#e0f7fa'
};

export class WorldScreen {
  /**
   * @param {import('../UIManager.js').UIManager} ui
   */
  constructor(ui) {
    this.ui = ui;
    this.deps = ui.deps;
  }

  /** Wire this screen's controls. Called once, from `UIManager.initNavigation`. */
  init() {
    document.getElementById('btn-create-world').addEventListener('click', () => {
      const wm = this.deps.worldManager;
      if (!wm || !wm.canCreateMore()) return;
      this.openCreateModal();
    });

    document.getElementById('btn-save-world').addEventListener('click', async () => {
      const name = document.getElementById('world-name').value.trim();
      if (!name) { this.showError('Please enter a world name'); return; }

      // Blank seed means random; a non-numeric one is rejected rather than silently
      // falling back, so a typo does not quietly produce a different world.
      let seed = undefined;
      const seedInput = document.getElementById('world-seed').value.trim();
      if (seedInput !== '') {
        const parsed = parseInt(seedInput, 10);
        if (!isNaN(parsed)) {
          seed = parsed;
        } else {
          this.showError('Seed must be a valid integer (or leave blank for random)');
          return;
        }
      }

      const result = await this.deps.worldManager.createWorld(name, seed);
      if (result.success) {
        this.closeCreateModal();
        this.render();
      } else {
        this.showError(result.error);
      }
    });

    document.getElementById('btn-cancel-world').addEventListener('click', () => this.closeCreateModal());

    document.getElementById('world-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') document.getElementById('btn-save-world').click();
      if (e.key === 'Escape') this.closeCreateModal();
    });
  }

  // ── Slot rendering ────────────────────────────────────────────────────

  render() {
    const container = document.getElementById('world-slots');
    if (!container) {
      this.deps.log('[Cuubz] #world-slots not found');
      return;
    }

    container.innerHTML = '';

    let worlds = [];
    try {
      const wm = this.deps.worldManager;
      worlds = wm ? wm.getAllWorlds() : [];
    } catch (err) {
      console.error('[Cuubz] Error loading worlds for display:', err);
    }

    worlds.forEach(world => {
      try {
        container.appendChild(this.createSlotElement(world));
      } catch (err) {
        console.error('[Cuubz] Error rendering world slot:', err, world);
      }
    });

    // Empty slots
    for (let i = worlds.length; i < MAX_WORLDS; i++) {
      const emptySlot = document.createElement('div');
      emptySlot.className = 'world-slot empty';
      emptySlot.innerHTML = '<span style="font-size:28px;color:#555;">+</span><span class="world-name">Empty</span>';
      container.appendChild(emptySlot);
    }

    const worldSlotInfo = document.getElementById('world-slot-info');
    if (worldSlotInfo) {
      const remaining = MAX_WORLDS - worlds.length;
      worldSlotInfo.textContent = `${worlds.length}/${MAX_WORLDS} worlds (${remaining} slots available)`;
    }

    const createBtn = document.getElementById('btn-create-world');
    if (createBtn) {
      const wm = this.deps.worldManager;
      if (wm && !wm.canCreateMore()) {
        createBtn.disabled = true;
        createBtn.textContent = 'Slots Full';
        createBtn.style.opacity = '0.5';
      } else {
        createBtn.disabled = false;
        createBtn.textContent = 'Create New World';
        createBtn.style.opacity = '1';
      }
    }
  }

  createSlotElement(world) {
    const wm = this.deps.worldManager;
    const slot = document.createElement('div');
    slot.className = 'world-slot' + (wm && wm.selectedId === world.id ? ' selected' : '');
    slot.style.position = 'relative';
    slot.dataset.worldId = world.id;

    // `getWorldPreview` is the tested equivalent of `BrowserWorldManager.getBiomePreview`
    // and a superset — it also returns `chunkCount`, which nothing renders yet (PR 14).
    const preview = WorldManager.getWorldPreview(world);
    const primaryBiome = preview.biomes.split(',')[0] || 'Plains';
    const biomeColor = BIOME_COLORS[primaryBiome] || '#4CAF50';

    slot.innerHTML = `
      <div class="world-icon" style="background:${biomeColor};" title="${preview.biomes}">🌍</div>
      <div class="world-info">
        <span class="world-name">${escapeHtml(world.name)}</span>
        <span class="world-seed">Seed: ${preview.seed}</span>
        <span class="world-biomes" title="${preview.biomes}">${preview.biomes}</span>
      </div>
      <div class="world-slot-actions">
        <button class="world-slot-action-btn delete" title="Delete world" data-action="delete">✕</button>
      </div>
    `;

    slot.addEventListener('click', async (e) => {
      if (e.target.closest('.world-slot-action-btn')) return;
      const mgr = this.deps.worldManager;
      if (mgr) {
        await mgr.selectWorld(world.id);
        this.render();
        this.ui.show('modeScreen');
      }
    });

    slot.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.openDeleteModal(world);
    });

    return slot;
  }

  // ── Create modal ──────────────────────────────────────────────────────

  openCreateModal() {
    document.getElementById('world-name').value = '';
    // Pre-fill a random seed so the field shows what will be used; the player can edit it
    // or clear it for another random one.
    document.getElementById('world-seed').value = String(Math.floor(Math.random() * 0xFFFFFFFF));
    this.hideError();
    this.ui.modals.createWorldModal.classList.remove('hidden');
    // Force modal-content visible — some CSS paths leave it display:none.
    const mc = this.ui.modals.createWorldModal.querySelector('.modal-content');
    if (mc) mc.style.display = 'block';
    setTimeout(() => document.getElementById('world-name').focus(), 100);
  }

  closeCreateModal() {
    if (this.ui.modals.createWorldModal) {
      this.ui.modals.createWorldModal.classList.add('hidden');
    }
  }

  // ── Delete modal (shared element, dispatched by UIManager) ────────────

  openDeleteModal(world) {
    document.getElementById('delete-char-name').textContent = `"${world.name}"`;
    this.ui.modals.deleteCharModal.dataset.worldId = world.id;
    this.ui.modals.deleteCharModal.classList.remove('hidden');
  }

  closeDeleteModal() {
    this.ui.modals.deleteCharModal.classList.add('hidden');
    delete this.ui.modals.deleteCharModal.dataset.worldId;
  }

  async confirmDelete(worldId) {
    const result = await this.deps.worldManager.deleteWorld(worldId);
    if (result.success) {
      this.closeDeleteModal();
      this.render();
      this.deps.log(`[Cuubz] World deleted: ${worldId}`);
    } else {
      alert(result.error);
    }
  }

  // ── Error banner ──────────────────────────────────────────────────────

  showError(message) {
    const errorEl = document.getElementById('world-error');
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }

  hideError() {
    document.getElementById('world-error').classList.add('hidden');
  }
}
