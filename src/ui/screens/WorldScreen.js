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
import {
  canOpen, hideBanner, randomSeed, setBanner, submitCreate, syncCreateButton,
} from '../forms/createEntity.js';

/** The create button's two labels. `CharacterScreen` has the same pair for its own noun. */
const CREATE_LABELS = { idle: 'Create New World', full: 'Slots Full' };

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
      if (!canOpen(this.deps.worldManager)) return;
      this.openCreateModal();
    });

    // D-41: the empty-name message gained its trailing period (it was the one of five
    // that lacked it), the seed parse is `createEntity.parseSeed` — byte-identical logic
    // to the lobby's host-world form, which had a different message — and success now
    // logs, which this path alone did not.
    document.getElementById('btn-save-world').addEventListener('click', async () => {
      await submitCreate({
        manager: this.deps.worldManager,
        noun: 'world',
        name: document.getElementById('world-name').value.trim(),
        extra: document.getElementById('world-seed').value,
        errorEl: document.getElementById('world-error'),
        onSuccess: (result) => {
          this.closeCreateModal();
          this.render();
          this.deps.log(`[Cuubz] World created: ${result.world.name}`);
        },
      });
    });

    document.getElementById('btn-cancel-world').addEventListener('click', () => this.closeCreateModal());

    document.getElementById('world-name').addEventListener('keydown', (e) => {
      // D-41: `preventDefault()` was missing here and present on the other four.
      if (e.key === 'Enter') { e.preventDefault(); document.getElementById('btn-save-world').click(); }
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

    syncCreateButton(document.getElementById('btn-create-world'),
      this.deps.worldManager, CREATE_LABELS);
  }

  createSlotElement(world) {
    const wm = this.deps.worldManager;
    const slot = document.createElement('div');
    slot.className = 'world-slot' + (wm && wm.selectedId === world.id ? ' selected' : '');
    // `position: relative` used to be set here — same fix as `CharacterScreen.js`.
    // `.world-slot-actions` is `position: absolute`; the containing block is
    // `.world-slot`'s own CSS now (`src/ui/css/screens/slots.css`). PR 26.
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
    // Pre-fill a random seed so the field shows what will be used; the player can edit it.
    // D-62: clearing it is NOT "give me another random one" any more — a blank field is
    // refused by `submitCreate` with `BLANK_SEED_ERROR`, because the old behaviour made a
    // cleared field byte-indistinguishable from a chosen seed. Reopening the modal draws
    // a fresh one, which is the way to ask for a new random seed.
    document.getElementById('world-seed').value = randomSeed();
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

  // One line each: the shared helpers are null-guarded, which these two were not — an
  // absent `#world-error` threw a TypeError out of the save handler.

  showError(message) {
    setBanner(document.getElementById('world-error'), message);
  }

  hideError() {
    hideBanner(document.getElementById('world-error'));
  }
}
