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
 *
 * **D-41, PR 26:** the capacity check, the `disabled`/`'Slots Full'` block and the error
 * banner are `src/ui/forms/createEntity.js` now — shared with `WorldScreen` and the
 * lobby's three inline forms. Two things changed here as a result: `canOpen(null)` is
 * `false`, so a null `characterManager` no longer *opens* the modal (this file's guard was
 * `if (cm && !cm.canCreateMore())`, the opposite polarity to `WorldScreen`'s), and
 * `showError` is null-guarded, which it was not.
 */

import { MAX_CHARACTERS } from '../../game/entities/CharacterManager.js';
import { escapeHtml } from '../../util/HTMLUtils.js';
import {
  canOpen, hideBanner, randomHexColor, setBanner, submitCreate, syncCreateButton,
} from '../forms/createEntity.js';

/** The create button's two labels. `WorldScreen` has the same pair for its own noun. */
const CREATE_LABELS = { idle: 'Create Character', full: 'Slots Full' };

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
      if (!canOpen(this.deps.characterManager)) return;
      this.openCreateModal();
    });

    // The create/edit modal's save button serves both modes — `editingId` is the switch.
    // Edit goes through `submitCreate`'s `submit` override so that update shares the
    // empty-name message and the banner rather than growing a second copy of each.
    document.getElementById('btn-save-char').addEventListener('click', async () => {
      const name = document.getElementById('char-name').value.trim();
      const color = document.getElementById('char-color').value;
      const cm = this.deps.characterManager;
      const editing = this.editingId;

      await submitCreate({
        manager: cm,
        noun: 'character',
        name,
        extra: color,
        errorEl: document.getElementById('char-error'),
        submit: editing ? () => cm.updateCharacter(editing, { name, color }) : undefined,
        onSuccess: (result) => {
          this.closeModal();
          this.render();
          this.deps.log(`[Cuubz] Character ${editing ? 'updated' : 'created'}: ${result.character.name}`);
        },
      });
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

    syncCreateButton(document.getElementById('btn-create-char'), cm, CREATE_LABELS);
  }

  createSlotElement(char) {
    const cm = this.deps.characterManager;
    const slot = document.createElement('div');
    slot.className = 'char-slot' + (cm && cm.selectedId === char.id ? ' selected' : '');
    // `position: relative` used to be set here. It is `.char-slot`'s own CSS now
    // (`src/ui/css/screens/slots.css`) — `.char-slot-actions` is `position: absolute` and
    // was resolving its containing block against a property this renderer happened to
    // set. PR 26.
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
    // D-41: this was a fixed `DEFAULT_COLOR`, so every character created from this modal
    // came out the same green. The lobby's two inline forms already prefilled a random
    // colour; two of three wins, and three identical avatars in three slots was the worse
    // of the two behaviours. `DEFAULT_COLOR` survives as `submitCreate`'s fallback for
    // when the input is missing entirely.
    document.getElementById('char-color').value = randomHexColor();
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

  // One line each: the shared helpers are null-guarded, which these two were not — an
  // absent `#char-error` threw a TypeError out of the save handler.

  showError(message) {
    setBanner(document.getElementById('char-error'), message);
  }

  hideError() {
    hideBanner(document.getElementById('char-error'));
  }
}
