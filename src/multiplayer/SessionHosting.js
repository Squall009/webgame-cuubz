import { HostManager } from './Host.js';

/**
 * Cuubz — starting a hosted session from the lobby form (PR 16, refactor.md §8.3)
 *
 * Split out of `SessionManager.js` so that file stays under the 400-line ceiling §8.2 and
 * §8.6 set, and because there is a real seam here: this is the **only** part of the
 * session layer that reads `index.html` form controls. Everything in `SessionManager` is
 * driven by the relay or by a caller; this is driven by five `getElementById`s, which is
 * what makes it the piece PR 26 will have to revisit when it rewrites the markup.
 *
 * The dependency runs one way — `SessionManager` imports this, this imports nothing from
 * `SessionManager` and takes the manager as an argument. `BUGS.md` D-26 is what an import
 * cycle costs under real ES modules.
 */

/**
 * Validate the host form, select the character and world it names, create the session on
 * the relay, and start the game.
 *
 * @param {import('./SessionManager.js').SessionManager} manager
 */
export async function startHosting(manager) {
  const deps = manager.deps;
  const nameInput = document.getElementById('host-session-name');
  const worldSelect = document.getElementById('host-world-select');
  const characterSelect = document.getElementById('host-character-select');
  const modeSelect = document.getElementById('host-mode-select');
  const maxPlayersSlider = document.getElementById('host-max-players');

  manager._hideHostError();

  const name = nameInput ? nameInput.value.trim() : '';
  if (!name) {
    manager._showHostError('Please enter a session name.');
    return;
  }
  if (name.length > 32) {
    manager._showHostError('Session name must be 32 characters or less.');
    return;
  }

  const characterId = characterSelect ? characterSelect.value : '';
  if (!characterId) {
    manager._showHostError('Please select or create a character to play as.');
    return;
  }
  const characterManager = deps.characterManager;
  const selectedCharacter = characterManager ? characterManager.getCharacter(characterId) : null;
  if (!selectedCharacter) {
    manager._showHostError('Selected character not found.');
    return;
  }

  const worldId = worldSelect ? worldSelect.value : '';
  if (!worldId) {
    manager._showHostError('Please select or create a world to host.');
    return;
  }
  const worldManager = deps.worldManager;
  const selectedWorld = worldManager ? worldManager.getWorld(worldId) : null;
  if (!selectedWorld) {
    manager._showHostError('Selected world not found.');
    return;
  }

  // Wire up character and world selection so startGame() finds them. This is critical:
  // startGame() reads getSelectedCharacter() / getSelectedWorld(), which rely on selectedId.
  await characterManager.selectCharacter(characterId);
  await worldManager.selectWorld(worldId);
  deps.log(`[SessionManager] Selected character: ${selectedCharacter.name}, world: ${selectedWorld.name}`);

  const mode = modeSelect ? modeSelect.value : 'survival';
  const maxPlayers = parseInt(maxPlayersSlider ? maxPlayersSlider.value : '4', 10);

  // Record what the session IS, before anything can go wrong and before the form can be
  // edited out from under the rejoin record. D-43: the handler that used to win read
  // `#host-mode-select` at unload time rather than at host time.
  manager._gameMode = mode;
  manager._sessionName = name;
  manager._sessionSeed = selectedWorld.seed;

  manager.updateConnectionStatus('connecting');

  if (manager.client) {
    try {
      await manager.client.hostSession({ name, seed: selectedWorld.seed, mode, maxPlayers });
      deps.log(`[SessionManager] Hosting session: ${name}`);
    } catch (err) {
      manager.updateConnectionStatus('disconnected');
      manager._showHostError(`Failed to host: ${err.message}`);
      return;
    }
  } else {
    // Offline simulation
    manager.hostingSessionId = `session_${Date.now()}`;
    manager.updateConnectionStatus('connected');
    deps.log(`[SessionManager] Simulated hosting: ${name} (offline)`);
  }

  deps.log(`[SessionManager] Starting game in ${mode} mode (hosting)`);
  deps.startGame(mode);

  // HostManager validates remote player actions (movement, blocks, inventory). It is
  // wired in startGame() once the chunk manager is ready.
  if (manager.client) {
    manager._hostManager = new HostManager({ client: manager.client });
    manager._hostManager.onPlayerJoined = (data) => {
      deps.log(`[HostManager] Player joined: ${data.playerId} (${data.character?.name})`);
    };
    manager._hostManager.onPlayerLeft = (data) => {
      deps.log(`[HostManager] Player left: ${data.playerId}`);
    };
    deps.log('[SessionManager] HostManager initialized for server-authoritative validation');
  }

  // The block-validation callbacks are NOT wired here. `startHosting` used to take an
  // `options` argument and register BLOCK_BREAK / BLOCK_PLACE from it, duplicating
  // `SessionManager.registerHostCallbacks()`, which `startGame()` calls for the same two
  // events. The only caller — `LobbyScreen`'s start-hosting button — passes no arguments,
  // so that half was dead; and had it ever been used, both registrations would have fired
  // and every remote block edit would have been handled twice. `BUGS.md` **D-44**.
}
