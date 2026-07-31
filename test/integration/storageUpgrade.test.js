/**
 * Cuubz — the storage upgrade ladder over a populated v2 database (D-80, H-1/H-2)
 *
 * `refactor.md` §11 asks for a persistence test "seeded with a pre-refactor v2 database
 * dump". **There is no such dump in this repository and there never was** — producing one
 * means running the pre-refactor game in a browser and exporting IndexedDB by hand, which
 * nobody has scheduled. The ruling this file implements is that a **synthetic v2 seed
 * meets the criterion**, on one condition: nothing about the seed may be hand-written.
 * The database is built by the **shipped** ladder (`ChunkSchema.applySchemaUpgrade`, via
 * the same `onupgradeneeded` entry point production uses), the records have the shapes
 * `ChunkStorage.js` actually writes, and the chunk payloads come out of the **real**
 * `ChunkBinaryCodec.encode` — so the seed cannot drift away from the encoder the way a
 * checked-in binary dump would have.
 *
 * ─── WHICH DATABASE THIS OPENS, AND WHY ─────────────────────────────────────
 *
 * `PROBE_DB = 'cuubz-storage-upgrade-probe'`. **Never `cuubz-worlds`.** That name is the
 * players' live world storage (`DEPLOY.md` §2.1) and `DB_VERSION` in `src/` is **2**; this
 * file opens a database at **version 3** to drive a real upgrade, and doing that to
 * `cuubz-worlds` would be writing a version number into the real store that shipped code
 * does not recognise. `test/e2e/saveLoad.js` already established this discipline for the
 * browser harness — it uses `cuubz-h2-upgrade-probe` — and the ladder is name-agnostic
 * (`applySchemaUpgrade` receives the database, not the name), so the proof is unaffected.
 * A distinct name is used here rather than the harness's so a shared runner could never
 * have the two collide. The final `it` asserts, through `indexedDB.databases()`, that no
 * database named `cuubz-worlds` exists at any point — that is the enforcement, not a
 * promise in a comment.
 *
 * `src/` is not touched by this file. `DB_VERSION` stays 2.
 *
 * ─── WHY NOT `legacy()` ─────────────────────────────────────────────────────
 *
 * `test/helpers/legacy.js` exists to convert the 58 MIGRATED script bodies' `process.exit`
 * verdict into a Vitest one. This file is new code, so it is plain `describe`/`it`/`expect`
 * — and therefore must never call `process.exit`, which `test/setup.js` shims into a throw.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fakeIndexedDB from 'fake-indexeddb';
import FDBKeyRange from 'fake-indexeddb/lib/FDBKeyRange';

import {
  DB_NAME, DB_VERSION, STORE_CHUNKS, STORE_MANIFESTS,
} from '../../src/engine/world/ChunkConstants.js';
import { SCHEMA_STEPS, applySchemaUpgrade, ensureStore } from '../../src/engine/world/ChunkSchema.js';
import { ChunkBinaryCodec } from '../../src/engine/world/ChunkBinaryCodec.js';
import { Chunk, BLOCK_TYPES } from '../../src/engine/world/ChunkData.js';

// `environment` is 'node' (vitest.config.js note 1), so nothing supplies these.
globalThis.indexedDB = fakeIndexedDB;
globalThis.IDBKeyRange = FDBKeyRange;

const PROBE_DB = 'cuubz-storage-upgrade-probe';
const PROBE_STORE = 'probeStore';

// Every assertion goes through `check` so `scripts/count-assertions.js` can attribute a
// count to this file without a hand-maintained number drifting from the file. The line it
// reads is printed in afterAll; the VERDICT is Vitest's, not that line's.
//
// The counter increments only AFTER the matcher has returned, and a failure is counted as
// a failure and rethrown. The first draft of this file did `ASSERTIONS++` before building
// the matcher and printed `N/N passed, 0 failed` unconditionally, so a red assertion was
// reported as green in the one number `scripts/count-assertions.js` exists to make
// trustworthy. Found by PR 31's adversarial pass.
let PASSED = 0;
let FAILED = 0;

// The proxy is recursive on purpose: `expect(x).not` is a PROPERTY that returns a second
// matcher, so counting only the first level would leave every `.not.toBe(...)` in this
// file uncounted — the same silent-undercount the wrapper exists to prevent.
function counted(matcher) {
  return new Proxy(matcher, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value === 'function') {
        return (...args) => {
          try {
            const out = value.apply(target, args);
            PASSED++;
            return out;
          } catch (e) {
            FAILED++;
            throw e;
          }
        };
      }
      if (value && typeof value === 'object') return counted(value);
      return value;
    },
  });
}

function check(actual, message) {
  return counted(expect(actual, message));
}

// ─── IndexedDB promise plumbing ───────────────────────────────────────────────

function del(name) {
  return new Promise((resolve) => {
    const r = indexedDB.deleteDatabase(name);
    r.onsuccess = r.onerror = r.onblocked = () => resolve();
  });
}

/**
 * Open PROBE_DB at `version`, running the SHIPPED ladder from `onupgradeneeded`.
 *
 * `openDatabase()` itself cannot be reused: it hardcodes DB_NAME and DB_VERSION, which is
 * the H-3 fix (one opener, always version-named) and is exactly why this probe builds the
 * request itself and calls the same `applySchemaUpgrade` the shipped opener calls.
 */
