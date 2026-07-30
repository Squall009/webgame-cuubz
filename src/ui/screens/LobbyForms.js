/**
 * Cuubz — LobbyForms (PR 15)
 *
 * The lobby's three **inline create forms**: a character in the browse panel, and a
 * character and a world in the host panel. Split out of `LobbyScreen.js` in the same PR
 * that created it, for two reasons — `LobbyScreen` was 434 lines against §8.2's 400-line
 * accept criterion, and these three are a unit with a future of their own.
 *
 * ─── THEY ARE NEAR-DUPLICATES, AND THAT IS LOGGED, NOT FIXED HERE ───────────
 *
 * `_initBrowseCreateChar` and the character half of `_initHostForm` do the same job
 * against two sets of ids, and both duplicate what `CharacterScreen`'s modal does a third
 * time. Three call sites reach `characterManager.createCharacter` and render three
 * different error banners.
 *
 * **They are moved verbatim rather than unified**, because unifying them would change
 * behaviour: the inline forms do not check `canCreateMore()` before opening, where
 * `CharacterScreen` disables its button at the limit — so a player at three characters
 * gets a disabled button on the character screen and a "Maximum 3 characters reached"
 * banner in the lobby. Reconciling that is a UX decision, not an extraction. **BUGS.md
 * D-41**, owned by **PR 29**, which is the PR that builds the overlay components these
 * three collapse into.
 */

/** A random `#rrggbb`, zero-padded — `toString(16)` drops leading zeroes. */
export function randomHexColor() {
  return '#' + Math.floor(Math.random() * 0xFFFFFF).toString(16).padStart(6, '0');
}

/** Set and reveal one of the lobby's three inline error banners. */
export function setBanner(el, message) {
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
}

/**
 * Wire the browse panel's inline character-creation form.
 * @param {import('./LobbyScreen.js').LobbyScreen} lobby
 */
export function initBrowseCreateChar(lobby) {
  const deps = lobby.deps;
  const btnToggle = document.getElementById('btn-browse-create-char');
  const form = document.getElementById('browse-create-char-form');
  if (btnToggle && form) {
    btnToggle.addEventListener('click', () => {
      form.classList.toggle('hidden');
      if (!form.classList.contains('hidden')) {
        document.getElementById('browse-char-color').value = randomHexColor();
        document.getElementById('browse-char-name').value = '';
        document.getElementById('browse-char-name').focus();
      }
    });
  }

  const btnSave = document.getElementById('btn-browse-save-char');
  const errorEl = document.getElementById('browse-char-error');
  if (!btnSave) return;

  btnSave.addEventListener('click', async () => {
    const nameInput = document.getElementById('browse-char-name');
    const colorInput = document.getElementById('browse-char-color');
    const name = nameInput ? nameInput.value.trim() : '';
    const color = colorInput ? colorInput.value : '#4CAF50';

    if (!name) {
      setBanner(errorEl, 'Please enter a character name.');
      return;
    }

    const result = await deps.characterManager.createCharacter(name, color);
    if (result.success) {
      if (errorEl) errorEl.classList.add('hidden');
      form.classList.add('hidden');
      lobby.populateBrowseCharacterSelect();
      const select = document.getElementById('browse-character-select');
      if (select) select.value = result.character.id;
      deps.log(`[Cuubz] Character created in browse panel: ${result.character.name}`);
    } else {
      setBanner(errorEl, result.error);
    }
  });

  const nameInput = document.getElementById('browse-char-name');
  if (nameInput) {
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); btnSave.click(); }
      if (e.key === 'Escape') { form.classList.add('hidden'); }
    });
  }
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

  // ── Inline character creation ──
  const btnToggleChar = document.getElementById('btn-host-create-char');
  const charForm = document.getElementById('host-create-char-form');
  if (btnToggleChar && charForm) {
    btnToggleChar.addEventListener('click', () => {
      charForm.classList.toggle('hidden');
      if (!charForm.classList.contains('hidden')) {
        document.getElementById('host-char-color').value = randomHexColor();
        document.getElementById('host-char-name').value = '';
        document.getElementById('host-char-name').focus();
      }
    });
  }

  const btnSaveChar = document.getElementById('btn-host-save-char');
  const charError = document.getElementById('host-char-error');
  if (btnSaveChar) {
    btnSaveChar.addEventListener('click', async () => {
      const nameInput = document.getElementById('host-char-name');
      const colorInput = document.getElementById('host-char-color');
      const name = nameInput ? nameInput.value.trim() : '';
      const color = colorInput ? colorInput.value : '#4CAF50';

      if (!name) {
        setBanner(charError, 'Please enter a character name.');
        return;
      }

      const result = await deps.characterManager.createCharacter(name, color);
      if (result.success) {
        if (charError) charError.classList.add('hidden');
        charForm.classList.add('hidden');
        lobby.populateHostCharacterSelect();
        const select = document.getElementById('host-character-select');
        if (select) select.value = result.character.id;
        deps.log(`[Cuubz] Character created in host panel: ${result.character.name}`);
      } else {
        setBanner(charError, result.error);
      }
    });

    const charNameInput = document.getElementById('host-char-name');
    if (charNameInput) {
      charNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); btnSaveChar.click(); }
        if (e.key === 'Escape') { charForm.classList.add('hidden'); }
      });
    }
  }

  // ── Inline world creation ──
  const btnToggleWorld = document.getElementById('btn-host-create-world');
  const worldForm = document.getElementById('host-create-world-form');
  if (btnToggleWorld && worldForm) {
    btnToggleWorld.addEventListener('click', () => {
      worldForm.classList.toggle('hidden');
      if (!worldForm.classList.contains('hidden')) {
        document.getElementById('host-world-seed').value = String(Math.floor(Math.random() * 0xFFFFFFFF));
        document.getElementById('host-world-name').value = '';
        document.getElementById('host-world-name').focus();
      }
    });
  }

  const btnSaveWorld = document.getElementById('btn-host-save-world');
  const worldError = document.getElementById('host-world-error');
  if (btnSaveWorld) {
    btnSaveWorld.addEventListener('click', async () => {
      const nameInput = document.getElementById('host-world-name');
      const seedInput = document.getElementById('host-world-seed');
      const name = nameInput ? nameInput.value.trim() : '';
      const seedRaw = seedInput ? seedInput.value.trim() : '';

      if (!name) {
        setBanner(worldError, 'Please enter a world name.');
        return;
      }

      let seed = undefined;
      if (seedRaw !== '') {
        const parsed = parseInt(seedRaw, 10);
        if (!isNaN(parsed)) {
          seed = parsed;
        } else {
          setBanner(worldError, 'Seed must be a valid integer.');
          return;
        }
      }

      const result = await deps.worldManager.createWorld(name, seed);
      if (result.success) {
        if (worldError) worldError.classList.add('hidden');
        worldForm.classList.add('hidden');
        lobby.populateHostWorldSelect();
        const select = document.getElementById('host-world-select');
        if (select) select.value = result.world.id;
        deps.log(`[Cuubz] World created in host panel: ${result.world.name}`);
      } else {
        setBanner(worldError, result.error);
      }
    });

    const worldNameInput = document.getElementById('host-world-name');
    if (worldNameInput) {
      worldNameInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); btnSaveWorld.click(); }
        if (e.key === 'Escape') { worldForm.classList.add('hidden'); }
      });
    }
  }
}
