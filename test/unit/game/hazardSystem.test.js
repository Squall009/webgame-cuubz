/**
 * Cuubz — environmental damage (S4)
 *
 * Two assertions carry this file, and both are named in `quest_implementation.md` §11:
 *
 *   1. **Hazard ids are read from `BLOCK_TYPES`, never literals** — the exact D-64
 *      defect that shipped in the deleted `DamageSystem.js`, which hard-coded
 *      `LAVA_ID = 15` against a registry where lava is 47, and whose test asserted the
 *      *same wrong mapping* so it passed.
 *   2. **Nothing lingers.** Stand on corrupt ground → slow drain; step off → the drain
 *      stops in the same tick and no damage is dealt thereafter. That is §3.5's whole
 *      design and it is asserted directly, not inferred from the absence of a timer.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../../helpers/paths.js';
import { HazardSystem, HAZARD_DPS, HAZARD_SOURCE } from '../../../src/game/systems/HazardSystem.js';
import { PlayerVitals, MAX_HEALTH } from '../../../src/game/entities/PlayerVitals.js';
import { BLOCK_TYPES, BLOCK_BY_ID } from '../../../src/engine/world/BlockRegistry.js';
import { DAMAGE_SOURCES } from '../../../src/game/data/DamageSources.js';

/** A world where one specific column is made of `blockId`, and everything else is air. */
function worldOf(blockId) {
  return { getBlockAtWorld: () => blockId };
}

/** A world whose block can be swapped between calls — for the step-off case. */
function mutableWorld(initial) {
  const state = { block: initial };
  return {
    state,
    world: { getBlockAtWorld: () => state.block },
  };
}

function makeSystem(world, opts = {}) {
  const vitals = new PlayerVitals(opts.vitalsConfig || {});
  const player = { position: { x: 0.5, y: 64, z: 0.5 } };
  const hazards = new HazardSystem({
    vitals, player, world, isCreative: opts.isCreative || (() => false),
  });
  return { vitals, player, hazards };
}

/** Run `seconds` of frames at 60 fps. */
function run(hazards, seconds) {
  const step = 1 / 60;
  for (let t = 0; t < seconds; t += step) {
    hazards.update(step);
    if (hazards._vitals) hazards._vitals.update(step);
  }
}

describe('D-64 — every hazard id comes from the registry', () => {
  it('the table names blocks that exist', () => {
    for (const id of Object.keys(HAZARD_DPS)) {
      expect(BLOCK_BY_ID[Number(id)], `block id ${id} exists`).toBeDefined();
    }
  });

  it('the resolved ids are the registry’s, not a stale set', () => {
    // This is the assertion the deleted `DamageSystem`'s test did not make: it asserted
    // its own wrong constants back at itself. Here the expected value comes from
    // `BLOCK_BY_ID`, so a renumbering moves both sides together and a hard-coded
    // literal is the only thing that can go red.
    expect(BLOCK_BY_ID[BLOCK_TYPES.LAVA].name).toBe('lava');
    expect(BLOCK_BY_ID[BLOCK_TYPES.MAGMA].name).toBe('magma');
    expect(BLOCK_BY_ID[BLOCK_TYPES.TOXIC_SLIME].name).toBe('toxic_slime');
    expect(BLOCK_BY_ID[BLOCK_TYPES.CORRUPT_GRASS].name).toBe('corrupt_grass');
    expect(BLOCK_BY_ID[BLOCK_TYPES.CORRUPT_STONE].name).toBe('corrupt_stone');

    // And the ids the old system got wrong are still not what it thought.
    expect(BLOCK_TYPES.LAVA).not.toBe(15);
    expect(BLOCK_TYPES.TOXIC_SLIME).not.toBe(17);
  });

  it('the source file contains no numeric hazard literal', () => {
    // Structural, because the failure mode is silent: a literal that happens to be a
    // valid block id produces damage on the wrong block and nothing complains.
    const src = fs.readFileSync(
      path.join(REPO_ROOT, 'src/game/systems/HazardSystem.js'), 'utf8'
    );
    const table = src.slice(src.indexOf('export const HAZARD_DPS'), src.indexOf('export const HAZARD_SOURCE'));
    // Keys must all be computed member accesses. A bare `[15]:` or `15:` is the defect.
    expect(table).not.toMatch(/^\s*\[?\d+\]?\s*:/m);
    expect(table).toMatch(/\[BLOCK_TYPES\.LAVA\]/);
  });

  it('every hazard has a damage source', () => {
    for (const id of Object.keys(HAZARD_DPS)) {
      expect(HAZARD_SOURCE[id], `block ${id} has a source`).toBeDefined();
    }
  });
});

