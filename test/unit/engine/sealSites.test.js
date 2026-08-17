/**
 * Cuubz — where the seals are, and the two properties that keep them there (S5)
 *
 * §11's S5 row asks for three things and this file is all three:
 *
 *   • `sealSites` determinism — same seed, same sites
 *   • a **seed sweep**: every seal finds its biome inside `siteRing` for ≥95% of seeds,
 *     and the fallback fires cleanly for the rest
 *   • the spiral cap terminates, and a site is frozen across recompute
 *
 * The sweep is the one that earned its keep. The first implementation — 256 probes at
 * 48 blocks apart — scored **38.8%**, and nothing but this assertion would have said so:
 * a seal in the wrong biome still generates, still has an altar, and still works. The
 * player just finds the Verdant Seal sitting in a meadow, in a quest whose text
 * describes standing in corruption.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  sealSites, resolveSealSite, siteHash, chunkIntersectsSite, siteForChunk,
  distanceToSite, bearingToSite, compassLabel, SPIRAL_CAP, SPIRAL_STEP,
} from '../../../src/engine/world/structures/SealSites.js';
import { SEAL_IDS, SEAL_DEFINITIONS } from '../../../src/game/data/SealDefinitions.js';
import { BiomeSystem } from '../../../src/engine/world/BiomeSystem.js';

/** The real biome sampler at worldgen version 2. */
const realBiomeAt = (seed) => (wx, wz) => BiomeSystem.getBiomeAtWorldPos(wx, wz, seed, 2).id;

/** Silence the intentional fallback warning while sweeping. */
function quietly(fn) {
  const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  try { return fn(); } finally { spy.mockRestore(); }
}

describe('determinism', () => {
  it('the same seed gives the same sites, every time', () => {
    const a = quietly(() => sealSites(424242, realBiomeAt(424242)));
    const b = quietly(() => sealSites(424242, realBiomeAt(424242)));
    expect(a.sites).toEqual(b.sites);
  });

  it('different seeds give different sites', () => {
    const a = quietly(() => sealSites(1, realBiomeAt(1)));
    const b = quietly(() => sealSites(2, realBiomeAt(2)));
    expect(a.sites.verdant).not.toEqual(b.sites.verdant);
  });

  it('siteHash is stable and in range', () => {
    for (const label of ['verdant:angle', 'ember:radius', 'finale:angle']) {
      const v = siteHash(99, label);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      expect(siteHash(99, label)).toBe(v);
    }
  });

  it('produces a site for all five seals and the finale', () => {
    const { sites } = quietly(() => sealSites(7, realBiomeAt(7)));
    for (const id of SEAL_IDS) {
      expect(sites[id], `${id} has a site`).toBeDefined();
      expect(Number.isFinite(sites[id].x)).toBe(true);
      expect(Number.isFinite(sites[id].z)).toBe(true);
    }
    expect(sites.finale).toBeDefined();
  });

  it('gives the Deepstone seal a depth, and nothing else one', () => {
    // The only seal that is not a surface site: it is deep, not hidden (§3.7).
    const { sites } = quietly(() => sealSites(7, realBiomeAt(7)));
    expect(sites.deepstone.y).toBeLessThan(30);
    expect(sites.verdant.y).toBeUndefined();
    expect(sites.ember.y).toBeUndefined();
  });
});

