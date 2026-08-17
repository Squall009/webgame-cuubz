/**
 * Cuubz — the seal state machine, and the altars worldgen actually stamps (S5)
 *
 * Two halves:
 *
 *   1. `SealSystem` — key detection, the offering, and the transitions it drives.
 *   2. **The structures exist.** §11's S5 integration row is "generate a world, assert
 *      five altars exist at the recorded sites". The worker is a classic script, so it
 *      is evaluated in a `vm` and driven directly — the same technique `biomeMasks.test.js`
 *      uses, and for the same reason: an import would be testing a different program.
 */

import { describe, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { REPO_ROOT } from '../../helpers/paths.js';
import { SealSystem, ALTAR_RADIUS } from '../../../src/game/systems/SealSystem.js';
import { QuestSystem } from '../../../src/game/systems/QuestSystem.js';
import { createQuestState, setSealSite } from '../../../src/game/data/QuestState.js';
import { SEAL_IDS, SEAL_DEFINITIONS } from '../../../src/game/data/SealDefinitions.js';
import { QUEST_ORDER } from '../../../src/game/data/QuestDefinitions.js';
import { BLOCK_TYPES } from '../../../src/engine/world/BlockRegistry.js';

/** An inventory stub with the three methods the seal code touches. */
function mockInventory(initial = {}) {
  const held = new Map(Object.entries(initial));
  return {
    countItem: (t) => held.get(String(t)) || 0,
    removeItem: (t, n) => {
      const have = held.get(String(t)) || 0;
      held.set(String(t), Math.max(0, have - n));
      return true;
    },
    _set: (t, n) => held.set(String(t), n),
    _held: held,
  };
}

/** A quest system parked on a given quest, with every earlier one completed. */
function atQuest(questId) {
  const state = createQuestState();
  for (const id of QUEST_ORDER) {
    if (id === questId) break;
    state.quests[id] = { stage: 0, completed: true, completedAt: 1 };
  }
  return new QuestSystem({ questState: state });
}

function makeSeals(questSystem, inventory, opts = {}) {
  const seals = new SealSystem({ questSystem, inventory, ...opts });
  // Freeze every site somewhere known, so proximity is testable without worldgen.
  const state = questSystem.getState();
  setSealSite(state, 'verdant', { x: 1000, z: 0 });
  setSealSite(state, 'ember', { x: 0, z: 1000 });
  setSealSite(state, 'frozen', { x: -1000, z: 0 });
  setSealSite(state, 'sunken', { x: 0, z: -1000 });
  setSealSite(state, 'deepstone', { x: 2000, z: 2000, y: 24 });
  setSealSite(state, 'finale', { x: -2000, z: -2000 });
  return seals;
}

describe('site resolution', () => {
  it('writes every missing site once and freezes it', () => {
    const quests = new QuestSystem({ questState: createQuestState() });
    const seals = new SealSystem({ questSystem: quests });
    const biomeAt = () => 'corrupt'; // matches verdant and finale; the rest fall back

    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(seals.resolveSites(42, biomeAt)).toBe(6);
    // Second call finds nothing missing, so it does no search at all — which matters,
    // because the search is ~940 biome samples on every world entry otherwise.
    expect(seals.resolveSites(42, biomeAt)).toBe(0);
    spy.mockRestore();

    for (const id of SEAL_IDS) expect(seals.getSite(id)).not.toBeNull();
    expect(seals.getSite('finale')).not.toBeNull();
  });

  it('a guest resolves nothing — the host’s sites arrive in QUEST_SYNC', () => {
    const quests = new QuestSystem({ questState: createQuestState(), authoritative: false });
    const seals = new SealSystem({ questSystem: quests, authoritative: false });
    expect(seals.resolveSites(42, () => 'corrupt')).toBe(0);
    expect(seals.getSite('verdant')).toBeNull();
  });
});

describe('key detection', () => {
  it('marks a seal keyed when the party is carrying its key', () => {
    const quests = atQuest('q09');
    const inv = mockInventory();
    const seals = makeSeals(quests, inv);

    expect(seals.getSealState('verdant')).toBe('dormant');
    inv._set('seal_key_verdant', 1);
    seals.update(1.1, { x: 0, y: 64, z: 0 });
    expect(seals.getSealState('verdant')).toBe('keyed');
  });

  it('does not key a seal whose key the party does not have', () => {
    const quests = atQuest('q09');
    const inv = mockInventory();
    const seals = makeSeals(quests, inv);
    inv._set('seal_key_verdant', 1);
    seals.update(1.1, { x: 0, y: 64, z: 0 });
    expect(seals.getSealState('ember')).toBe('dormant');
  });

  it('scans about once a second, not every frame', () => {
    const quests = atQuest('q09');
    const inv = mockInventory({ seal_key_verdant: 1 });
    const seals = makeSeals(quests, inv);
    seals.update(1 / 60, { x: 0, y: 64, z: 0 });
    expect(seals.getSealState('verdant')).toBe('dormant');
    for (let i = 0; i < 60; i++) seals.update(1 / 60, { x: 0, y: 64, z: 0 });
    expect(seals.getSealState('verdant')).toBe('keyed');
  });
});

describe('altar proximity', () => {
  it('notices when the player is standing at one', () => {
    const quests = atQuest('q11');
    const seals = makeSeals(quests, mockInventory());
    const seen = [];
    seals.onAltarInRange = (id) => seen.push(id);

    seals.update(0.1, { x: 0, y: 64, z: 0 });
    expect(seals.altarInRange).toBeNull();

    seals.update(0.1, { x: 1000, y: 64, z: 0 });
    expect(seals.altarInRange).toBe('verdant');
    expect(seen).toEqual(['verdant']);
  });

  it('fires once per arrival, not once per frame', () => {
    const quests = atQuest('q11');
    const seals = makeSeals(quests, mockInventory());
    let fired = 0;
    seals.onAltarInRange = () => { fired++; };
    for (let i = 0; i < 20; i++) seals.update(0.01, { x: 1000, y: 64, z: 0 });
    expect(fired).toBe(1);
  });

  it('clears when the player walks away', () => {
    const quests = atQuest('q11');
    const seals = makeSeals(quests, mockInventory());
    seals.update(0.1, { x: 1000, y: 64, z: 0 });
    seals.update(0.1, { x: 1000 + ALTAR_RADIUS + 5, y: 64, z: 0 });
    expect(seals.altarInRange).toBeNull();
  });
});

describe('the offering', () => {
  const primed = () => {
    const quests = atQuest('q11');
    const inv = mockInventory({ seal_key_verdant: 1, corrupt_crystal: 5 });
    return { quests, inv, seals: makeSeals(quests, inv) };
  };

  it('refuses without the key', () => {
    const { seals, inv } = primed();
    inv._set('seal_key_verdant', 0);
    const r = seals.canMakeOffering('verdant');
    expect(r.ok).toBe(false);
    expect(r.missing.some((m) => m.item === 'seal_key_verdant')).toBe(true);
  });

  it('refuses without the crystals', () => {
    const { seals, inv } = primed();
    inv._set('corrupt_crystal', 4);
    const r = seals.canMakeOffering('verdant');
    expect(r.ok).toBe(false);
    expect(r.missing[0]).toEqual({ item: 'corrupt_crystal', need: 5, have: 4 });
  });

  it('primes the seal and consumes everything', () => {
    // Consumption is what makes a `deliver` exploit-proof where a `contribute_item` is
    // not: two players can pass one stack back and forth to double-count a pool, but
    // they cannot do it with items the altar has eaten (§4.5).
    const { seals, inv, quests } = primed();
    expect(seals.makeOffering('verdant').ok).toBe(true);
    expect(seals.getSealState('verdant')).toBe('primed');
    expect(inv.countItem('seal_key_verdant')).toBe(0);
    expect(inv.countItem('corrupt_crystal')).toBe(0);
    // Q11 is the DELIVER quest, and the offering is what completes it.
    expect(quests.isCompleted('q11')).toBe(true);
  });

  it('cannot be made twice', () => {
    const { seals, inv } = primed();
    seals.makeOffering('verdant');
    inv._set('seal_key_verdant', 1);
    inv._set('corrupt_crystal', 5);
    const r = seals.makeOffering('verdant');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('already been made');
    // And the second attempt did not eat the items.
    expect(inv.countItem('corrupt_crystal')).toBe(5);
  });

  it('cannot be made on a broken seal', () => {
    const { seals, quests } = primed();
    quests.setSeal('verdant', 'primed');
    quests.setSeal('verdant', 'contested');
    quests.setSeal('verdant', 'broken');
    expect(seals.canMakeOffering('verdant').reason).toContain('already broken');
  });

  it('a guest cannot prime a seal', () => {
    const quests = new QuestSystem({ questState: createQuestState(), authoritative: false });
    const inv = mockInventory({ seal_key_verdant: 1, corrupt_crystal: 5 });
    const seals = makeSeals(quests, inv, { authoritative: false });
    const r = seals.makeOffering('verdant');
    expect(r.ok).toBe(false);
    expect(inv.countItem('corrupt_crystal')).toBe(5);
  });
});

describe('the spire is inert until all five are broken — §3.7', () => {
  it('refuses, and says how many are left', () => {
    const quests = atQuest('q27');
    const seals = makeSeals(quests, mockInventory({ diamond: 10 }));
    const r = seals.canMakeOffering('finale');
    expect(r.ok).toBe(false);
    expect(r.reason).toContain('Five seals hold this shut');
    expect(r.reason).toContain('0 of 5');
  });

  it('opens once the fifth breaks', () => {
    const quests = atQuest('q27');
    const seals = makeSeals(quests, mockInventory({ diamond: 10 }));
    for (const id of SEAL_IDS) quests.setSeal(id, 'broken');
    expect(seals.canMakeOffering('finale').ok).toBe(true);
    expect(quests.getState().finale.state).toBe('open');
  });
});

describe('the HUD marker', () => {
  it('points at the seal the active quest names', () => {
    const quests = atQuest('q09'); // marker: { seal: 'verdant' }
    const seals = makeSeals(quests, mockInventory());
    const marker = seals.getMarker({ x: 0, y: 64, z: 0 });
    expect(marker.sealId).toBe('verdant');
    expect(marker.name).toBe('Verdant Seal');
    expect(marker.distance).toBe(1000);
    expect(marker.compass).toBe('E');
  });

  it('is absent on a quest that points at a biome instead', () => {
    const quests = atQuest('q01'); // marker: { biome: 'plains' }
    const seals = makeSeals(quests, mockInventory());
    expect(seals.getMarker({ x: 0, y: 64, z: 0 })).toBeNull();
  });

  it('is absent before the site is resolved', () => {
    const quests = atQuest('q09');
    const seals = new SealSystem({ questSystem: quests });
    expect(seals.getMarker({ x: 0, y: 64, z: 0 })).toBeNull();
  });
});

// ══════════════════════════════════════════════════════════════════════
// The structures worldgen actually stamps
// ══════════════════════════════════════════════════════════════════════

function loadWorker() {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'src/engine/world/workerGeneration.js'), 'utf8');
  const sandbox = { self: {}, console, Math, Object, Array, Uint8Array, Int32Array, Float32Array, Date };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  const marker = '})(typeof self !== ';
  const at = source.lastIndexOf(marker);
  const instrumented = source.slice(0, at) +
    '  globalScope.__test = { generateChunk: generateChunk };\n' + source.slice(at);
  vm.runInContext(instrumented, sandbox);
  return sandbox.self.__test;
}

