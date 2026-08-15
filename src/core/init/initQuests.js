/**
 * Cuubz — init step 15: quests (S1)
 *
 * Builds the quest system, its tracker, the HUD writer and the quest log, and wires the
 * `J` key. Runs after `initInventory` (13) and `initHud` (14) because the tracker polls
 * `state.inventory` and the HUD writer needs the template mounted.
 *
 * ─── WHERE THE STATE COMES FROM, AND WHOSE IT IS ────────────────────────────
 *
 * Single-player and host: the selected world's `questState`, held **by reference** so
 * that `saveWorldState` serializes whatever the system has been mutating. A joining
 * client gets a fresh empty state that the host immediately overwrites with `QUEST_SYNC`
 * — §5.2, a guest holds a view and not a copy, and their device must not accumulate
 * half-finished copies of other people's worlds.
 *
 * ─── EVERY LISTENER IS TORN DOWN ────────────────────────────────────────────
 *
 * D-50: eight listeners were added on every `startGame()` and nothing removed them, so a
 * player who exited to the menu and started again carried a second set closing over the
 * *previous* `GameState`. The `keydown` here goes through `state.addTeardown` with the
 * same function reference it was added with — an inline arrow removes nothing.
 */

import { QuestSystem } from '../../game/systems/QuestSystem.js';
import { QuestTracker } from '../../game/systems/QuestTracker.js';
import { QuestTrackerHUD } from '../../ui/hud/QuestTracker.js';
import { QuestLog } from '../../ui/overlays/QuestLog.js';
import { createQuestState } from '../../game/data/QuestState.js';
import { CuubzLogger } from '../../util/Logger.js';

const _gameLog = CuubzLogger.log;

/**
 * @param {import('../Game.js').Game} game
 */
export function initQuests(game) {
  const state = game.state;
  const deps = game.deps;
  const log = deps.log || _gameLog;

  // A joining client is not the authority for anything (§5.2). `isJoiningClient` is
  // computed at step 7 and is the same flag the chunk and inventory paths branch on.
  const isGuest = !!game.isJoiningClient;

  const world = state.currentWorld;
  const questState = isGuest || !world
    ? createQuestState()
    : (world.questState = world.questState || createQuestState());

  const questSystem = new QuestSystem({
    questState,
    authoritative: !isGuest,
    inventory: state.inventory,
  });
  state.questSystem = questSystem;

  // The contributor id is the **character** id, not the relay's per-connection
  // `playerId` — D-117, and §4.5's reason: a reconnecting player must find their own
  // high-water mark rather than a fresh zero.
  const character = state.currentCharacter;
  const contributorId = character ? character.id : null;

  const tracker = new QuestTracker({
    questSystem,
    inventory: state.inventory,
    contributorId,
    // Single-player has no transport, so the tracker applies its own deltas. S2 sets
    // this on a guest. One code path, two destinations (§6.4).
    sendContribution: null,
  });
  state.questTracker = tracker;

  const hud = new QuestTrackerHUD();
  state.questTrackerHUD = hud;

  const questLog = new QuestLog({ questSystem });
  state.questLog = questLog;

  // ─── Callbacks: HUD, saves, and the end of the game ───────────
  //
  // §5.1 names three events as expensive to lose and worth an immediate write: a quest
  // completed, a seal state changed, a boss defeated. All three are rare, so the save
  // costs nothing and the alternative is losing a boss kill to a crash.
  questSystem.onQuestCompleted = (questId, def) => {
    log(`[Cuubz] Quest complete: ${questId} — ${def.title}`);
    hud.flashComplete();
    hud.render(questSystem.getTrackerView());
    if (questLog.isOpen) questLog.render();
    game.saveWorldState();
  };

  questSystem.onQuestStarted = (questId, def) => {
    log(`[Cuubz] Quest started: ${questId} — ${def.title}`);
    hud.render(questSystem.getTrackerView());
  };

  questSystem.onObjectiveProgress = () => {
    hud.render(questSystem.getTrackerView());
  };

  questSystem.onTitleGranted = (titleId, def) => {
    log(`[Cuubz] Title earned: ${def ? def.name : titleId}`);
  };

  questSystem.onGameComplete = () => {
    log('[Cuubz] The world is remade. Game complete.');
    game.saveWorldState();
  };

  // ─── The J key ────────────────────────────────────────────────
  const onQuestLogKey = (e) => {
    if (e.key !== 'j' && e.key !== 'J') return;
    // Not while another overlay owns the screen. The inventory and the pause menu both
    // take pointer lock and keyboard focus, and stacking a third panel over either is
    // how a player ends up with no way back to the game.
    if (state.inventoryOpen) return;
    if (game.paused) return;
    questLog.toggle();
  };
  document.addEventListener('keydown', onQuestLogKey);
  state.addTeardown(() => document.removeEventListener('keydown', onQuestLogKey));
  state.addTeardown(() => questLog.dispose());

  // First paint. Everything after this is driven by `questStep`.
  hud.render(questSystem.getTrackerView());

  log('[Cuubz] Quest system ready');
}
