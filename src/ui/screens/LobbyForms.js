/**
 * Cuubz — LobbyForms (PR 15; unified in PR 26)
 *
 * The lobby's three **inline create forms**: a character in the browse panel, and a
 * character and a world in the host panel. Split out of `LobbyScreen.js` in the same PR
 * that created it, because `LobbyScreen` was 434 lines against §8.2's 400-line accept
 * criterion and these three are a unit.
 *
 * ─── D-41 IS CLOSED HERE (PR 26) ────────────────────────────────────────────
 *
 * This file's original header said the three forms were "moved verbatim rather than
 * unified", because unifying them would change behaviour: they did not check
 * `canCreateMore()` before opening, where `CharacterScreen` disabled its button at the
 * limit, so a player at three characters got a disabled button on one screen and a
 * "Maximum 3 characters reached" banner on another. The shared implementation is
 * `src/ui/forms/createEntity.js`; read that file's header for the full list of what
 * diverged and which side each divergence was resolved to.
 *
 * The lobby's three toggles are **decision 59**, not decision 55: they stay enabled and
 * answer a click at the limit with the manager's own banner. Decision 55's greyed-out
 * button governs the two modal create buttons only. See `initInlineCreateForm` below.
 *
 * `setBanner` and `randomHexColor` moved there too and are re-exported below, because
 * they were this file's exports first and `createEntity.js` is where the screens can also
 * reach them.
 */

import { CHARACTER_LIMIT_MESSAGE } from '../../game/entities/CharacterManager.js';
import { WORLD_LIMIT_MESSAGE } from '../../game/entities/WorldManager.js';
import {
  canOpen, hideBanner, randomHexColor, randomSeed, setBanner, submitCreate,
} from '../forms/createEntity.js';

export { randomHexColor, setBanner };

/**
 * Wire one inline create form: a `+ New` toggle, a save button and an Enter/Escape
 * keydown on the name field. The three forms differ only in their ids, their noun and
 * what they do on success.
 *
 * @param {object} cfg
 * @param {string} cfg.toggleId  @param {string} cfg.formId    @param {string} cfg.nameId
 * @param {string} cfg.extraId   @param {string} cfg.saveId    @param {string} cfg.errorId
 * @param {'character'|'world'} cfg.noun
 * @param {string} cfg.limitMessage — the manager's own over-limit string, shown when the
 *   toggle refuses to open. Not built here: one source, so it cannot drift from what
 *   `submitCreate` would render on save.
 * @param {function():object} cfg.manager — a thunk, not the manager itself: it is read
 *   through `uiDeps`'s live getter (decision 27) on every click rather than captured once
 *   at wiring time. (Both managers are in fact already constructed when this runs —
 *   `Bootstrap.js` calls `initMenuNavigation()` at `:322`, after `:301`/`:306`.)
 * @param {function():string} cfg.prefill — what to put in the second field on open.
 * @param {function(object):void} cfg.onSuccess
 */