const GEN_PARAMS = {
  continentScale: 4000, contScale: 400, tempScale: 2000, humScale: 2000, erosScale: 280,
  detailScale: 40, octaves: 5, persistence: 0.5, lacunarity: 2.0,
  caveScale: 50, caveThresh: 0.10, riverScale: 1000, riverDensity: 0.30, riverDepth: 20,
  baseChunkX: 0, baseChunkZ: 0,
};

/** Read a block out of the worker's X-major output. */
const blockAt = (bytes, lx, y, lz) => bytes[(lx << 12) + (y << 4) + lz];

describe('worldgen stamps the altars — §11, S5 integration', () => {
  const worker = loadWorker();
  const SEED = 424242;

  it('places an arena floor and an altar at the recorded site', () => {
    // The site is placed at a chunk origin so the geometry is easy to reason about.
    const site = { x: 0, z: 0 };
    const params = { ...GEN_PARAMS, worldgenVersion: 2, sealSites: { verdant: site } };
    const result = worker.generateChunk(0, 0, SEED, params);
    const bytes = new Uint8Array(result.chunkBytes);

    // Somewhere in this chunk there is a corrupt_stone floor — the Verdant arena's.
    let floors = 0;
    let altars = 0;
    for (let lx = 0; lx < 16; lx++) {
      for (let lz = 0; lz < 16; lz++) {
        for (let y = 0; y < 128; y++) {
          const b = blockAt(bytes, lx, y, lz);
          if (b === BLOCK_TYPES.CORRUPT_STONE) floors++;
          if (b === BLOCK_TYPES.CHISELED_STONE_BRICKS) altars++;
        }
      }
    }
    expect(floors, 'arena floor blocks').toBeGreaterThan(0);
    expect(altars, 'altar block at the centre').toBeGreaterThan(0);
  });

  it('clears the volume above the floor, so a boss has somewhere to stand', () => {
    const site = { x: 8, z: 8 };
    const params = { ...GEN_PARAMS, worldgenVersion: 2, sealSites: { verdant: site } };
    const bytes = new Uint8Array(worker.generateChunk(0, 0, SEED, params).chunkBytes);

    // Find the floor at the site column, then assert clear air above it.
    let floorY = -1;
    for (let y = 127; y > 0; y--) {
      if (blockAt(bytes, 8, y, 8) === BLOCK_TYPES.CORRUPT_STONE) { floorY = y; break; }
    }
    expect(floorY).toBeGreaterThan(0);
    // The altar occupies the two blocks directly above the centre, so check a column
    // a few blocks out instead.
    let clear = 0;
    for (let y = floorY + 1; y < floorY + 12; y++) {
      if (blockAt(bytes, 12, y, 8) === 0) clear++;
    }
    expect(clear).toBeGreaterThan(8);
  });

  it('stamps the spire at the finale site', () => {
    const params = { ...GEN_PARAMS, worldgenVersion: 2, sealSites: { finale: { x: 8, z: 8 } } };
    const bytes = new Uint8Array(worker.generateChunk(0, 0, SEED, params).chunkBytes);

    let column = 0;
    for (let y = 0; y < 128; y++) {
      const b = blockAt(bytes, 8, y, 8);
      if (b === BLOCK_TYPES.BLACKSTONE || b === BLOCK_TYPES.CRYING_OBSIDIAN) column++;
    }
    // §3.7 — physically present from world generation, inert until five are broken.
    expect(column, 'the spire is a tall column').toBeGreaterThan(20);
  });

  it('stamps nothing at all in a v1 world', () => {
    // §3.1's guarantee extends to structures: an existing save gets no altars, because
    // it has no Corrupt or Lava biome to put the first two seals in either.
    const params = { ...GEN_PARAMS, worldgenVersion: 1, sealSites: { verdant: { x: 8, z: 8 } } };
    const bytes = new Uint8Array(worker.generateChunk(0, 0, SEED, params).chunkBytes);
    for (let i = 0; i < bytes.length; i++) {
      expect(bytes[i]).not.toBe(BLOCK_TYPES.CHISELED_STONE_BRICKS);
    }
  });

  it('leaves a chunk nowhere near a site completely alone', () => {
    const far = { ...GEN_PARAMS, worldgenVersion: 2, sealSites: { verdant: { x: 5000, z: 5000 } } };
    const none = { ...GEN_PARAMS, worldgenVersion: 2 };
    const a = new Uint8Array(worker.generateChunk(3, 4, SEED, far).chunkBytes);
    const b = new Uint8Array(worker.generateChunk(3, 4, SEED, none).chunkBytes);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('a v1 chunk is byte-identical with and without sealSites', () => {
    const withSites = { ...GEN_PARAMS, worldgenVersion: 1, sealSites: { verdant: { x: 8, z: 8 } } };
    const without = { ...GEN_PARAMS, worldgenVersion: 1 };
    const a = new Uint8Array(worker.generateChunk(0, 0, SEED, withSites).chunkBytes);
    const b = new Uint8Array(worker.generateChunk(0, 0, SEED, without).chunkBytes);
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});