describe('lava', () => {
  it('kills from full in roughly two and a half seconds', () => {
    const { vitals, hazards } = makeSystem(worldOf(BLOCK_TYPES.LAVA));
    run(hazards, 2.0);
    expect(vitals.isDead, `health was ${vitals.health} after 2 s`).toBe(false);
    run(hazards, 1.0);
    expect(vitals.isDead).toBe(true);
  });

  it('is not blunted by a full armour set', () => {
    // §3.5: lava kills quickly and obviously. A player in netherite wading through it
    // because the numbers worked out is a different game.
    const armoured = { getEquipmentStats: () => ({ totalArmor: 1000 }) };
    const { vitals, hazards } = makeSystem(worldOf(BLOCK_TYPES.LAVA), {
      vitalsConfig: { inventory: armoured },
    });
    run(hazards, 3.0);
    expect(vitals.isDead).toBe(true);
  });

  it('reports itself as the death source', () => {
    const { vitals, hazards } = makeSystem(worldOf(BLOCK_TYPES.LAVA));
    run(hazards, 3.0);
    expect(vitals.lastDamageSource).toBe(DAMAGE_SOURCES.LAVA);
  });
});

describe('corrupted ground', () => {
  it('drains about 1 HP every 4 seconds', () => {
    const { vitals, hazards } = makeSystem(worldOf(BLOCK_TYPES.CORRUPT_GRASS));
    run(hazards, 4.2);
    expect(MAX_HEALTH - vitals.health).toBe(1);
    run(hazards, 4.0);
    expect(MAX_HEALTH - vitals.health).toBe(2);
  });

  it('costs a sliver to cross and is a real problem to stand in', () => {
    // The two halves of §3.5's second property, as one comparison.
    const crossing = makeSystem(worldOf(BLOCK_TYPES.CORRUPT_GRASS));
    run(crossing.hazards, 6);
    const crossingCost = MAX_HEALTH - crossing.vitals.health;

    const standing = makeSystem(worldOf(BLOCK_TYPES.CORRUPT_GRASS));
    run(standing.hazards, 60);
    const standingCost = MAX_HEALTH - standing.vitals.health;

    expect(crossingCost).toBeLessThanOrEqual(2);
    expect(standingCost).toBeGreaterThan(10);
    expect(standing.vitals.isDead).toBe(false); // a minute is a problem, not a death
  });

  it('is on a completely different scale from lava', () => {
    expect(HAZARD_DPS[BLOCK_TYPES.LAVA] / HAZARD_DPS[BLOCK_TYPES.CORRUPT_GRASS])
      .toBeGreaterThan(20);
  });
});

describe('the no-lingering guarantee — §3.5', () => {
  it('stops in the same tick the player steps off, and deals nothing after', () => {
    const { state, world } = mutableWorld(BLOCK_TYPES.CORRUPT_GRASS);
    const { vitals, hazards } = makeSystem(world);

    run(hazards, 4.2);
    const afterStanding = vitals.health;
    expect(MAX_HEALTH - afterStanding).toBe(1);
    expect(hazards.currentHazard).toBe(BLOCK_TYPES.CORRUPT_GRASS);

    // Step off. One tick is all it takes.
    state.block = BLOCK_TYPES.GRASS;
    hazards.update(1 / 60);
    expect(hazards.currentHazard).toBe(0);

    // And nothing is dealt thereafter — not a trailing partial tick, not a timer, not a
    // debuff. Regeneration is the only thing that may move health now.
    run(hazards, 3);
    expect(vitals.health).toBeGreaterThanOrEqual(afterStanding);
  });

  it('discards the partial accumulator rather than banking it', () => {
    // Three seconds on corrupt ground is 0.75 HP of accumulated damage. Stepping off
    // and back on must not immediately land that as a hit — otherwise the hazard has
    // memory, which is exactly what §3.5 forbids.
    const { state, world } = mutableWorld(BLOCK_TYPES.CORRUPT_GRASS);
    const { vitals, hazards } = makeSystem(world);

    run(hazards, 3);
    expect(vitals.health).toBe(MAX_HEALTH);

    state.block = BLOCK_TYPES.GRASS;
    hazards.update(1 / 60);
    state.block = BLOCK_TYPES.CORRUPT_GRASS;
    hazards.update(1 / 60);
    expect(vitals.health).toBe(MAX_HEALTH);
  });

  it('walking a straight line across a patch is survivable', () => {
    // §11's integration wording. Twenty seconds of alternating corrupt and clear ground
    // — a plausible traverse — costs a few HP and kills nobody.
    const { state, world } = mutableWorld(BLOCK_TYPES.CORRUPT_GRASS);
    const { vitals, hazards } = makeSystem(world);
    const step = 1 / 60;
    for (let i = 0; i < 20 * 60; i++) {
      // Roughly a third of the surface is corrupted (the biome's variant weights).
      state.block = (i % 3 === 0) ? BLOCK_TYPES.CORRUPT_GRASS : BLOCK_TYPES.GRASS;
      hazards.update(step);
      vitals.update(step);
    }
    expect(vitals.isDead).toBe(false);
    expect(vitals.health).toBeGreaterThan(MAX_HEALTH * 0.7);
  });
});