function openProbe(version, { step, spy } = {}) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(PROBE_DB, version);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      // A step that deletes is the H-2 failure mode. Count the calls rather than infer
      // from the result: a handler that deletes a store and recreates it leaves exactly
      // the same store names behind, which is how H-2 stayed invisible for years.
      if (spy) {
        const real = db.deleteObjectStore.bind(db);
        db.deleteObjectStore = (name) => { spy.deletes.push(name); return real(name); };
      }
      try {
        if (step) SCHEMA_STEPS[version] = step;
        const applied = applySchemaUpgrade(db, e.target.transaction, e.oldVersion, e.newVersion);
        if (spy) spy.applied = applied;
      } finally {
        if (step) delete SCHEMA_STEPS[version];
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('probe open blocked — a previous connection was left open'));
  });
}

/** Read both stores in ONE transaction, into a form that can be compared verbatim. */
async function readAll(db) {
  const tx = db.transaction([STORE_CHUNKS, STORE_MANIFESTS], 'readonly');
  // Both requests are issued before either is awaited: a transaction commits once its
  // request queue drains, and awaiting between two getAll()s is how you get a
  // TransactionInactiveError on the second.
  const grab = (store) => new Promise((resolve, reject) => {
    const q = tx.objectStore(store).getAll();
    q.onsuccess = () => resolve(q.result || []);
    q.onerror = () => reject(q.error);
  });
  const [chunks, manifests] = await Promise.all([grab(STORE_CHUNKS), grab(STORE_MANIFESTS)]);
  return {
    chunks: chunks
      .map((r) => ({
        chunkKey: r.chunkKey,
        worldName: r.worldName,
        savedAt: r.savedAt,
        byteLength: r.data.byteLength,
        checksum: new DataView(r.data).getUint32(16, true),
        // The literal bytes. "Byte for byte" is the claim; a length plus a checksum is
        // not it.
        bytes: Buffer.from(new Uint8Array(r.data)).toString('hex'),
      }))
      .sort((a, b) => a.chunkKey.localeCompare(b.chunkKey)),
    manifests: manifests.sort((a, b) => a.worldName.localeCompare(b.worldName)),
  };
}

/** Records in the shape `ChunkStorage.saveChunk` / `flushDirty` write (DEPLOY.md §2.1). */
function seedRecords() {
  // Distinct block contents per chunk, and that is not decoration: an empty `new Chunk`
  // RLE-encodes to the same bytes whatever its coordinates are, so three empty chunks
  // would share one payload and "the records survived" would be satisfied by any three
  // records at all.
  const specs = [
    { cx: 0, cz: 0, world: 'probe-world-A', fill: 1 },
    { cx: -3, cz: 7, world: 'probe-world-A', fill: 3 },
    { cx: 12, cz: -8, world: 'probe-world-B', fill: 5 },
  ];

  const chunks = specs.map(({ cx, cz, world, fill }) => {
    const c = new Chunk(cx, cz);
    for (let x = 0; x < fill; x++) {
      for (let z = 0; z < fill; z++) c.setBlock(x, 64, z, BLOCK_TYPES.STONE);
    }
    return {
      chunkKey: `${world}:${cx},${cz}`,   // _storeKey(): world-scoped primary key (H-1)
      worldName: world,
      data: ChunkBinaryCodec.encode(c),   // the REAL encoder, not hand-written bytes
      savedAt: 1700000000000 + cx,
      blocks: c.blocks,                   // kept out of the record; used by the round-trip check
    };
  });

  const manifestFor = (world) => ({
    worldName: world,                     // keyPath of STORE_MANIFESTS
    seed: '424242',
    createdAt: 1699999999000,
    lastPlayed: 1700000000500,
    playerCount: 1,
    spawnPoint: { x: 0, y: 68, z: 0 },
    generatedChunks: chunks
      .filter((c) => c.worldName === world)
      .map((c) => ({ key: c.chunkKey.split(':')[1], checksum: new DataView(c.data).getUint32(16, true) })),
  });

  return { chunks, manifests: [manifestFor('probe-world-A'), manifestFor('probe-world-B')] };
}

