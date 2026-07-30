/**
 * Cuubz — UIManager (PR 15)
 *
 * ─── WHAT THIS IS ───────────────────────────────────────────────────────────
 *
 * Screen routing and modal ownership, lifted out of `main.js` per `refactor.md` §8.2 and
 * §13. It owns the three DOM lookup tables `main.js` used to hold as module locals —
 * `screens`, `modals` and `sessionUI` — plus `showScreen()`, and it constructs and wires
 * the four screen objects.
 *
 * ─── THE `deps` OBJECT, AND WHY IT IS GETTERS ───────────────────────────────
 *
 * Every screen needs `characterManager`, `worldManager`, `perfSettings`, `sessionManager`
 * or `gameState`. All five are `let` bindings in `main.js` that are **null when the UI is
 * constructed** and assigned later inside `init()` and `startGame()`. Capturing them by
 * value at construction time would hand every screen a permanent `null`.
 *
 * So `main.js` passes an object of **live getters**. A screen reads `this.deps.worldManager`
 * at the moment it needs it and always sees the current binding. This is a deliberate,
 * temporary bridge and it is the smallest one available: the alternative is rewriting
 * ~110 references across `main.js` to go through a context object, in the same PR that
 * moves 700 lines of DOM code, and PR 17 and PR 19 delete those `let`s anyway when they
 * become fields on `Game` and `GameState`. **When they do, `deps` becomes the `Game`
 * instance and these getters go away.**
 *
 * ─── THE DELETE MODAL IS SHARED, AND THAT IS WHY ITS HANDLER LIVES HERE ─────
 *
 * `#delete-char-modal` is used for **both** character and world deletion. Its confirm
 * button dispatches on which of two `data-` attributes is set — `dataset.worldId` wins,
 * then `dataset.charId` — and each screen clears only its own key when it closes. Neither
 * `CharacterScreen` nor `WorldScreen` can own that handler without reaching into the
 * other, so `UIManager` owns it and calls into whichever screen the dataset names. The
 * coupling is in the HTML; this is the smallest place to keep it honest.
 */

export class UIManager {
  /**
   * @param {Object} deps — live getters: characterManager, worldManager, perfSettings,
   *   sessionManager, gameState; plus startGame(mode), rebuildAtlasAndMaterials(r, cm),
   *   updateRejoinPanel() and log(msg).
   */
  constructor(deps) {
    this.deps = deps;

    this.screens = {
      mainMenu: document.getElementById('main-menu'),
      characterScreen: document.getElementById('character-screen'),
      worldScreen: document.getElementById('world-screen'),
      modeScreen: document.getElementById('mode-screen'),
      settingsScreen: document.getElementById('settings-screen'),
      lobbyScreen: document.getElementById('lobby-screen'),
      loadingScreen: document.getElementById('loading-screen'),
    };

    // Modal elements (NOT in `screens` — they must NOT be hidden by showScreen)
    this.modals = {
      createCharModal: document.getElementById('create-char-modal'),
      deleteCharModal: document.getElementById('delete-char-modal'),
      createWorldModal: document.getElementById('create-world-modal'),
    };

    // Additional screen elements for session UI
    this.sessionUI = {
      connectionStatus: document.getElementById('connection-status'),
      connectionHud: document.getElementById('connection-hud'),
      playerListOverlay: document.getElementById('player-list-overlay'),
      playerCount: document.getElementById('player-count'),
      playerListItems: document.getElementById('player-list-items'),
      browsePanel: document.getElementById('browse-panel'),
      hostPanel: document.getElementById('host-panel'),
      sessionList: document.getElementById('session-list'),
      noSessionsMsg: document.getElementById('no-sessions-msg'),
    };

    // Screen objects, set by `registerScreens`.
    this.character = null;
    this.world = null;
    this.lobby = null;
    this.settings = null;
  }

  /** @param {{character, world, lobby, settings}} views */
  registerScreens(views) {
    this.character = views.character;
    this.world = views.world;
    this.lobby = views.lobby;
    this.settings = views.settings;
  }

  /**
   * Show one screen and hide the rest. Behaviour is unchanged from `main.js`'s
   * `showScreen`: an unknown name hides everything, which is what the loading sequence
   * relies on.
   */
  show(name) {
    Object.values(this.screens).forEach(el => {
      if (el) el.classList.add('hidden');
    });
    const target = this.screens[name];
    if (target) target.classList.remove('hidden');
  }

  /**
   * Wire the navigation that is not any one screen's: the main menu's four buttons, the
   * mode screen, the back buttons, and the shared delete modal.
   *
   * The whole body is inside one try/catch that logs and swallows, exactly as
   * `initMenuNavigation` was. That is not defensive decoration — every `getElementById`
   * below is unguarded, so a renamed id in `index.html` throws here, and PR 26 is the PR
   * that slims `index.html`. Losing the catch would turn a renamed button into a blank
   * page instead of a console error with the rest of the menu still working.
   */
  initNavigation() {
    try {
      this.deps.log('[Cuubz] UIManager.initNavigation');

      // ── Main menu ──────────────────────────────────────────────────────
      document.getElementById('btn-play-solo').addEventListener('click', () => {
        this.show('characterScreen');
        this.character.render();
      });

      document.getElementById('btn-host').addEventListener('click', () => {
        this.show('lobbyScreen');
        this.deps.updateRejoinPanel();
      });

      document.getElementById('btn-join').addEventListener('click', () => {
        this.show('lobbyScreen');
        this.deps.updateRejoinPanel();
      });

      document.getElementById('btn-settings').addEventListener('click', () => {
        this.show('settingsScreen');
      });

      // ── Back buttons ───────────────────────────────────────────────────
      document.getElementById('btn-back-char').addEventListener('click', () => this.show('mainMenu'));
      document.getElementById('btn-back-world').addEventListener('click', () => this.show('characterScreen'));
      document.getElementById('btn-back-mode').addEventListener('click', () => this.show('worldScreen'));
      document.getElementById('btn-back-settings').addEventListener('click', () => this.show('mainMenu'));
      document.getElementById('btn-back-lobby').addEventListener('click', () => this.show('mainMenu'));

      // ── Mode screen ────────────────────────────────────────────────────
      document.getElementById('btn-survival').addEventListener('click', () => {
        this.deps.log('[Cuubz] Mode: Survival');
        this.deps.startGame('survival');
      });

      document.getElementById('btn-creative').addEventListener('click', () => {
        this.deps.log('[Cuubz] Mode: Creative');
        this.deps.startGame('creative');
      });

      // ── The shared delete modal (see the header) ────────────────────────
      document.getElementById('btn-confirm-delete-char').addEventListener('click', async () => {
        const charId = this.modals.deleteCharModal.dataset.charId;
        const worldId = this.modals.deleteCharModal.dataset.worldId;
        if (worldId) {
          await this.world.confirmDelete(worldId);
        } else if (charId) {
          await this.character.confirmDelete(charId);
        }
      });

      document.getElementById('btn-cancel-delete-char').addEventListener('click', () => {
        if (this.modals.deleteCharModal.dataset.worldId) {
          this.world.closeDeleteModal();
        } else {
          this.character.closeDeleteModal();
        }
      });

      // ── Per-screen wiring ──────────────────────────────────────────────
      this.character.init();
      this.world.init();
      this.settings.init();
      this.lobby.init();

      this.deps.log('[Cuubz] UIManager.initNavigation complete');
    } catch (e) {
      console.error('[Cuubz] UIManager.initNavigation CRASHED:', e.message, '\n', e.stack);
    }
  }
}