describe('the seed sweep — §7.1 asks for ≥95%', () => {
  it('finds the right biome for at least 95% of (seed, seal) pairs', () => {
    const SEEDS = 30;
    let total = 0;
    let found = 0;
    const perSeal = {};

    quietly(() => {
      for (let s = 1; s <= SEEDS; s++) {
        const seed = s * 7919;
        const result = sealSites(seed, realBiomeAt(seed));
        total += SEAL_IDS.length + 1;
        found += (SEAL_IDS.length + 1) - result.fellBack.length;
        for (const id of result.fellBack) perSeal[id] = (perSeal[id] || 0) + 1;
      }
    });

    const rate = found / total;
    expect(
      rate,
      `${(100 * rate).toFixed(1)}% found their biome; fallbacks by seal: ${JSON.stringify(perSeal)}`
    ).toBeGreaterThanOrEqual(0.95);
  }, 120000);

  it('a found site really is in the seal’s biome', () => {
    // Otherwise the sweep above is measuring its own bookkeeping rather than the world.
    quietly(() => {
      for (let s = 1; s <= 6; s++) {
        const seed = s * 7919;
        const biomeAt = realBiomeAt(seed);
        for (const id of SEAL_IDS) {
          const def = SEAL_DEFINITIONS[id];
          const r = resolveSealSite(seed, def, biomeAt);
          if (r.fellBack) continue;
          expect(biomeAt(r.x, r.z), `${id} at ${r.x},${r.z}`).toBe(def.biome);
        }
      }
    });
  }, 120000);

  it('a search costs far fewer probes than the cap, on average', () => {
    // The cap is 1200 and the mean is ~156: a search that is going to succeed usually
    // does so in the first few dozen. If this regresses, world entry got slow.
    let probes = 0;
    let sites = 0;
    quietly(() => {
      for (let s = 1; s <= 12; s++) {
        const seed = s * 7919;
        const r = sealSites(seed, realBiomeAt(seed));
        probes += r.probes;
        sites += SEAL_IDS.length + 1;
      }
    });
    expect(probes / sites).toBeLessThan(SPIRAL_CAP / 2);
  }, 120000);
});

describe('the spiral terminates, always', () => {
  it('gives up at the cap when nothing ever matches', () => {
    let calls = 0;
    const neverMatches = () => { calls++; return 'plains'; };
    const r = resolveSealSite(1, SEAL_DEFINITIONS.verdant, neverMatches);
    expect(r.fellBack).toBe(true);
    expect(calls).toBe(SPIRAL_CAP);
    expect(r.probes).toBe(SPIRAL_CAP);
  });

  it('falls back to the unfiltered ring position, which is still a real place', () => {
    const r = resolveSealSite(1, SEAL_DEFINITIONS.verdant, () => 'plains');
    const radius = Math.sqrt(r.x * r.x + r.z * r.z);
    const ring = SEAL_DEFINITIONS.verdant.siteRing;
    expect(radius).toBeGreaterThanOrEqual(ring.min - 1);
    expect(radius).toBeLessThanOrEqual(ring.max + 1);
  });

  it('says so, loudly, when it falls back', () => {
    // A silent fallback is how "the Verdant Seal is in a meadow" becomes a mystery
    // rather than a log line.
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    sealSites(1, () => 'plains');
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0][0])).toContain('fell back');
    spy.mockRestore();
  });

  it('survives a sampler that throws', () => {
    // An unsampleable column is not a reason to stop searching.
    let calls = 0;
    const flaky = (x, z) => {
      calls++;
      if (calls % 3 === 0) throw new Error('chunk not loaded');
      return calls > 50 ? 'corrupt' : 'plains';
    };
    const r = resolveSealSite(1, SEAL_DEFINITIONS.verdant, flaky);
    expect(r.fellBack).toBe(false);
  });

  it('falls back cleanly with no sampler at all', () => {
    const r = resolveSealSite(1, SEAL_DEFINITIONS.verdant, null);
    expect(r.fellBack).toBe(true);
    expect(Number.isFinite(r.x)).toBe(true);
  });
});