// ─── The run ──────────────────────────────────────────────────────────────────

const state = {
  seed: null, seedVersion: null, seedStores: null, seedApplied: null, seedIndexes: null,
  before: null, after: null, afterVersion: null, afterStores: null,
  upgrade: { deletes: [], applied: null },
  indexAfter: null, dbNamesWhileOpen: null,
};

describe('storage upgrade — a populated v2 database survives a version increment (D-80)', () => {
  beforeAll(async () => {
    // A leftover from an interrupted run would make the whole file meaningless.
    await del(PROBE_DB);

    // ── Seed: version 2, built by the shipped ladder (steps 1 then 2).
    const seedSpy = { deletes: [], applied: null };
    let db = await openProbe(2, { spy: seedSpy });
    state.seedVersion = db.version;
    state.seedStores = Array.from(db.objectStoreNames).sort();
    state.seedApplied = seedSpy.applied;

    state.seed = seedRecords();
    const tx = db.transaction([STORE_CHUNKS, STORE_MANIFESTS], 'readwrite');
    state.seedIndexes = Array.from(tx.objectStore(STORE_CHUNKS).indexNames).sort();
    for (const c of state.seed.chunks) {
      const { blocks, ...record } = c;   // eslint-disable-line no-unused-vars
      tx.objectStore(STORE_CHUNKS).put(record);
    }
    for (const m of state.seed.manifests) tx.objectStore(STORE_MANIFESTS).put(m);
    await new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(new Error('seed transaction aborted'));
    });

    state.before = await readAll(db);
    db.close();

    // ── The increment: 2 → 3, through the shipped ladder.
    //
    // Version 3 has no step in shipped code by design (rule 2: an unregistered version
    // throws), so one is registered for the duration of the open — the worked example of
    // the DEPLOY.md §2.1 procedure. It creates a REAL object store, because "the upgrade
    // did nothing" would prove nothing.
    db = await openProbe(3, {
      spy: state.upgrade,
      step: (d) => ensureStore(d, PROBE_STORE, { keyPath: 'id' }),
    });
    state.afterVersion = db.version;
    state.afterStores = Array.from(db.objectStoreNames).sort();
    state.after = await readAll(db);

    // The pre-existing index, used the way the code uses it.
    const idxTx = db.transaction([STORE_CHUNKS], 'readonly');
    const store = idxTx.objectStore(STORE_CHUNKS);
    state.indexAfter = Array.from(store.indexNames).sort();
    state.byWorldA = await new Promise((resolve, reject) => {
      const q = store.index('worldName').getAll('probe-world-A');
      q.onsuccess = () => resolve(q.result || []);
      q.onerror = () => reject(q.error);
    });

    state.dbNamesWhileOpen = (await indexedDB.databases()).map((d) => d.name).sort();
    db.close();
  });

  afterAll(async () => {
    await del(PROBE_DB);
    console.log(`Results: ${PASSED}/${PASSED + FAILED} passed, ${FAILED} failed`);
  });

  it('seeds a version-2 database in the shape the shipped code writes', () => {
    check(state.seedVersion, 'the seed database is at version 2').toBe(2);
    check(state.seedApplied, 'a fresh database runs ladder steps 1 then 2, in order').toEqual([1, 2]);
    check(state.seedStores, 'the shipped ladder creates exactly the two DEPLOY.md §2.1 stores')
      .toEqual([STORE_CHUNKS, STORE_MANIFESTS].sort());
    check(state.seedIndexes, 'the chunks store carries the worldName index (DEPLOY.md §2.1)')
      .toEqual(['worldName']);
    check(state.before.chunks.length, 'three chunk records were seeded').toBe(3);
    check(state.before.manifests.length, 'two manifest records were seeded').toBe(2);
    check(
      new Set(state.before.chunks.map((c) => c.checksum)).size,
      'the three seeded chunks carry three DIFFERENT payloads, so the survival comparison ' +
      'below discriminates between records instead of being satisfied by any three all-air chunks'
    ).toBe(3);
    check(
      state.before.chunks.map((c) => c.chunkKey),
      'every seeded chunk uses the world-scoped primary key _storeKey() writes (H-1)'
    ).toEqual(['probe-world-A:-3,7', 'probe-world-A:0,0', 'probe-world-B:12,-8']);
  });

  it('runs the real 2 → 3 ladder and lands at version 3 with the new store ALONGSIDE the old two', () => {
    check(state.upgrade.applied, 'only the step for version 3 ran — 1 and 2 are not replayed').toEqual([3]);
    check(state.afterVersion, 'the database is at version 3 afterwards').toBe(3);
    check(
      state.afterStores,
      'H-2 — the new store was added alongside the existing two: a real schema change, not a no-op'
    ).toEqual([STORE_CHUNKS, STORE_MANIFESTS, PROBE_STORE].sort());
  });

  it('is a MIGRATION, not a delete-and-recreate', () => {
    check(
      state.upgrade.deletes,
      'H-2 — the upgrade called deleteObjectStore on nothing. The pre-6d handler deleted every ' +
      'store here and recreated it empty, which leaves the same store NAMES behind — which is why ' +
      'this counts calls instead of comparing store lists'
    ).toEqual([]);
    check(state.after.chunks.length, 'all three chunk records are still there after the increment').toBe(3);
    check(state.after.manifests.length, 'both manifest records are still there after the increment').toBe(2);
    check(state.indexAfter, 'the worldName index survived the increment').toEqual(['worldName']);
    check(
      state.byWorldA.map((r) => r.chunkKey).sort(),
      'the surviving index still resolves its two world-A records — the store was not rebuilt under it'
    ).toEqual(['probe-world-A:-3,7', 'probe-world-A:0,0']);
  });

  it('preserves every chunk and every manifest record byte for byte', () => {
    check(
      state.after.chunks,
      'H-2 FIXED — every chunk record survives the increment byte for byte: same world-scoped keys, ' +
      'same worldName, same savedAt, same payload bytes. Pre-6d this was 3 → 0.'
    ).toEqual(state.before.chunks);
    check(
      state.after.manifests,
      'H-2 FIXED — every manifest survives, generatedChunks checksums included, so the load-time ' +
      'integrity check in _batchEnsureChunks keeps its baseline'
    ).toEqual(state.before.manifests);

    // And the surviving bytes are still bytes the REAL decoder accepts — a comparison of
    // two equally-corrupted buffers would satisfy the check above.
    for (const seeded of state.seed.chunks) {
      const stored = state.after.chunks.find((c) => c.chunkKey === seeded.chunkKey);
      const decoded = ChunkBinaryCodec.decode(
        new Uint8Array(Buffer.from(stored.bytes, 'hex')).buffer
      );
      check(
        Array.from(decoded.blocks),
        `${seeded.chunkKey} still decodes through the shipped codec to the blocks it was encoded from ` +
        '(checksum verified inside decode(), so a single flipped byte throws here)'
      ).toEqual(Array.from(seeded.blocks));
    }
  });

  it('never touches the live cuubz-worlds database, and leaves nothing behind', async () => {
    check(DB_VERSION, 'DB_VERSION in src/ is still 2 — this file drives version 3 on a probe only').toBe(2);
    check(PROBE_DB, 'the probe database is not the live one').not.toBe(DB_NAME);
    check(state.dbNamesWhileOpen, 'while the probe was open, it was the ONLY database in existence')
      .toEqual([PROBE_DB]);
    check(
      state.dbNamesWhileOpen.includes(DB_NAME),
      `no database named '${DB_NAME}' was ever created by this file`
    ).toBe(false);

    // afterAll has not run yet; delete here so the "leaves nothing behind" claim is
    // asserted rather than asserted-by-comment. The afterAll delete is then a no-op.
    await del(PROBE_DB);
    const remaining = (await indexedDB.databases()).map((d) => d.name);
    check(remaining, 'the probe database is gone and nothing else was created').toEqual([]);
  });
});