function initInlineCreateForm(cfg) {
  const form = document.getElementById(cfg.formId);
  const btnToggle = document.getElementById(cfg.toggleId);
  const btnSave = document.getElementById(cfg.saveId);
  const errorEl = document.getElementById(cfg.errorId);
  if (!form) return;

  if (btnToggle) {
    // **Decision 59 — this toggle is never `disabled`.** `syncCreateButton` (decision 55)
    // is for the two *modal* create buttons, which have no open state and sit beside a
    // slot-count label. A toggle is different: a `disabled` <button> dispatches no `click`,
    // so disabling one at the limit makes its own close branch unreachable — a form that
    // was open when the last slot filled could then only be dismissed with Escape.
    btnToggle.addEventListener('click', () => {
      // Closing is unconditional: no capacity check stands between an open form and its
      // dismissal, and no re-sync can take the close away.
      if (!form.classList.contains('hidden')) { form.classList.add('hidden'); return; }
      // At the limit, opening is refused and the manager's own message is rendered into
      // this form's banner — the same string `submitCreate` shows on save, so a click is
      // never silent. D-41: the toggle used to open unconditionally and only the save
      // button ever reported the limit.
      if (!canOpen(cfg.manager())) { setBanner(errorEl, cfg.limitMessage); return; }
      form.classList.remove('hidden');
      const extraInput = document.getElementById(cfg.extraId);
      const nameInput = document.getElementById(cfg.nameId);
      if (extraInput) extraInput.value = cfg.prefill();
      if (nameInput) { nameInput.value = ''; nameInput.focus(); }
      hideBanner(errorEl);
    });
  }

  if (!btnSave) return;

  btnSave.addEventListener('click', async () => {
    const nameInput = document.getElementById(cfg.nameId);
    const extraInput = document.getElementById(cfg.extraId);
    await submitCreate({
      manager: cfg.manager(),
      noun: cfg.noun,
      name: nameInput ? nameInput.value.trim() : '',
      extra: extraInput ? extraInput.value.trim() : '',
      errorEl,
      onSuccess: (result) => {
        form.classList.add('hidden');
        cfg.onSuccess(result);
      },
    });
  });

  const nameInput = document.getElementById(cfg.nameId);
  if (nameInput) {
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); btnSave.click(); }
      if (e.key === 'Escape') { form.classList.add('hidden'); }
    });
  }
}

/**
 * Wire the browse panel's inline character-creation form.
 * @param {import('./LobbyScreen.js').LobbyScreen} lobby
 */
export function initBrowseCreateChar(lobby) {
  const deps = lobby.deps;
  initInlineCreateForm({
    toggleId: 'btn-browse-create-char', formId: 'browse-create-char-form',
    nameId: 'browse-char-name', extraId: 'browse-char-color',
    saveId: 'btn-browse-save-char', errorId: 'browse-char-error',
    noun: 'character', limitMessage: CHARACTER_LIMIT_MESSAGE,
    manager: () => deps.characterManager,
    prefill: randomHexColor,
    onSuccess: (result) => {
      lobby.populateBrowseCharacterSelect();
      const select = document.getElementById('browse-character-select');
      if (select) select.value = result.character.id;
      deps.log(`[Cuubz] Character created in browse panel: ${result.character.name}`);
    },
  });
}

/**
 * Wire the host panel: the max-players slider and its two inline create forms.
 * @param {import('./LobbyScreen.js').LobbyScreen} lobby
 */
export function initHostForm(lobby) {
  const deps = lobby.deps;

  const maxPlayers = document.getElementById('host-max-players');
  const maxPlayersValue = document.getElementById('host-max-players-value');
  if (maxPlayers && maxPlayersValue) {
    maxPlayers.addEventListener('input', () => {
      maxPlayersValue.textContent = maxPlayers.value;
    });
  }

  initInlineCreateForm({
    toggleId: 'btn-host-create-char', formId: 'host-create-char-form',
    nameId: 'host-char-name', extraId: 'host-char-color',
    saveId: 'btn-host-save-char', errorId: 'host-char-error',
    noun: 'character', limitMessage: CHARACTER_LIMIT_MESSAGE,
    manager: () => deps.characterManager,
    prefill: randomHexColor,
    onSuccess: (result) => {
      lobby.populateHostCharacterSelect();
      const select = document.getElementById('host-character-select');
      if (select) select.value = result.character.id;
      deps.log(`[Cuubz] Character created in host panel: ${result.character.name}`);
    },
  });

  initInlineCreateForm({
    toggleId: 'btn-host-create-world', formId: 'host-create-world-form',
    nameId: 'host-world-name', extraId: 'host-world-seed',
    saveId: 'btn-host-save-world', errorId: 'host-world-error',
    noun: 'world', limitMessage: WORLD_LIMIT_MESSAGE,
    manager: () => deps.worldManager,
    prefill: randomSeed,
    onSuccess: (result) => {
      lobby.populateHostWorldSelect();
      const select = document.getElementById('host-world-select');
      if (select) select.value = result.world.id;
      deps.log(`[Cuubz] World created in host panel: ${result.world.name}`);
    },
  });
}
