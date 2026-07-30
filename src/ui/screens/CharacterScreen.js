/**
 * Cuubz — CharacterScreen (PR 15)
 *
 * `refactor.md` §8.2: `renderCharacterSlots`, `createCharacterSlotElement`,
 * `openCreateModal`, `openEditModal`, `closeCharModal` and the character half of
 * `initMenuNavigation`, moved out of `main.js`.
 *
 * `editingCharId` was a module-level `let` in `main.js` that only these five functions
 * read; it is `this.editingId` now, which is the whole argument for the class — the
 * create and edit modals are the *same* modal in `index.html` and that field is the only
 * thing that distinguishes them.
 *
 * The delete modal is **shared with `WorldScreen`** and its confirm/cancel handler lives
 * in `UIManager`; see that file's header. This screen exposes `openDeleteModal`,
 * `closeDeleteModal` and `confirmDelete` for it to call.
 */

import { DEFAULT_COLOR, MAX_CHARACTERS } from '../../game/entities/CharacterManager.js';
import { escapeHtml } from '../../util/HTMLUtils.js';

export class CharacterScreen {
  /**
   * @param {import('../UIManager.js').UIManager} ui
   */
  constructor(ui) {
    this.ui = ui;
    this.deps = ui.deps;
    /** Set while the shared create/edit modal is in edit mode; null while creating. */
    this.editingId = null;
  }

  /** Wire this screen's controls. Called once, from `UIManager.initNavigation`. */
  init() {
    document.getElementById('btn-create-char').addEventListener('click', () => {
      const cm = this.deps.characterManager;
      if (cm && !cm.canCreateMore()) return;
      this.openCreateModal();
    });

    // The create/edit modal's save button serves both modes — `editingId` is the switch.
    document.getElementById('btn-save-char').addEventListener('click', async () => {
      const name = document.getElementById('char-name').value.trim();
      const color = document.getElementById('char-color').value;

      if (!name) { this.showError('Please enter a character name.'); return; }

      const cm = this.deps.characterManager;
      const editing = this.editingId;
      const result = editing
        ? await cm.updateCharacter(editing, { name, color })
        : await cm.createCharacter(name, color);

      if (result.success) {
        this.closeModal();
        this.render();
        this.deps.log(`[Cuubz] Character ${editing ? 'updated' : 'created'}: ${result.character.name}`);
      } else {
        this.showError(result.error);
      }
    });

    document.getElementById('btn-cancel-char').addEventListener('click', () => this.closeModal());

    document.getElementById('char-name').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        document.getElementById('btn-save-char').click();
      }
      if (e.key === 'Escape') {
        this.closeModal();
      }
    });
  }

  // ── Slot rendering ────────────────────────────────────────────────────

  render() {
    const container = document.getElementById('character-slots');
    const slotInfo = document.getElementById('char-slot-info');
    if (!container) return;

    container.innerHTML = '';

    const cm = this.deps.characterManager;
    const characters = cm ? cm.getAllCharacters() : [];
    characters.forEach(char => container.appendChild(this.createSlotElement(char)));

    // Empty slots
    for (let i = characters.length; i < MAX_CHARACTERS; i++) {
      const emptySlot = document.createElement('div');
      emptySlot.className = 'char-slot empty';
      emptySlot.innerHTML = '<span style="font-size:28px;color:#555;">+</span><span class="char-name">Empty</span>';
      container.appendChild(emptySlot);
    }

    if (slotInfo) {
      const remaining = MAX_CHARACTERS - characters.length;
      slotInfo.textContent = `${characters.length}/${MAX_CHARACTERS} characters (${remaining} slots available)`;
    }

    const createBtn = document.getElementById('btn-create-char');
    if (createBtn) {
      if (cm && !cm.canCreateMore()) {
        createBtn.disabled = true;
        createBtn.textContent = 'Slots Full';
        createBtn.style.opacity = '0.5';
      } else {
        createBtn.disabled = false;
        createBtn.textContent = 'Create Character';
        createBtn.style.opacity = '1';
      }
    }
  }

  createSlotElement(char) {
    const cm = this.deps.characterManager;
    const slot = document.createElement('div');
    slot.className = 'char-slot' + (cm && cm.selectedId === char.id ? ' selected' : '');
    slot.style.position = 'relative';
    slot.dataset.charId = char.id;

    slot.innerHTML = `
      <div class="char-avatar" style="background:${char.color};"></div>
      <span class="char-name">${escapeHtml(char.name)}</span>
      <div class="char-slot-actions">
        <button class="char-slot-action-btn edit" title="Edit character" data-action="edit">✎</button>
        <button class="char-slot-action-btn delete" title="Delete character" data-action="delete">✕</button>
      </div>
    `;

    // Click to select → world screen. The action buttons sit inside the slot, so the
    // `closest` guard is what keeps edit/delete from also selecting the character.
    slot.addEventListener('click', async (e) => {
      if (e.target.closest('.char-slot-action-btn')) return;
      const mgr = this.deps.characterManager;
      if (mgr) {
        await mgr.selectCharacter(char.id);
        this.render();
        this.ui.show('worldScreen');
        this.ui.world.render();
      }
    });

    slot.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.openEditModal(char);
    });

    slot.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
      e.stopPropagation();
      this.openDeleteModal(char);
    });

    return slot;
  }

  // ── Create / edit modal ───────────────────────────────────────────────

  openCreateModal() {
    this.editingId = null;
    document.getElementById('char-modal-title').textContent = 'Create New Character';
    document.getElementById('btn-save-char').textContent = 'Create';
    document.getElementById('char-name').value = '';
    document.getElementById('char-color').value = DEFAULT_COLOR;
    this.hideError();
    this.ui.modals.createCharModal.classList.remove('hidden');
    setTimeout(() => document.getElementById('char-name').focus(), 100);
  }

  openEditModal(char) {
    this.editingId = char.id;
    document.getElementById('char-modal-title').textContent = 'Edit Character';
    document.getElementById('btn-save-char').textContent = 'Save';
    document.getElementById('char-name').value = char.name;
    document.getElementById('char-color').value = char.color;
    this.hideError();
    this.ui.modals.createCharModal.classList.remove('hidden');
    setTimeout(() => {
      const nameInput = document.getElementById('char-name');
      nameInput.focus();
      nameInput.select();
    }, 100);
  }

  closeModal() {
    if (this.ui.modals.createCharModal) {
      this.ui.modals.createCharModal.classList.add('hidden');
    }
    this.editingId = null;
  }

  // ── Delete modal (shared element, dispatched by UIManager) ────────────

  openDeleteModal(char) {
    document.getElementById('delete-char-name').textContent = `"${char.name}"`;
    this.ui.modals.deleteCharModal.dataset.charId = char.id;
    this.ui.modals.deleteCharModal.classList.remove('hidden');
  }

  closeDeleteModal() {
    this.ui.modals.deleteCharModal.classList.add('hidden');
    delete this.ui.modals.deleteCharModal.dataset.charId;
  }

  async confirmDelete(charId) {
    const result = await this.deps.characterManager.deleteCharacter(charId);
    if (result.success) {
      this.closeDeleteModal();
      this.render();
      this.deps.log(`[Cuubz] Character deleted: ${charId}`);
    } else {
      alert(result.error);
    }
  }

  // ── Error banner ──────────────────────────────────────────────────────

  showError(message) {
    const errorEl = document.getElementById('char-error');
    errorEl.textContent = message;
    errorEl.classList.remove('hidden');
  }

  hideError() {
    document.getElementById('char-error').classList.add('hidden');
  }
}
