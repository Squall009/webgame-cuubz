/**
 * Cuubz — the Corrupt and Lava biomes, and the duplication guard §2.4 demands (S4)
 *
 * ─── THE ASSERTION THIS FILE EXISTS FOR ─────────────────────────────────────
 *
 * `selectBiome` exists **twice**: once in `BiomeSystem.js` (ESM, main thread) and once
 * in `workerGeneration.js` (a classic script with its own `var BIOME` table, loaded
 * `?url` into the worker pool). They have been byte-equivalent by hand, and
 * `quest_implementation.md` §2.4 calls this "the constraint that shapes all of S4":
 *
 *   > Any biome added to one must be added to the other, identically, or the terrain the
 *   > worker builds will disagree with the biome the main thread thinks the player is
 *   > standing in — wrong fog, wrong mob spawns, wrong hazard checks, and **no test
 *   > failure**.
 *
 * So the two copies are swept against each other over a grid of `(cont, eros, temp, hum,
 * blight, scorch)`. The worker file is a classic script that assigns
 * `globalScope._voxelgenGenerateChunk` and exposes nothing else, so its `selectBiome` is
 * reached the only way it can be: by evaluating the source in a `vm` context and
 * pulling the function out. That is uglier than an import and it is the point — an
 * import would be testing a different file than the one the worker loads.
 *
 * ─── AND THE COMPATIBILITY GUARANTEE ────────────────────────────────────────
 *
 * A v1 world must generate byte-identical terrain. That reduces to one property:
 * `selectBiome` with two `undefined` masks returns exactly what the four-argument call
 * always returned. It is asserted directly rather than inferred.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { REPO_ROOT } from '../../helpers/paths.js';
import {
  selectBiome, BIOME_DEFS, BIOME_IDS, BiomeSystem,
  BLIGHT_THRESHOLD, SCORCH_THRESHOLD, MASK_SCALE, MASK_MIN_CONTINENTALNESS,
} from '../../../src/engine/world/BiomeSystem.js';
import { createSharedPerlin } from '../../../src/engine/world/Noise.js';
import { BLOCK_TYPES, BLOCK_BY_ID } from '../../../src/engine/world/BlockRegistry.js';

/**
 * Evaluate `workerGeneration.js` in a `vm` context and hand back the private functions
 * the tests need. The file is an IIFE over `globalScope`; running it with a fake
 * `self`/`window` is exactly what the worker pool does.
 */
function loadWorkerModule() {
  const source = fs.readFileSync(
    path.join(REPO_ROOT, 'src/engine/world/workerGeneration.js'), 'utf8'
  );
  // `self` first, exactly as a real worker resolves it.
  const sandbox = { self: {}, console, Math, Object, Array, Uint8Array, Int32Array, Float32Array, Date };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  // The IIFE keeps `selectBiome` private, so the export has to be injected INSIDE it —
  // appending after the source would run in a scope where none of these names exist.
  // The shipped file is otherwise untouched: it must stay exactly what the worker loads,
  // or this is testing a different program.
  const marker = '})(typeof self !== ';
  const at = source.lastIndexOf(marker);
  if (at < 0) throw new Error('workerGeneration.js: the IIFE tail moved; update this loader');
  const instrumented =
    source.slice(0, at) +
    '  globalScope.__test = { selectBiome: selectBiome, BIOME: BIOME, ' +
    'createSharedPerlin: createSharedPerlin, sampleBiomeParams: sampleBiomeParams };\n' +
    source.slice(at);

  vm.runInContext(instrumented, sandbox);
  return sandbox.self.__test;
}

let worker;
try {
  worker = loadWorkerModule();
} catch (err) {
  worker = { error: err };
}

describe('the worker module is reachable at all', () => {
  it('evaluates and exposes selectBiome', () => {
    // If this fails, every parity assertion below is vacuous — which is the exact
    // failure mode §2.4 warns about, so it is checked first and separately.
    expect(worker.error, worker.error && String(worker.error)).toBeUndefined();
    expect(typeof worker.selectBiome).toBe('function');
  });
});

