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
import { SealSystem } from '../../game/systems/SealSystem.js';
import { QuestSync } from '../../multiplayer/QuestSync.js';
import { BiomeSystem } from '../../engine/world/BiomeSystem.js';
import { createQuestState } from '../../game/data/QuestState.js';
import { CuubzLogger } from '../../util/Logger.js';

const _gameLog = CuubzLogger.log;

/** The `{ sealId: {x,z,y?} }` map worldgen stamps from. Frozen sites only. */
function collectSites(questState) {
  const out = {};
  for (const [id, seal] of Object.entries(questState.seals)) {
    if (seal.site) out[id] = seal.site;
  }
  if (questState.finale.site) out.finale = questState.finale.site;
  return out;
}

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
    // Single-player has no transport, so the tracker applies its own deltas directly.
    // In a session `questSync.getTransport()` replaces this — see below.
    sendContribution: null,
  });
  state.questTracker = tracker;

  const hud = new QuestTrackerHUD();
  state.questTrackerHUD = hud;

  const questLog = new QuestLog({ questSystem });
  state.questLog = questLog;

  // ─── Multiplayer (S2) ─────────────────────────────────────────
  //
  // `sm && sm.client` is the same guard every other sync path uses; single-player has
  // no session and skips all of it.
  const sm = deps.sessionManager;
  if (sm && sm.client) {
    // `SessionManager` keeps its `HostManager` at `_hostManager` (`SessionHosting.js`
    // creates it), and null on a guest — which is exactly the branch this needs.
    const host = sm._hostManager || null;

    const questSync = new QuestSync({
      questSystem,
      client: sm.client,
      host,
      contributorId,
    });
    state.questSync = questSync;
    questSync.attach();

    // §6.4 — the host's own gathering goes through the host's handler, not straight
    // into `QuestSystem`. `getTransport()` picks the right end; the tracker cannot tell
    // the difference and does not need to.
    tracker.setTransport(questSync.getTransport());

    // One quest state on a host, not two. Without this the host's pooling would write
    // `HostManager._worldState.questState` while the host player's own quest log read
    // the world's — §2.1's original defect, re-created.
    if (host && typeof host.setQuestSystem === 'function') {
      host.setQuestSystem(questSystem);
    }

    questSync.onStateChanged = () => {
      hud.render(questSystem.getTrackerView());
      if (questLog.isOpen) questLog.render();
    };

    state.addTeardown(() => questSync.dispose());
  }

  // ─── Seals (S5) ───────────────────────────────────────────────
  //
  // Sites are resolved from the world seed on first entry and then frozen (§7.1). A
  // guest resolves nothing: the host's sites arrive in `QUEST_SYNC`, and two devices
  // computing "the same" site from "the same" seed is exactly the kind of agreement
  // that holds until one of them updates.
  const sealSystem = new SealSystem({
    questSystem,
    inventory: state.inventory,
    authoritative: !isGuest,
    host: state.questSync ? state.questSync._host : null,
  });
  state.sealSystem = sealSystem;

  if (!isGuest && state.chunkManager) {
    const seed = state.chunkManager.worldSeed;
    const version = state.chunkManager.genParams?.worldgenVersion || 1;
    if (version >= 2) {
      const biomeAt = (wx, wz) => BiomeSystem.getBiomeAtWorldPos(wx, wz, seed, version).id;
      const written = sealSystem.resolveSites(seed, biomeAt);
      if (written > 0) {
        log(`[Cuubz] Resolved ${written} seal site(s)`);
        game.saveWorldState();
      }
      // Worldgen needs the sites to stamp altars and arenas. They go in `genParams`,
      // which `ChunkGenerator` forwards to the worker verbatim — and they are set here
      // rather than in `initWorld` because the sites do not exist until the quest state
      // has been loaded, which is two steps later.
      state.chunkManager.genParams.sealSites = collectSites(questSystem.getState());
    } else {
      // A v1 world has no Corrupt or Lava biome to put the first two seals in, so it
      // gets no seal structures either. §3.1: existing saves are untouched, and the
      // upgrade is the player's choice from the world screen.
      log('[Cuubz] World is at worldgen version 1 — no seal sites');
    }
  }

  sealSystem.onSealStateChanged = (sealId, sealState) => {
    log(`[Cuubz] Seal ${sealId} → ${sealState}`);
    // §5.1 — a seal transition is one of the three events expensive enough to lose that
    // it earns an immediate write.
    game.saveWorldState();
    hud.render(questSystem.getTrackerView());
  };

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

  // ─── The R key: make an offering at an altar ──────────────────
  //
  // `R` because everything else is taken: WASD, Space and Shift are movement, `E` is the
  // inventory, `F` is fly, `J` is the quest log, and the digits are the hotbar.
  //
  // The offering is the one player action in the whole seal system, and it is
  // deliberately explicit rather than automatic — walking into an altar carrying the
  // right items should not consume them.
  const onAltarKey = (e) => {
    if (e.key !== 'r' && e.key !== 'R') return;
    if (state.inventoryOpen || game.paused) return;
    const sealId = sealSystem.altarInRange;
    if (!sealId) return;

    const result = sealSystem.makeOffering(sealId);
    if (result.ok) {
      log(`[Cuubz] Offering made at the ${sealId} seal`);
    } else {
      log(`[Cuubz] ${result.reason}`);
    }
  };
  document.addEventListener('keydown', onAltarKey);
  state.addTeardown(() => document.removeEventListener('keydown', onAltarKey));

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