describe('what the system does not do', () => {
  it('nothing at all on a non-hazardous block', () => {
    const { vitals, hazards } = makeSystem(worldOf(BLOCK_TYPES.STONE));
    run(hazards, 10);
    expect(vitals.health).toBe(MAX_HEALTH);
    expect(hazards.currentHazard).toBe(0);
  });

  it('nothing in creative mode', () => {
    const { vitals, hazards } = makeSystem(worldOf(BLOCK_TYPES.LAVA), {
      isCreative: () => true,
    });
    run(hazards, 10);
    expect(vitals.health).toBe(MAX_HEALTH);
  });

  it('nothing to a dead player', () => {
    const { vitals, hazards } = makeSystem(worldOf(BLOCK_TYPES.LAVA));
    vitals.takeDamage(MAX_HEALTH, DAMAGE_SOURCES.LAVA);
    const before = vitals.health;
    run(hazards, 5);
    expect(vitals.health).toBe(before);
  });

  it('survives a world that throws or is absent', () => {
    // Runs every frame; a chunk boundary is not an error.
    const throwing = { getBlockAtWorld: () => { throw new Error('unloaded chunk'); } };
    const a = makeSystem(throwing);
    expect(() => run(a.hazards, 1)).not.toThrow();
    expect(a.vitals.health).toBe(MAX_HEALTH);

    const b = makeSystem(null);
    expect(() => run(b.hazards, 1)).not.toThrow();
  });

  it('ignores a nonsense delta', () => {
    const { vitals, hazards } = makeSystem(worldOf(BLOCK_TYPES.LAVA));
    hazards.update(0);
    hazards.update(-1);
    hazards.update(NaN);
    expect(vitals.health).toBe(MAX_HEALTH);
  });
});

describe('the worst hazard touching the player wins', () => {
  it('lava beats the corrupt stone under it', () => {
    let call = 0;
    const world = {
      getBlockAtWorld: () => (call++ % 2 === 0 ? BLOCK_TYPES.LAVA : BLOCK_TYPES.CORRUPT_STONE),
    };
    const { hazards } = makeSystem(world);
    expect(hazards.sample().dps).toBe(HAZARD_DPS[BLOCK_TYPES.LAVA]);
  });

  it('finds a hazard the player is standing on, not only one they are in', () => {
    // Magma is walked on, never stood inside. Probing only the feet block would make it
    // completely harmless.
    let call = 0;
    const world = {
      getBlockAtWorld: () => (call++ === 0 ? BLOCK_TYPES.AIR : BLOCK_TYPES.MAGMA),
    };
    const { hazards } = makeSystem(world);
    expect(hazards.sample().blockId).toBe(BLOCK_TYPES.MAGMA);
  });
});

describe('the damage rate does not depend on frame rate', () => {
  it('30 fps and 120 fps deal the same damage over the same wall-clock time', () => {
    // `PlayerVitals` opens a 0.4 s invulnerability window on every landed hit, so a
    // system that applied a fractional hit per frame would land one and drop the rest —
    // making the effective rate a function of fps. The accumulator is what prevents it.
    const at = (fps) => {
      const { vitals, hazards } = makeSystem(worldOf(BLOCK_TYPES.CORRUPT_GRASS));
      const step = 1 / fps;
      for (let i = 0; i < fps * 13; i++) { hazards.update(step); vitals.update(step); }
      return MAX_HEALTH - vitals.health;
    };
    expect(at(30)).toBe(at(120));
    expect(at(60)).toBe(at(120));
    // 13 s at 0.25 dps is 3.25 accumulated, so three whole hit points have landed.
    expect(at(30)).toBe(3);
  });
});