describe('the two selectBiome copies agree — §2.4', () => {
  /** A coarse sweep over the whole parameter space, masks included. */
  const sweep = () => {
    const out = [];
    for (let cont = -1.1; cont <= 1.1; cont += 0.22) {
      for (let eros = -1; eros <= 1; eros += 0.4) {
        for (let temp = -1; temp <= 1; temp += 0.33) {
          for (let hum = -1; hum <= 1; hum += 0.4) {
            for (const blight of [undefined, -0.5, 0.2, 0.43, 0.45, 0.9]) {
              for (const scorch of [undefined, -0.5, 0.2, 0.45, 0.47, 0.9]) {
                out.push([cont, eros, temp, hum, blight, scorch]);
              }
            }
          }
        }
      }
    }
    return out;
  };

  it('returns the same biome name for every point in a swept grid', () => {
    const points = sweep();
    expect(points.length).toBeGreaterThan(20000);

    const disagreements = [];
    for (const [cont, eros, temp, hum, blight, scorch] of points) {
      const a = selectBiome(cont, eros, temp, hum, blight, scorch).name;
      const b = worker.selectBiome(cont, eros, temp, hum, blight, scorch).name;
      if (a !== b) {
        disagreements.push(`(${cont.toFixed(2)},${eros.toFixed(2)},${temp.toFixed(2)},${hum.toFixed(2)},${blight},${scorch}) main=${a} worker=${b}`);
        if (disagreements.length > 5) break;
      }
    }
    expect(disagreements, `${disagreements.length} disagreements`).toEqual([]);
  });

  it('agrees on baseY and amplitude too, not just the name', () => {
    // A name match with different terrain heights would still seam the world.
    const disagreements = [];
    for (const [cont, eros, temp, hum, blight, scorch] of sweep()) {
      const a = selectBiome(cont, eros, temp, hum, blight, scorch);
      const b = worker.selectBiome(cont, eros, temp, hum, blight, scorch);
      if (a.baseY !== b.baseY || a.amplitude !== b.amplitude) {
        disagreements.push(`${a.name}: main ${a.baseY}/${a.amplitude} vs worker ${b.baseY}/${b.amplitude}`);
        if (disagreements.length > 5) break;
      }
    }
    expect(disagreements).toEqual([]);
  });

  it('agrees on the surface, sub and stone variant tables for the two new biomes', () => {
    // These decide what the biome is *made of*, and they are the tables most likely to
    // be copied with a typo — thirty numbers across six arrays.
    for (const [mainKey, workerKey] of [['CORRUPT', 'CORRUPT'], ['LAVA', 'LAVA_BIOME']]) {
      const a = BIOME_DEFS[mainKey];
      const b = worker.BIOME[workerKey];
      expect(b, `worker has ${workerKey}`).toBeDefined();
      expect(a.name).toBe(b.name);
      expect(a.surfaceVariants).toEqual(b.surfaceVariants);
      expect(a.subVariants).toEqual(b.subVariants);
      expect(a.stoneVariants).toEqual(b.stoneVariants);
      expect(a.surfaceBlock).toBe(b.surfaceBlock);
      expect(a.subBlock).toBe(b.subBlock);
    }
  });

  it('seeds the two mask noise channels identically', () => {
    // Different salts here would put the Corrupt biome in a different place on the two
    // sides — the §2.4 failure in its purest form.
    const a = createSharedPerlin(424242);
    const b = worker.createSharedPerlin(424242);
    for (let i = 0; i < 200; i++) {
      const x = (i * 37) - 3000;
      const z = (i * 91) - 5000;
      expect(a.blight.noise2(x / MASK_SCALE, z / MASK_SCALE))
        .toBe(b.blight.noise2(x / MASK_SCALE, z / MASK_SCALE));
      expect(a.scorch.noise2(x / MASK_SCALE, z / MASK_SCALE))
        .toBe(b.scorch.noise2(x / MASK_SCALE, z / MASK_SCALE));
    }
  });

  it('the worker uses the same thresholds', () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, 'src/engine/world/workerGeneration.js'), 'utf8');
    expect(src).toContain(`var BLIGHT_THRESHOLD = ${BLIGHT_THRESHOLD};`);
    expect(src).toContain(`var SCORCH_THRESHOLD = ${SCORCH_THRESHOLD};`);
    expect(src).toContain(`var MASK_SCALE = ${MASK_SCALE};`);
    expect(src).toContain(`var MASK_MIN_CONTINENTALNESS = ${MASK_MIN_CONTINENTALNESS};`);
  });
});

describe('a v1 world is untouched — §3.1', () => {
  it('four-argument selectBiome is identical to six with undefined masks', () => {
    // This is the whole compatibility guarantee: existing saves generate byte-identical
    // terrain because `undefined > 0.46` is false and the override branch does not run.
    for (let cont = -1.1; cont <= 1.1; cont += 0.05) {
      for (let eros = -1; eros <= 1; eros += 0.2) {
        for (let temp = -1; temp <= 1; temp += 0.17) {
          for (let hum = -1; hum <= 1; hum += 0.2) {
            const four = selectBiome(cont, eros, temp, hum);
            const six = selectBiome(cont, eros, temp, hum, undefined, undefined);
            expect(six.name).toBe(four.name);
          }
        }
      }
    }
  });

  it('never returns Corrupt or Lava without masks', () => {
    for (let cont = -1.1; cont <= 1.1; cont += 0.05) {
      for (let eros = -1; eros <= 1; eros += 0.25) {
        for (let temp = -1; temp <= 1; temp += 0.2) {
          for (let hum = -1; hum <= 1; hum += 0.25) {
            const name = selectBiome(cont, eros, temp, hum).name;
            expect(name).not.toBe('Corrupt');
            expect(name).not.toBe('Lava');
          }
        }
      }
    }
  });

  it('getBiomeAtWorldPos defaults to v1, so no existing caller changes behaviour', () => {
    // `WorldStep`, `BiomeEffects` and mob spawning all call this with three arguments.
    // A default of 2 would have quietly told them a v1 world contains biomes its terrain
    // does not — wrong fog over ordinary plains.
    let found = 0;
    for (let x = -4000; x < 4000; x += 137) {
      for (let z = -4000; z < 4000; z += 211) {
        const b = BiomeSystem.getBiomeAtWorldPos(x, z, 424242);
        if (b.id === 'corrupt' || b.id === 'lava') found++;
      }
    }
    expect(found).toBe(0);
  });
});