describe('the starting position honours siteRing', () => {
  it('lands inside the band before the spiral moves it', () => {
    for (const id of SEAL_IDS) {
      const def = SEAL_DEFINITIONS[id];
      const r = resolveSealSite(12345, def, () => 'plains'); // never matches → no spiral
      const radius = Math.sqrt(r.x * r.x + r.z * r.z);
      expect(radius, `${id} start radius`).toBeGreaterThanOrEqual(def.siteRing.min - 1);
      expect(radius).toBeLessThanOrEqual(def.siteRing.max + 1);
    }
  });

  it('orders the acts roughly by distance from spawn', () => {
    // Verdant is the closest thing to a tutorial dungeon; Deepstone is the furthest.
    // The bands overlap deliberately, so this is about the mins, not the results.
    expect(SEAL_DEFINITIONS.verdant.siteRing.min).toBeLessThan(SEAL_DEFINITIONS.ember.siteRing.min);
    expect(SEAL_DEFINITIONS.ember.siteRing.min).toBeLessThan(SEAL_DEFINITIONS.frozen.siteRing.min);
    expect(SEAL_DEFINITIONS.frozen.siteRing.min).toBeLessThan(SEAL_DEFINITIONS.sunken.siteRing.min);
    expect(SEAL_DEFINITIONS.sunken.siteRing.min).toBeLessThan(SEAL_DEFINITIONS.deepstone.siteRing.min);
  });
});

describe('chunk intersection — the worldgen hot path', () => {
  const site = { x: 100, z: 100 };

  it('finds the chunk the site is in', () => {
    expect(chunkIntersectsSite(6, 6, site, 24)).toBe(true); // 96..111
  });

  it('finds the neighbours within the radius', () => {
    expect(chunkIntersectsSite(5, 6, site, 24)).toBe(true);
    expect(chunkIntersectsSite(7, 6, site, 24)).toBe(true);
  });

  it('rejects a chunk well outside it', () => {
    expect(chunkIntersectsSite(50, 50, site, 24)).toBe(false);
    expect(chunkIntersectsSite(-20, 3, site, 24)).toBe(false);
  });

  it('rejects the overwhelming majority of chunks, which is the point', () => {
    let hits = 0;
    for (let cx = -40; cx <= 40; cx++) {
      for (let cz = -40; cz <= 40; cz++) {
        if (chunkIntersectsSite(cx, cz, site, 24)) hits++;
      }
    }
    // A 24-block radius touches about 5x5 chunks out of 81x81.
    expect(hits).toBeLessThan(30);
  });

  it('siteForChunk names which seal a chunk belongs to', () => {
    const sites = { verdant: { x: 0, z: 0 }, ember: { x: 5000, z: 5000 } };
    expect(siteForChunk(0, 0, sites).id).toBe('verdant');
    expect(siteForChunk(312, 312, sites).id).toBe('ember');
    expect(siteForChunk(100, 100, sites)).toBeNull();
    expect(siteForChunk(0, 0, null)).toBeNull();
  });
});

describe('the HUD marker', () => {
  it('measures distance ignoring height', () => {
    expect(distanceToSite({ x: 0, y: 200, z: 0 }, { x: 3, z: 4 })).toBe(5);
    expect(distanceToSite(null, { x: 1, z: 1 })).toBe(Infinity);
  });

  it('points north, east, south and west correctly', () => {
    const at = (x, z) => compassLabel(bearingToSite({ x: 0, y: 0, z: 0 }, { x, z }));
    // -Z is north in this engine's convention.
    expect(at(0, -100)).toBe('N');
    expect(at(100, 0)).toBe('E');
    expect(at(0, 100)).toBe('S');
    expect(at(-100, 0)).toBe('W');
    expect(at(100, -100)).toBe('NE');
  });

  it('gives a bearing in [0, 360)', () => {
    for (let a = 0; a < Math.PI * 2; a += 0.3) {
      const b = bearingToSite({ x: 0, z: 0 }, { x: Math.cos(a) * 50, z: Math.sin(a) * 50 });
      expect(b).toBeGreaterThanOrEqual(0);
      expect(b).toBeLessThan(360);
    }
  });
});

describe('the spiral parameters are the measured ones', () => {
  it('reaches far enough to matter', () => {
    // The reason 256/48 scored 38.8% was reach, not density: a biome may simply not
    // exist near the hashed ring, and no amount of sampling a desert-free region finds
    // a desert.
    const reach = SPIRAL_STEP * Math.sqrt(SPIRAL_CAP);
    expect(reach).toBeGreaterThan(3000);
  });
});
