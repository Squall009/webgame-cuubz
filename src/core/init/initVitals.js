/**
 * Cuubz — init step 15a: the player can be hurt (S3)
 *
 * Builds `PlayerVitals`, wires the health meter, connects mob attacks to it, owns the
 * respawn, and — since S10 — builds the `EatingSystem` and hands `BlockInteraction` the
 * `onUseItem` callback that turns a right-click on food into a heal (D-123).
 *
 * ─── IT RUNS BEFORE `initQuests`, AND AFTER `initInventory` ─────────────────
 *
 * After 13 because armour reduction reads `inventory.getEquipmentStats()`. Before the
 * quest step because `HazardSystem` (S4) and `BossEncounter` (S6) both take vitals in
 * their constructors, and `questStep` ticks all three.
 *
 * ─── THE MOB ATTACK PATH WAS WRITTEN AND UNREACHABLE ────────────────────────
 *
 * `mobIntegration.js` has installed `onMobAttack` — armour reduction and all — behind
 * `if (survivalSystem)` since the survival system was deleted, and `initMobs.js` passed
 * `null`. The code was right; it had no receiver. This step supplies one, and the
 * armour arithmetic moved into `PlayerVitals.applyArmor` so that a mob's bite, a lava
 * pool and a boss's slam all reduce the same way.
 */

import { PlayerVitals } from '../../game/entities/PlayerVitals.js';
import { HazardSystem } from '../../game/systems/HazardSystem.js';
import { EatingSystem } from '../../game/systems/EatingSystem.js';
import { HealthMeter } from '../../ui/hud/HealthMeter.js';
import { DAMAGE_SOURCES } from '../../game/data/DamageSources.js';
import { CuubzLogger } from '../../util/Logger.js';

const _gameLog = CuubzLogger.log;

/** How long the player lies dead before respawning, in seconds. */
export const RESPAWN_DELAY_SECONDS = 2;

/**
 * @param {import('../Game.js').Game} game
 */
export function initVitals(game) {
  const state = game.state;
  const deps = game.deps;
  const log = deps.log || _gameLog;

  const vitals = new PlayerVitals({
    player: state.player,
    inventory: state.inventory,
  });
  state.playerVitals = vitals;

  // Creative mode is creative mode. A player placing scenery does not want a lava lake
  // to kill them, and the storyline's hazards are a survival-mode idea.
  const isCreative = () => game.mode === 'creative';

  const meter = new HealthMeter();
  vitals.onHealthChanged = (health, maxHealth) => meter.render(health, maxHealth);
  vitals.onDamage = () => meter.flashDamage();

  vitals.onDeath = (source) => {
    log(`[Cuubz] Player died (${source})`);
    // Immediate, not on the 30 s timer: a death is exactly the moment a player's
    // position and inventory are worth having on disk.
    try { game.savePlayerState(); } catch (e) { console.warn('[Cuubz] save on death failed:', e && e.message); }

    const timer = setTimeout(() => {
      // `character.spawnPoints[worldId]` has been written by `savePlayerState` on every
      // 30 s tick since PR 17 and read by nothing. This is its first reader.
      const character = state.currentCharacter;
      const worldId = state.currentWorld ? state.currentWorld.id : null;
      const saved = character && worldId && character.spawnPoints
        ? character.spawnPoints[worldId]
        : null;
      const spawn = saved || { x: 0, y: state.spawnHeight || 40, z: 0 };
      vitals.respawn(spawn);
      log('[Cuubz] Respawned');
    }, RESPAWN_DELAY_SECONDS * 1000);

    state.addTeardown(() => clearTimeout(timer));
  };

  // ─── Mob attacks ───────────────────────────────────────────────
  //
  // Replaces the `if (survivalSystem)` block in `mobIntegration.init`. Installed here
  // rather than by passing vitals through `initMobs` because the mob system is built at
  // step 9, before the inventory exists (D-36), and armour needs the inventory.
  const mobs = state.mobIntegration;
  if (mobs && mobs.mobManager) {
    mobs.mobManager.onMobAttack = (mob, damage) => {
      if (isCreative()) return;
      vitals.takeDamage(damage, DAMAGE_SOURCES.MOB);
    };
    log('[Cuubz] Mob attacks wired to player vitals');
  }

  // ─── Restore, and keep the character's health across sessions ──
  const character = state.currentCharacter;
  if (character && character.vitals) vitals.restore(character.vitals);

  // ─── Environmental damage (S4) ─────────────────────────────────
  //
  // `state.chunkWorld` — the `getBlockAtWorld` shim the collision code already uses — is
  // not built until `_startRenderLoop` (step 16), so the world handle is set there
  // rather than passed here. `questStep` null-guards the system either way.
  const hazards = new HazardSystem({
    vitals,
    player: state.player,
    world: state.chunkWorld,
    isCreative,
  });
  state.hazardSystem = hazards;

  // ─── Eating (S10, D-123) ───────────────────────────────────────
  //
  // Wired here rather than in `initInventory` because it needs both halves and vitals is
  // the later of the two. `BlockInteraction` gives `onUseItem` first refusal on every
  // right-click and places a block on anything it does not claim, so `tryEat`'s boolean
  // is load-bearing — see its header.
  const eating = new EatingSystem({ inventory: state.inventory, vitals });
  state.eatingSystem = eating;
  if (state.blockInteraction) {
    state.blockInteraction.onUseItem = () => {
      if (isCreative()) return false; // nothing to heal, and a creative click is a place
      return eating.tryEat().eaten;
    };
  }

  meter.render(vitals.health, vitals.maxHealth);
  state.addTeardown(() => meter.dispose());

  log('[Cuubz] Player vitals, hazards and eating ready');
}