describe('the biomes are actually reachable — and rare', () => {
  it('both appear at v2', () => {
    const seen = new Set();
    for (let x = -8000; x < 8000; x += 100) {
      for (let z = -8000; z < 8000; z += 100) {
        seen.add(BiomeSystem.getBiomeAtWorldPos(x, z, 424242, 2).id);
      }
    }
    expect(seen.has('corrupt')).toBe(true);
    expect(seen.has('lava')).toBe(true);
  });

  it('each covers a plausible fraction of land', () => {
    // The target is 2–4% each (§3.2). The band asserted is 1–8%: wide enough not to be
    // brittle against a seed, narrow enough to catch "a threshold moved and the biome
    // vanished" — which would silently break S5's seal placement, since the Verdant and
    // Ember sites must find a patch inside their `siteRing`.
    let land = 0, corrupt = 0, lava = 0;
    for (let x = -8000; x < 8000; x += 100) {
      for (let z = -8000; z < 8000; z += 100) {
        const b = BiomeSystem.getBiomeAtWorldPos(x, z, 424242, 2);
        if (b.id === 'deep_ocean' || b.id === 'ocean') continue;
        land++;
        if (b.id === 'corrupt') corrupt++;
        if (b.id === 'lava') lava++;
      }
    }
    expect(land).toBeGreaterThan(1000);
    const pct = (n) => (100 * n) / land;
    expect(pct(corrupt), `corrupt is ${pct(corrupt).toFixed(2)}% of land`).toBeGreaterThan(1);
    expect(pct(corrupt)).toBeLessThan(8);
    expect(pct(lava), `lava is ${pct(lava).toFixed(2)}% of land`).toBeGreaterThan(1);
    expect(pct(lava)).toBeLessThan(8);
  });

  it('neither lands in an ocean', () => {
    // A Lava biome under water is a lake of steam; a Corrupt seabed is unreachable.
    for (let blight = 0.5; blight <= 1; blight += 0.1) {
      expect(selectBiome(-0.5, 0, 0, 0, blight, undefined).name).not.toBe('Corrupt');
      expect(selectBiome(-0.5, 0, 0, 0, undefined, blight).name).not.toBe('Lava');
    }
  });

  it('scorch beats blight where both fire', () => {
    // Ordering is deliberate and worth pinning: the two masks are independent noise and
    // will overlap somewhere.
    expect(selectBiome(0.3, 0, 0, 0, 0.9, 0.9).name).toBe('Lava');
  });
});

describe('the ids the rest of the game matches on', () => {
  it('BIOME_IDS contains corrupt and lava', () => {
    expect(BIOME_IDS).toContain('corrupt');
    expect(BIOME_IDS).toContain('lava');
  });

  it('every block the two biomes are made of exists in the registry', () => {
    for (const key of ['CORRUPT', 'LAVA']) {
      const def = BIOME_DEFS[key];
      const ids = [
        def.surfaceBlock, def.subBlock,
        ...def.surfaceVariants.map((v) => v[0]),
        ...def.subVariants.map((v) => v[0]),
        ...def.stoneVariants.map((v) => v[0]),
      ];
      for (const id of ids) {
        expect(BLOCK_BY_ID[id], `${key} names block id ${id}`).toBeDefined();
      }
    }
  });

  it('corruption is scattered, not total — 25–40% of the Corrupt surface', () => {
    // §3.5's first property, and the one that makes the biome traversable: there is
    // always a route through, and finding it is the gameplay. A biome that replaced
    // every surface block would be a wall.
    //
    // The variant weights are what the worker's `selectVariant` draws against, so the
    // corrupted share is the corrupt entries' weight over the total.
    const variants = BIOME_DEFS.CORRUPT.surfaceVariants;
    const total = variants.reduce((s, v) => s + v[1], 0);
    const corrupted = variants
      .filter((v) => v[0] === BLOCK_TYPES.CORRUPT_GRASS || v[0] === BLOCK_TYPES.CORRUPT_STONE)
      .reduce((s, v) => s + v[1], 0);
    const fraction = corrupted / total;
    expect(fraction).toBeGreaterThanOrEqual(0.25);
    expect(fraction).toBeLessThanOrEqual(0.40);
    // Neither 0% nor 100% — stated separately because those are the two failure modes.
    expect(fraction).toBeGreaterThan(0);
    expect(fraction).toBeLessThan(1);
  });

  it('the Corrupt surface still generates ordinary ground', () => {
    const names = BIOME_DEFS.CORRUPT.surfaceVariants.map((v) => BLOCK_BY_ID[v[0]].name);
    expect(names).toContain('grass_block');
    expect(names).toContain('coarse_dirt');
  });
});
