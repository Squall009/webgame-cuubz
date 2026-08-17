/**
 * Cuubz — Chunk Storage Integrity Tests (PR 6c, PR 6d)
 *
 * Covers the three things PR 6c changed about the bytes on a player's disk:
 *
 *   1. The world-scoped storage key (H-1). Chunk `(0,0)` used to be ONE shared
 *      record across every world slot, so one visit to a second world destroyed
 *      1,073 of the first world's 1,184 saved chunks — measured, not inferred
 *      (DEPLOY.md §7.1).
 *   2. The runtime migration that re-keys already-saved chunks, at DB_VERSION 2,
 *      because `onupgradeneeded` deletes every object store (H-2) and so cannot be
 *      used to migrate anything.
 *   3. The corrected chunk buffer size (D-15), including the backward-compatibility
 *      property the fix depends on: a 2×-padded chunk written by the old encoder
 *      still decodes identically.
 *
 * PR 6d added sections 16-22: the schema version ladder that replaces H-2's
 * delete-everything upgrade handler. Section 17 is PR 6d's accept criterion —
 * DB_VERSION incremented against a SEEDED, pre-existing v2 database, with every
 * chunk and manifest asserted to survive. `npm run test:e2e` runs the same
 * increment against real IndexedDB in a real browser; this one runs in CI.
 *
 * WHY A HAND-ROLLED IndexedDB STUB
 * --------------------------------
 * `fake-indexeddb` is not a dependency and adding one to Phase 0 for a single test
 * file is not worth the supply-chain surface — refactor.md §11 PR 32 is where it
 * arrives, together with the rest of the persistence suite. The stub below is ~70
 * lines and models the two behaviours these tests actually depend on: requests
 * complete asynchronously, and a transaction does not complete until work queued
 * from inside a request handler has also drained. The migration relies on exactly
 * that (its `put`/`delete` are issued from inside a `get`'s `onsuccess`), so a stub
 * that resolved everything synchronously would pass while the real thing failed.
 *
 * It also counts issued operations, which is how D-17 — `deleteChunk` issuing two
 * delete requests per call — is asserted rather than eyeballed.
 */

import { it } from 'vitest';
import { legacy } from '../../helpers/legacy.js';
import '../../../src/util/Logger.js';
import { Chunk, BLOCK_TYPES } from '../../../src/engine/world/ChunkData.js';
import { ChunkBinaryCodec } from '../../../src/engine/world/ChunkBinaryCodec.js';
import { ChunkManager } from '../../../src/engine/world/ChunkManager.js';

it('chunkStorage', () => legacy(async () => {

let passCount = 0;
let failCount = 0;
const failures = [];

function assert(condition, message) {
  if (condition) {
    passCount++;
  } else {
    failCount++;
    failures.push(message);
    console.log(`FAIL: ${message}`);
  }
}

function assertEquals(actual, expected, message) {
  assert(actual === expected, `${message} (expected ${expected}, got ${actual})`);
}

// ── Minimal async IndexedDB stub ────────────────────────────────

const KEY_PATHS = { chunks: 'chunkKey', manifests: 'worldName' };

function createFakeDB(chunkRecords = [], manifestRecords = []) {
  const data = {
    chunks: new Map(chunkRecords.map(r => [r.chunkKey, r])),
    manifests: new Map(manifestRecords.map(r => [r.worldName, r])),
  };
  // Per-database schema, so the upgrade-ladder tests (PR 6d) can create stores and
  // indexes on a database that already holds records — which is the only way to
  // assert that an upgrade does not touch them.
  const keyPaths = Object.assign({}, KEY_PATHS);
  const indexes = { chunks: new Set(['worldName']), manifests: new Set() };
  const schemaOps = [];
  const ops = { get: 0, getAllKeys: 0, put: 0, delete: 0, count: 0, transactions: 0 };

  function transaction(names, mode = 'readonly') {
    const inTx = Array.isArray(names) ? names.slice() : [names];
    ops.transactions++;
    const tx = { mode, error: null, oncomplete: null, onerror: null, onabort: null };

    let pending = 0;
    let completed = false;

    // Completion is checked on a later tick every time the queue empties. A handler
    // that queues more work bumps `pending` back up before that check runs, which is
    // the property the migration depends on.
    const settle = () => setTimeout(() => {
      if (pending === 0 && !completed) {
        completed = true;
        if (tx.oncomplete) tx.oncomplete();
      }
    }, 0);

    const step = (req, fn) => {
      pending++;
      setTimeout(() => {
        try {
          fn();
          if (req.onsuccess) req.onsuccess({ target: req });
        } catch (err) {
          req.error = err;
          tx.error = err;
          if (req.onerror) req.onerror({ target: req });
          else if (tx.onerror) tx.onerror();
        }
        pending--;
        settle();
      }, 0);
      return req;
    };

    tx.objectStore = (name) => {
      if (!inTx.includes(name)) throw new Error(`objectStore("${name}") outside the transaction's scope`);
      const map = data[name];
      const kp = keyPaths[name];
      const requireWrite = () => {
        if (mode !== 'readwrite') throw new Error('write attempted on a readonly transaction');
      };
      return {
        transaction: tx,
        keyPath: kp,
        get(key) {
          ops.get++;
          const req = {};
          return step(req, () => { req.result = map.get(key); });
        },
        getAllKeys() {
          ops.getAllKeys++;
          const req = {};
          return step(req, () => { req.result = [...map.keys()].sort(); });
        },
        put(record) {
          ops.put++;
          const req = {};
          return step(req, () => { requireWrite(); map.set(record[kp], record); });
        },
        delete(key) {
          ops.delete++;
          const req = {};
          return step(req, () => { requireWrite(); map.delete(key); });
        },
        count(key) {
          ops.count++;
          const req = {};
          return step(req, () => { req.result = key === undefined ? map.size : (map.has(key) ? 1 : 0); });
        },
      };
    };

    settle(); // a transaction with no requests still completes
    return tx;
  }

  // ── Schema surface, for the PR 6d upgrade-ladder tests ──────────
  //
  // `onupgradeneeded` gets a synchronous `db` plus the versionchange transaction,
  // and can only create/delete stores and indexes. That is a completely different
  // surface from the async request API above, so it is modelled separately — and
  // every schema operation is recorded, because "the upgrade deleted nothing" is
  // the assertion H-2 needs and it is invisible in the resulting data.
  const schemaStore = (name) => ({
    name,
    keyPath: keyPaths[name],
    indexNames: { contains: (i) => indexes[name].has(i) },
    createIndex(indexName) {
      schemaOps.push(`createIndex:${name}.${indexName}`);
      indexes[name].add(indexName);
    },
  });

  const db = {
    name: 'cuubz-worlds',
    version: 2,
    transaction,
    close() {},
    objectStoreNames: {
      contains: (n) => Object.prototype.hasOwnProperty.call(data, n),
      get length() { return Object.keys(data).length; },
    },
    createObjectStore(name, options) {
      if (Object.prototype.hasOwnProperty.call(data, name)) {
        throw new Error(`ConstraintError: object store "${name}" already exists`);
      }
      schemaOps.push(`createObjectStore:${name}`);
      data[name] = new Map();
      keyPaths[name] = options && options.keyPath;
      indexes[name] = new Set();
      return schemaStore(name);
    },
    deleteObjectStore(name) {
      schemaOps.push(`deleteObjectStore:${name}`);
      delete data[name];
      delete keyPaths[name];
      delete indexes[name];
    },
    _data: data,
    _ops: ops,
    _schemaOps: schemaOps,
    _indexes: indexes,
    /** The versionchange transaction `onupgradeneeded` would receive. */
    _versionChangeTx: { objectStore: (name) => schemaStore(name) },
    /** Remove a store WITHOUT logging it — for constructing a damaged starting state. */
    _dropStoreSilently(name) { delete data[name]; delete keyPaths[name]; delete indexes[name]; },
  };

  return db;
}

/** Drive the real upgrade handler against a stub database. */
function upgrade(db, oldVersion, newVersion) {
  return ChunkManager._applySchemaUpgrade(db, db._versionChangeTx, oldVersion, newVersion);
}

/** A ChunkManager wired to a stub DB, with _openDB already satisfied. */
function managerOn(db, worldName) {
  const cm = new ChunkManager({ worldName });
  cm._db = db;
  cm._dbReady = Promise.resolve(db);
  return cm;
}

function chunkRecord(chunkKey, worldName, data) {
  return { chunkKey, worldName, data: data || ChunkBinaryCodec.encode(new Chunk(0, 0)), savedAt: 1 };
}

// ── Tests ───────────────────────────────────────────────────────

async function run() {
  console.log('\n=== Chunk storage integrity (PR 6c, PR 6d) ===\n');

  // ── 1. The logical key is unchanged ──────────────────────────
  //
  // DEPLOY.md §2.1 lists `${cx},${cz}` as an invariant, and 17 call sites plus the
  // manifest format and the worker protocol depend on it. PR 6c introduced a
  // SEPARATE storage key precisely so this one could stay put.
  {
    assertEquals(ChunkManager.key(-3, 7), '-3,7', 'ChunkManager.key is still the bare `${cx},${cz}`');
    assertEquals(ChunkManager.key(0, 0), '0,0', 'ChunkManager.key(0,0)');
    const parsed = ChunkManager.parseKey('-3,7');
    assert(parsed.cx === -3 && parsed.cz === 7, 'parseKey round-trips the logical key');
  }

  // ── 2. The storage key helper ────────────────────────────────
  {
    const cm = new ChunkManager({ worldName: 'world-abc' });
    assertEquals(cm._storeKey('0,0'), 'world-abc:0,0', '_storeKey prefixes the world name');
    assertEquals(cm._storeKey('-3,7'), 'world-abc:-3,7', '_storeKey handles negative coordinates');
    assertEquals(ChunkManager.worldKeyPrefix('world-abc'), 'world-abc:', 'worldKeyPrefix is the world name plus a colon');
    assert(cm._storeKey('0,0').startsWith(ChunkManager.worldKeyPrefix('world-abc')),
      'Every storage key of a world starts with that world\'s prefix — what makes deletion a key range');

    // The default matters: a ChunkManager built with no worldName used to write into
    // the same global keyspace as everyone else. It now gets its own namespace.
    assertEquals(new ChunkManager({})._storeKey('0,0'), 'default:0,0', 'The default world name is namespaced too');

    // Two worlds cannot collide at the same coordinates. This is H-1 in one line.
    const a = new ChunkManager({ worldName: 'world-A' });
    const b = new ChunkManager({ worldName: 'world-B' });
    assert(a._storeKey('0,0') !== b._storeKey('0,0'),
      'Two worlds produce DIFFERENT storage keys for chunk (0,0) — the H-1 collision is gone');
  }

  // ── 3. isWorldScopedStoreKey discriminates pre- from post-migration ──
  {
    assertEquals(ChunkManager.isWorldScopedStoreKey('w1:0,0'), true, 'A scoped key is recognised');
    assertEquals(ChunkManager.isWorldScopedStoreKey('0,0'), false, 'A bare key is recognised as unmigrated');
    assertEquals(ChunkManager.isWorldScopedStoreKey('-3,7'), false, 'A bare negative key is recognised as unmigrated');
    // A world id containing a colon still yields a key containing a colon, so the
    // discriminator holds whatever the id looks like.
    assertEquals(ChunkManager.isWorldScopedStoreKey('a:b:0,0'), true, 'A world id with a colon is still scoped');
    assertEquals(ChunkManager.isWorldScopedStoreKey(undefined), false, 'A non-string key is not scoped');
    assertEquals(ChunkManager.isWorldScopedStoreKey(42), false, 'A numeric key is not scoped');
  }

  // ── 4. The four single-record boundary sites use the scoped key ──
  {
    const db = createFakeDB();
    const cm = managerOn(db, 'w1');
    const buf = ChunkBinaryCodec.encode(new Chunk(0, 0));

    await cm.saveChunk('0,0', buf);
    assertEquals([...db._data.chunks.keys()].join(','), 'w1:0,0', 'saveChunk writes under the world-scoped key');
    assertEquals(db._data.chunks.get('w1:0,0').worldName, 'w1', 'saveChunk still records the worldName field');

    assertEquals(await cm.hasChunk('0,0'), true, 'hasChunk finds the chunk it just wrote');
    assert((await cm.loadChunk('0,0')) === buf, 'loadChunk returns the stored buffer');

    // The proof that the scoping is real: a second world must NOT see it.
    const other = managerOn(db, 'w2');
    assertEquals(await other.hasChunk('0,0'), false, 'A second world does not see world 1\'s chunk (0,0)');
    assertEquals(await other.loadChunk('0,0'), null, 'A second world loads null for chunk (0,0)');

    await other.saveChunk('0,0', ChunkBinaryCodec.encode(new Chunk(0, 0)));
    assertEquals(db._data.chunks.size, 2, 'Both worlds\' chunk (0,0) coexist as two records, not one');
    assert((await cm.loadChunk('0,0')) === buf, 'World 1\'s bytes are untouched after world 2 saved the same coordinates');

    // D-17 — one delete request per deleteChunk call, not two.
    const deletesBefore = db._ops.delete;
    await cm.deleteChunk('0,0');
    assertEquals(db._ops.delete - deletesBefore, 1, 'D-17 — deleteChunk issues exactly ONE delete request');
    assertEquals(await cm.hasChunk('0,0'), false, 'deleteChunk removed world 1\'s record');
    assertEquals(await other.hasChunk('0,0'), true, 'deleteChunk did not touch world 2\'s record at the same coordinates');
  }

  // ── 5. _batchLoadChunks keys results by the LOGICAL key ──────
  //
  // Its caller looks results up by the key it passed in, so the storage key must not
  // leak out of this method.
  {
    const db = createFakeDB();
    const cm = managerOn(db, 'w1');
    const buf = ChunkBinaryCodec.encode(new Chunk(1, 2));
    await cm.saveChunk('1,2', buf);

    const results = await cm._batchLoadChunks(['1,2', '9,9']);
    assert(results.has('1,2'), '_batchLoadChunks keys hits by the logical key');
    assert(results.has('9,9'), '_batchLoadChunks reports misses too');
    assertEquals(results.get('9,9'), null, 'A miss is null');
    assert(results.get('1,2').data === buf, 'A hit carries the stored buffer');
    assertEquals(results.get('1,2').worldName, 'w1', 'A hit carries the record\'s worldName for the ownership check');
    assertEquals(results.get('1,2').checksum, new DataView(buf).getUint32(16, true),
      'A hit carries the header checksum read from offset 16');
  }

  // ── 6. The migration ─────────────────────────────────────────
  {
    const db = createFakeDB([
      chunkRecord('0,0', 'world-A'),
      chunkRecord('1,0', 'world-A'),
      chunkRecord('-3,7', 'world-B'),
    ]);
    const cm = managerOn(db, 'world-A');

    const result = await cm._migrateToWorldScopedKeys(db);
    assertEquals(result.migrated, 3, 'Migration re-keyed all three records');
    assertEquals(result.unclaimed, 0, 'Nothing was left unattributed');
    assertEquals(db._data.chunks.size, 3, 'The record count is unchanged — re-keyed, not duplicated or dropped');
    assertEquals([...db._data.chunks.keys()].sort().join(' '), 'world-A:0,0 world-A:1,0 world-B:-3,7',
      'Every record moved under ITS OWN worldName, not the migrating manager\'s');
    assertEquals(db._data.chunks.has('0,0'), false, 'The old bare row is gone');
    assertEquals(db._data.chunks.get('world-A:0,0').chunkKey, 'world-A:0,0',
      'The record\'s own chunkKey field was rewritten to match its new primary key');
    assertEquals(db._data.chunks.get('world-A:0,0').savedAt, 1, 'savedAt is preserved — the record was moved, not rewritten');
  }

  // ── 7. Migration idempotency ─────────────────────────────────
  //
  // It runs on every world entry, so a second pass over a migrated database must do
  // nothing at all — not "the same thing again harmlessly", nothing.
  {
    const db = createFakeDB([chunkRecord('0,0', 'world-A')]);
    const cm = managerOn(db, 'world-A');

    await cm._migrateToWorldScopedKeys(db);
    const opsAfterFirst = { put: db._ops.put, delete: db._ops.delete };
    const bytes = db._data.chunks.get('world-A:0,0').data;

    const second = await cm._migrateToWorldScopedKeys(db);
    assertEquals(second.migrated, 0, 'A second migration re-keys nothing');
    assertEquals(db._ops.put - opsAfterFirst.put, 0, 'A second migration issues no writes');
    assertEquals(db._ops.delete - opsAfterFirst.delete, 0, 'A second migration issues no deletes');
    assertEquals(db._data.chunks.size, 1, 'The store is unchanged by the second pass');
    assert(db._data.chunks.get('world-A:0,0').data === bytes, 'The stored bytes are the same object — untouched');

    const third = await cm._migrateToWorldScopedKeys(db);
    assertEquals(third.migrated, 0, 'A third migration is also a no-op');
  }

  // ── 8. A record with no worldName cannot be attributed ───────
  //
  // Guessing would put one world's terrain into another — the exact failure H-1 is.
  // It is left in place, counted, and left unreachable: no read path can serve a
  // bare key any more.
  {
    const db = createFakeDB([
      chunkRecord('0,0', 'world-A'),
      { chunkKey: '5,5', data: ChunkBinaryCodec.encode(new Chunk(5, 5)), savedAt: 1 }, // no worldName
      { chunkKey: '6,6', worldName: '', data: ChunkBinaryCodec.encode(new Chunk(6, 6)), savedAt: 1 }, // empty worldName
    ]);
    const cm = managerOn(db, 'world-A');

    const result = await cm._migrateToWorldScopedKeys(db);
    assertEquals(result.migrated, 1, 'Only the attributable record migrated');
    assertEquals(result.unclaimed, 2, 'Both unattributable records were counted');
    assertEquals(db._data.chunks.has('5,5'), true, 'A record with no worldName is LEFT IN PLACE, not deleted');
    assertEquals(db._data.chunks.has('6,6'), true, 'A record with an empty worldName is left in place too');
    assertEquals(db._data.chunks.has('world-A:0,0'), true, 'The attributable record still migrated correctly');
    assertEquals(await cm.hasChunk('5,5'), false, 'An unattributable record is unreachable — no read path serves bare keys');

    // And the unattributable rows must not make the migration re-run forever or
    // report progress it did not make.
    const second = await cm._migrateToWorldScopedKeys(db);
    assertEquals(second.migrated, 0, 'A second pass still migrates nothing');
    assertEquals(second.unclaimed, 2, 'A second pass reports the same two unattributable records');
  }

  // ── 9. A mixed database — half migrated, half not ────────────
  //
  // The state a crash or a closed tab mid-migration leaves behind.
  {
    const db = createFakeDB([
      chunkRecord('world-A:0,0', 'world-A'),
      chunkRecord('1,0', 'world-A'),
    ]);
    const cm = managerOn(db, 'world-A');
    const result = await cm._migrateToWorldScopedKeys(db);
    assertEquals(result.migrated, 1, 'Only the un-migrated record was touched');
    assertEquals(db._data.chunks.size, 2, 'Both records are present');
    assertEquals([...db._data.chunks.keys()].sort().join(' '), 'world-A:0,0 world-A:1,0', 'The store is fully migrated');
  }

  // ── 10. An empty store ───────────────────────────────────────
  {
    const db = createFakeDB();
    const cm = managerOn(db, 'world-A');
    const result = await cm._migrateToWorldScopedKeys(db);
    assertEquals(result.migrated, 0, 'An empty store migrates nothing');
    assertEquals(db._ops.transactions, 1, 'An empty store costs exactly one read transaction — no write transaction is opened');
  }

  // ── 11. Migration runs before any read can see the store ─────
  //
  // The load-bearing sequencing property: _openDB is what all seven boundary sites
  // await, so hanging the migration off it is what guarantees no read observes a
  // half-migrated store.
  {
    const db = createFakeDB([chunkRecord('0,0', 'world-A')]);
    const savedIDB = global.indexedDB;
    global.indexedDB = {
      open(name, version) {
        const req = {};
        setTimeout(() => { req.result = db; if (req.onsuccess) req.onsuccess({ target: req }); }, 0);
        return req;
      },
    };
    try {
      const cm = new ChunkManager({ worldName: 'world-A' });
      // The very first thing a caller does is await _openDB, then read.
      const data = await cm.loadChunk('0,0');
      assert(data !== null && data !== undefined,
        'The first read after opening the DB finds a pre-migration chunk — migration ran first');
      assertEquals(db._data.chunks.has('world-A:0,0'), true, 'The record was re-keyed during the open');
      assertEquals(db._data.chunks.has('0,0'), false, 'The bare row is gone after the open');

      // _dbReady memoizes, so a second open must not re-scan.
      const scansBefore = db._ops.getAllKeys;
      await cm.loadChunk('0,0');
      assertEquals(db._ops.getAllKeys - scansBefore, 0, 'A memoized _openDB does not re-scan for legacy keys');
    } finally {
      if (savedIDB === undefined) delete global.indexedDB; else global.indexedDB = savedIDB;
    }
  }

  // ── 12. _mergeManifestEntries ────────────────────────────────
  //
  // Shared by the three checksum writers so they cannot drift; the load-time check
  // only works if every writer records checksums the same way.
  {
    const merged = ChunkManager._mergeManifestEntries(['0,0', { key: '1,0', checksum: 7 }], [
      { key: '1,0', checksum: 9 },
      { key: '2,0', checksum: 11 },
    ]);
    assertEquals(merged.length, 3, 'Merge updates in place and appends what is new');
    assertEquals(merged[0].key, '0,0', 'A legacy string entry is normalised to an object');
    assertEquals(merged[0].checksum, null, 'A legacy entry has no recoverable checksum, so it is null');
    assertEquals(merged[1].checksum, 9, 'An existing entry\'s checksum is replaced');
    assertEquals(merged[2].checksum, 11, 'A new entry is appended');
    assertEquals(ChunkManager._mergeManifestEntries(undefined, [{ key: '0,0', checksum: 1 }]).length, 1,
      'An absent generatedChunks list is treated as empty');
  }

  // ── 13. D-15 — the corrected buffer size, exactly ────────────
  {
    const chunk = new Chunk(0, 0);
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        chunk.setBlock(x, 64, z, BLOCK_TYPES.GRASS);
        chunk.setBlock(x, 63, z, BLOCK_TYPES.DIRT);
      }
    }

    const encoded = ChunkBinaryCodec.encode(chunk);
    const runCount = new DataView(encoded).getUint32(12, true);
    assert(runCount > 0, `The encoded chunk has runs (${runCount})`);
    assertEquals(encoded.byteLength, 20 + runCount * 4,
      'D-15 — the buffer is exactly HEADER_SIZE + runs × 4 bytes, with no padding');
    assertEquals(ChunkBinaryCodec.estimateSize(chunk), encoded.byteLength,
      'D-15 — estimateSize agrees with encode() exactly (it used to over-report 2×)');

    // Nothing was lost by shrinking it.
    const decoded = ChunkBinaryCodec.decode(encoded);
    let same = true;
    for (let i = 0; i < chunk.blocks.length; i++) {
      if (chunk.blocks[i] !== decoded.blocks[i]) { same = false; break; }
    }
    assert(same, 'A tightly-sized chunk round-trips every block');

    // The smallest possible chunk, and it is TWO runs rather than one: a chunk holds
    // 16 × 16 × 256 = 65,536 blocks and a run's count is a Uint16 capped at 65,535
    // (`_rleEncode16`'s `count < 0xFFFF` guard), so even all-air needs a second run
    // for the last block. Worth pinning: it is the exact case an off-by-one in the
    // size arithmetic would land on.
    const empty = ChunkBinaryCodec.encode(new Chunk(0, 0));
    assertEquals(new DataView(empty).getUint32(12, true), 2, 'An all-air chunk RLE-encodes to two runs (65,536 blocks, Uint16 count cap)');
    assertEquals(empty.byteLength, 28, 'An all-air chunk is 28 bytes: 20 header + two 4-byte runs');
  }

  // ── 14. D-15 backward compatibility — old padded chunks still load ──
  //
  // This is the property that makes the fix shippable against live player data:
  // decode() never consults the buffer length, it stops after `blockRunCount` runs.
  // The padded buffer built here is byte-for-byte what the OLD encoder produced,
  // checksum included — the checksum spans the whole data portion, so a padded chunk
  // and a tight one carry DIFFERENT checksums for the same blocks, and both verify.
  {
    const chunk = new Chunk(3, -4);
    for (let x = 0; x < 16; x++) chunk.setBlock(x, 10, 0, BLOCK_TYPES.STONE);

    const tight = ChunkBinaryCodec.encode(chunk);
    const runCount = new DataView(tight).getUint32(12, true);

    // Reproduce the pre-6c allocation: HEADER + blockRuns.length * 4, i.e. double the
    // payload, zero-filled, with the checksum recomputed over the padded data portion.
    const padded = new ArrayBuffer(20 + runCount * 4 * 2);
    new Uint8Array(padded).set(new Uint8Array(tight), 0);
    const paddedView = new DataView(padded);
    paddedView.setUint32(16, ChunkBinaryCodec.computeChecksum(new Uint8Array(padded, 20)), true);

    assertEquals(padded.byteLength, tight.byteLength * 2 - 20, 'The reconstructed padded buffer is the old 2× size');
    assert(paddedView.getUint32(16, true) !== new DataView(tight).getUint32(16, true),
      'A padded chunk and a tight chunk carry different checksums — the fix does change stored bytes');

    let decodedPadded = null;
    try {
      decodedPadded = ChunkBinaryCodec.decode(padded);
    } catch (err) {
      assert(false, `An old 2×-padded chunk still decodes (${err.message})`);
    }
    if (decodedPadded) {
      assert(true, 'An old 2×-padded chunk still decodes after the D-15 fix');
      const decodedTight = ChunkBinaryCodec.decode(tight);
      let identical = true;
      for (let i = 0; i < decodedTight.blocks.length; i++) {
        if (decodedTight.blocks[i] !== decodedPadded.blocks[i]) { identical = false; break; }
      }
      assert(identical, 'A padded chunk and a tight chunk decode to identical blocks — the fix is transparent on load');
      assertEquals(decodedPadded.cx, 3, 'The padded chunk\'s coordinates survive');
      assertEquals(decodedPadded.cz, -4, 'The padded chunk\'s negative coordinate survives');
    }
  }

  // ── 15. The manifest store was already world-keyed — leave it ──
  {
    const db = createFakeDB([], [{ worldName: 'world-A', seed: '1', generatedChunks: [] }]);
    const cm = managerOn(db, 'world-A');
    const manifest = await cm.loadManifest();
    assert(manifest !== null, 'loadManifest reads the manifest keyed by worldName');
    assertEquals(manifest.worldName, 'world-A', 'The manifest primary key is the world name, unchanged by PR 6c');
    assertEquals(await managerOn(db, 'world-B').loadManifest(), null, 'A second world has no manifest of its own yet');
  }

  // ══════════════════════════════════════════════════════════════
  // PR 6d — the schema version ladder (H-2, H-3)
  // ══════════════════════════════════════════════════════════════
  //
  // `onupgradeneeded` used to enumerate every object store, `deleteObjectStore` all
  // of them and recreate them empty. Incrementing DB_VERSION by one destroyed every
  // saved world on every player's device. These tests assert the two properties that
  // replace it: an upgrade only ever CREATES, and a version with no registered step
  // fails loudly instead of silently marking the database migrated.
  //
  // "Deleted nothing" is asserted by counting the schema operations the handler
  // issued, not by inspecting the resulting data — a handler that deleted a store
  // and recreated it leaves exactly the same store names behind, which is precisely
  // how H-2 stayed invisible for the life of this file.

  // ── 16. A fresh database: 0 → 2 ──────────────────────────────
  {
    const db = createFakeDB();
    db._dropStoreSilently('chunks');
    db._dropStoreSilently('manifests');

    const applied = upgrade(db, 0, 2);
    assertEquals(applied.join(','), '1,2', 'A fresh database runs both steps, in order');
    assertEquals(db.objectStoreNames.contains('chunks'), true, 'The chunks store exists after a fresh upgrade');
    assertEquals(db.objectStoreNames.contains('manifests'), true, 'The manifests store exists after a fresh upgrade');
    assertEquals(db._data.chunks instanceof Map && db._data.chunks.size, 0, 'The new chunks store is empty');
    assertEquals(db._indexes.chunks.has('worldName'), true, 'The worldName index is created (DEPLOY.md §2.1)');
    assertEquals(db._schemaOps.filter(o => o.startsWith('deleteObjectStore')).length, 0,
      'H-2 — a fresh upgrade deletes no object store');
    assertEquals(db._schemaOps.filter(o => o.startsWith('createObjectStore')).length, 2,
      'Each store is created exactly ONCE across both steps — _ensureStore is idempotent, so step 2 re-running the base schema costs nothing');
  }

  // ── 17. THE ACCEPT CRITERION ─────────────────────────────────
  //
  // Increment DB_VERSION against a SEEDED, pre-existing v2 database and prove every
  // chunk and every manifest survives. Reasoning about it is what produced H-2 in
  // the first place; the comment on the old handler said it "handles schema changes
  // cleanly".
  //
  // The synthetic step 3 is a real schema change — a new object store — because
  // "the upgrade did nothing" would prove nothing. It is registered here and removed
  // afterwards, which is also the worked example of the procedure documented in
  // chunkmanager.js: add SCHEMA_STEPS[n+1], then increment DB_VERSION.
  {
    const chunkA = chunkRecord('world-A:0,0', 'world-A');
    const chunkB = chunkRecord('world-A:1,0', 'world-A');
    const chunkC = chunkRecord('world-B:-3,7', 'world-B');
    const manifest = { worldName: 'world-A', seed: '424242', generatedChunks: [{ key: '0,0', checksum: 7 }] };
    const db = createFakeDB([chunkA, chunkB, chunkC], [manifest]);
    const bytesBefore = chunkA.data;

    assert(ChunkManager.SCHEMA_STEPS[3] === undefined, 'Version 3 has no step registered in shipped code');
    ChunkManager.SCHEMA_STEPS[3] = (d) => ChunkManager._ensureStore(d, 'chunkIndex', { keyPath: 'id' });
    let applied;
    try {
      applied = upgrade(db, 2, 3);
    } finally {
      delete ChunkManager.SCHEMA_STEPS[3];
    }

    assertEquals(applied.join(','), '3', 'Only step 3 ran — steps 1 and 2 are not replayed over a v2 database');
    assertEquals(db.objectStoreNames.contains('chunkIndex'), true, 'The new store the step asked for exists');

    // The whole point.
    assertEquals(db._schemaOps.filter(o => o.startsWith('deleteObjectStore')).length, 0,
      'H-2 FIXED — incrementing DB_VERSION over a populated database deletes NO object store');
    assertEquals(db._data.chunks.size, 3, 'All three chunk records survive the version increment');
    assertEquals(db._data.manifests.size, 1, 'The manifest survives the version increment');
    assertEquals([...db._data.chunks.keys()].sort().join(' '), 'world-A:0,0 world-A:1,0 world-B:-3,7',
      'Every chunk kept its world-scoped primary key');
    assert(db._data.chunks.get('world-A:0,0').data === bytesBefore,
      'A surviving chunk holds the SAME buffer object — the upgrade moved nothing and re-encoded nothing');
    assertEquals(db._data.chunks.get('world-A:0,0').savedAt, 1, 'savedAt is untouched by the upgrade');
    assertEquals(db._data.manifests.get('world-A').generatedChunks[0].checksum, 7,
      'The manifest\'s recorded checksums survive, so the load-time integrity check still has its baseline');
    assertEquals(db._indexes.chunks.has('worldName'), true, 'The worldName index is still there after the increment');

    // And the records are still readable through the normal boundary sites, not just
    // present in the map.
    const cm = managerOn(db, 'world-A');
    assertEquals(await cm.hasChunk('0,0'), true, 'World A can still read its chunk (0,0) after the increment');
    assert((await cm.loadChunk('0,0')) === bytesBefore, 'loadChunk returns the same bytes it would have before the increment');
  }

  // ── 18. `_ensureStore` / `_ensureIndex` never clobber ────────
  {
    const db = createFakeDB([chunkRecord('world-A:0,0', 'world-A')]);
    const before = db._schemaOps.length;

    assertEquals(ChunkManager._ensureStore(db, 'chunks', { keyPath: 'chunkKey' }), null,
      '_ensureStore returns null for a store that already exists');
    ChunkManager._ensureIndex(db, db._versionChangeTx, 'chunks', 'worldName', 'worldName', { unique: false });
    assertEquals(db._schemaOps.length - before, 0, 'Neither helper issues an operation when the target is already present');
    assertEquals(db._data.chunks.size, 1, 'The existing record is untouched');

    // An index missing from a store that exists — a damaged database — is repaired.
    db._indexes.chunks.delete('worldName');
    ChunkManager._ensureIndex(db, db._versionChangeTx, 'chunks', 'worldName', 'worldName', { unique: false });
    assertEquals(db._indexes.chunks.has('worldName'), true, '_ensureIndex recreates an index that went missing');
    assertEquals(db._data.chunks.size, 1, 'Recreating the index did not disturb the records');

    // An index on a store that does not exist is skipped rather than throwing —
    // the store-creating step that follows in the same ladder will make it.
    db._dropStoreSilently('chunks');
    ChunkManager._ensureIndex(db, db._versionChangeTx, 'chunks', 'worldName', 'worldName', { unique: false });
    assert(true, '_ensureIndex on an absent store is a no-op, not a throw');
  }

  // ── 19. An unregistered version throws, and changes nothing ──
  //
  // Rule 2: throwing out of `onupgradeneeded` aborts the versionchange transaction,
  // so the database keeps its old version and all of its data. Bumping DB_VERSION
  // without writing the step is a development-time failure, not a silent
  // "this database claims v4 but has a v2 schema".
  {
    const db = createFakeDB([chunkRecord('world-A:0,0', 'world-A')], [{ worldName: 'world-A' }]);
    const opsBefore = db._schemaOps.length;
    let threw = null;
    try {
      upgrade(db, 2, 4);
    } catch (err) {
      threw = err;
    }
    assert(threw !== null, 'Upgrading to a version with no registered step throws');
    assert(/SCHEMA_STEPS\[3\]/.test(threw.message),
      `The error names the missing step so the fix is obvious (${threw && threw.message})`);
    assertEquals(db._schemaOps.length - opsBefore, 0, 'It throws BEFORE issuing any schema operation');
    assertEquals(db._data.chunks.size, 1, 'The chunk record is untouched by the failed upgrade');
    assertEquals(db._data.manifests.size, 1, 'The manifest is untouched by the failed upgrade');
  }

  // ── 20. H-3 — a version-1 database with no object stores ─────
  //
  // Exactly what `indexedDB.open('cuubz-worlds')` with no version used to create on a
  // device that had never played: version 1, zero stores. The old handler healed it
  // by accident (it deleted everything and recreated). The ladder heals it on
  // purpose, through the repair pass.
  {
    const db = createFakeDB();
    db._dropStoreSilently('chunks');
    db._dropStoreSilently('manifests');
    assertEquals(db.objectStoreNames.length, 0, 'The H-3 starting state: a version-1 database with no stores at all');

    const applied = upgrade(db, 1, 2);
    assertEquals(applied.join(','), '2', 'Only step 2 runs — the database already claims version 1');
    assertEquals(db.objectStoreNames.contains('chunks'), true, 'H-3 — the chunks store is created anyway');
    assertEquals(db.objectStoreNames.contains('manifests'), true, 'H-3 — the manifests store is created anyway');
    assertEquals(db._indexes.chunks.has('worldName'), true, 'H-3 — with its index');
    assertEquals(db._schemaOps.filter(o => o.startsWith('deleteObjectStore')).length, 0,
      'H-3 is repaired without deleting anything');
  }

  // ── 21. `openDatabase` is the single opener, and it names the version ──
  //
  // H-3's root cause was a SECOND opener that did not name a version. This asserts
  // the one that remains requests DB_VERSION and wires the ladder into
  // `onupgradeneeded` — the two properties `js/main.js` now depends on.
  {
    const db = createFakeDB();
    db._dropStoreSilently('chunks');
    db._dropStoreSilently('manifests');

    const savedIDB = global.indexedDB;
    let requestedName = null;
    let requestedVersion = null;
    global.indexedDB = {
      open(name, version) {
        requestedName = name;
        requestedVersion = version;
        const req = {};
        setTimeout(() => {
          req.result = db;
          if (req.onupgradeneeded) {
            req.onupgradeneeded({ target: { result: db, transaction: db._versionChangeTx }, oldVersion: 0, newVersion: version });
          }
          if (req.onsuccess) req.onsuccess({ target: req });
        }, 0);
        return req;
      },
    };
    try {
      const opened = await ChunkManager.openDatabase();
      assertEquals(requestedName, 'cuubz-worlds', 'openDatabase opens the DEPLOY.md §2.1 database name');
      assertEquals(requestedVersion, 2, 'openDatabase names DB_VERSION explicitly — never the no-version form that caused H-3');
      assert(opened === db, 'openDatabase resolves with the database');
      assertEquals(db.objectStoreNames.contains('chunks'), true, 'openDatabase wired the ladder into onupgradeneeded');
      assertEquals(db._schemaOps.filter(o => o.startsWith('deleteObjectStore')).length, 0,
        'H-2 — the opener that the game and the world-deletion path both use deletes nothing');
    } finally {
      if (savedIDB === undefined) delete global.indexedDB; else global.indexedDB = savedIDB;
    }
  }

  // ── 22. Every shipped step is create-only ────────────────────
  //
  // A guard on future edits rather than on current behaviour: run every registered
  // step against a database that already has everything and assert none of them
  // issues a delete or a create. A step added later that deletes a store fails here.
  {
    for (const version of Object.keys(ChunkManager.SCHEMA_STEPS).sort()) {
      const db = createFakeDB([chunkRecord('world-A:0,0', 'world-A')]);
      ChunkManager.SCHEMA_STEPS[version](db, db._versionChangeTx);
      assertEquals(db._schemaOps.length, 0,
        `SCHEMA_STEPS[${version}] issues no schema operation against a database that is already at that schema`);
      assertEquals(db._data.chunks.size, 1, `SCHEMA_STEPS[${version}] leaves existing records alone`);
    }
  }

  // ── 23. setRenderDistance recomputes the voxel region radius (D-66) ──
  //
  // `_voxelRegionRadius` is DERIVED from `renderDistance`: the constructor computes it
  // as `max(renderDistance + 2, min(32, regionRadius))`, and `_updateVoxelRegion` reads
  // it every few frames to decide which chunks are resident and which get generated.
  // `setRenderDistance` used to assign `renderDistance` and stop there, so every live
  // caller of the render-distance control (`PerformanceSettings.apply`, the pause menu,
  // the settings screen) moved the mesh range without moving the voxel range underneath
  // it — for the rest of the session the voxel region stayed at whatever the render
  // distance was at STARTUP. Raising the slider then built the outermost meshes against
  // chunks that were never loaded.
  //
  // Asserted through `_updateVoxelRegion` and not just on the field, because the field
  // is only a bug if something reads it.
  {
    const cm = new ChunkManager({ worldName: 'world-rd', renderDistance: 4, regionRadius: 16 });

    assertEquals(cm._voxelRegionRadius, 16,
      'Constructor derives _voxelRegionRadius from renderDistance and regionRadius');

    // Raising the render distance past `regionRadius - 2` must push the voxel region out
    // with it: the voxel region has to extend at least one chunk beyond the meshes.
    cm.setRenderDistance(16);
    assertEquals(cm.renderDistance, 16, 'setRenderDistance sets the render distance');
    assertEquals(cm._voxelRegionRadius, 18,
      'setRenderDistance recomputes _voxelRegionRadius — max(renderDistance + 2, min(32, regionRadius)) (D-66)');

    // Lowering it again returns the voxel region to the configured region radius rather
    // than leaving it stretched.
    cm.setRenderDistance(2);
    assertEquals(cm._voxelRegionRadius, 16,
      'Lowering the render distance returns _voxelRegionRadius to the configured region radius');

    // The clamp is unchanged: [2, 16].
    cm.setRenderDistance(99);
    assertEquals(cm.renderDistance, 16, 'setRenderDistance still clamps to a maximum of 16');
    cm.setRenderDistance(-5);
    assertEquals(cm.renderDistance, 2, 'setRenderDistance still clamps to a minimum of 2');

    // ── The consequence: _updateVoxelRegion actually asks for the wider area ──
    const scanned = [];
    const probe = new ChunkManager({ worldName: 'world-rd2', renderDistance: 4, regionRadius: 16 });
    probe._batchEnsureChunks = (entries) => { scanned.push(entries.length); return Promise.resolve(); };

    probe._updateVoxelRegion(0, 0);
    assertEquals(scanned[0], 33 * 33,
      '_updateVoxelRegion scans (2 * 16 + 1)^2 chunks at the startup radius');

    probe.setRenderDistance(16);
    probe._updateVoxelRegion(0, 0);
    assertEquals(scanned[1], 37 * 37,
      '_updateVoxelRegion scans (2 * 18 + 1)^2 chunks after the render distance is raised — ' +
      'the stale-derived-field bug made this identical to the previous scan (D-66)');

    // ── The dead callback is gone, not merely unused ──
    //
    // `setRenderDistance` used to invoke `this.onRenderDistanceChange` — a field the
    // constructor never initialised and that nothing in src/ ever assigned (the one
    // module that did, PerformanceOptimizer.js, assigned it to itself and PR 20 deleted
    // it). A callback nothing can set reads as a wiring point and is not one — D-42's
    // shape — so it was removed rather than wired. If a future PR needs a notification
    // here, it has to add it deliberately and change this assertion.
    let fired = 0;
    const cb = new ChunkManager({ worldName: 'world-rd3', renderDistance: 4 });
    cb.onRenderDistanceChange = () => { fired++; };
    cb.setRenderDistance(9);
    assertEquals(fired, 0,
      'setRenderDistance fires no onRenderDistanceChange callback — the field was dead and is gone (D-66)');
    assertEquals(cb._voxelRegionRadius, 16,
      'The recompute still happens on the instance that carries a stray callback field');
  }

  // ── 24. Mesh disposal has one name, and clientMode has one assignment (D-75) ──
  //
  // `ChunkMeshLifecycle.js` carried `_unloadMesh` and `_disposeOldMeshes` as byte-for-byte
  // the same thirteen lines under two names, and BOTH were live: `_unloadMesh` from
  // `ChunkManager.dispose()` and `ChunkMeshCoordinator.js:65`, `_disposeOldMeshes` from
  // `_onMeshBuilt`. PR 23 recorded the duplication rather than merging it (a mechanical
  // extraction is the wrong PR to change behaviour in); PR 34 collapsed it as D-75, and
  // `_onMeshBuilt` now calls `_unloadMesh`.
  //
  // Nothing in `test/` had ever exercised either one — the whole mesh pipeline was covered
  // only through `npm run test:e2e`, in a real browser — so the collapse repointed a live
  // call site with no unit-level net under it. This section is that net. It asserts the
  // OBSERVABLE effect (removed from the chunk group, geometry and material disposed, map
  // entry dropped) rather than which method name did it, so it stays meaningful whichever
  // name a future PR settles on.
  //
  // No THREE, no WebGL: the three sub-meshes are plain objects with `dispose` counters,
  // which is the entire surface `_unloadMesh` touches.
  {
    const stubMesh = () => ({
      geometry: { disposed: 0, dispose() { this.disposed++; } },
      material: { disposed: 0, dispose() { this.disposed++; } },
    });
    const makeCM = (worldName) => {
      const removed = [];
      const cm = new ChunkManager({ worldName, renderer: { chunkGroup: { remove: (m) => removed.push(m) } } });
      return { cm, removed };
    };

    // ── _unloadMesh: all three sub-meshes leave the scene and are disposed ──
    {
      const { cm, removed } = makeCM('world-mesh1');
      const entry = { solid: stubMesh(), cutout: stubMesh(), trans: stubMesh() };
      cm.loadedMeshes.set('0,0', entry);

      cm._unloadMesh('0,0');
      assertEquals(removed.length, 3, '_unloadMesh removes all three sub-meshes from the chunk group');
      assertEquals(entry.solid.geometry.disposed, 1, '_unloadMesh disposes the solid geometry');
      assertEquals(entry.solid.material.disposed, 1, '_unloadMesh disposes the solid material');
      assertEquals(entry.cutout.geometry.disposed, 1, '_unloadMesh disposes the cutout geometry');
      assertEquals(entry.trans.material.disposed, 1, '_unloadMesh disposes the transparent material');
      assert(!cm.loadedMeshes.has('0,0'), '_unloadMesh drops the map entry');

      // Idempotent — `dispose()` calls it for every key and the coordinator calls it again.
      cm._unloadMesh('0,0');
      assertEquals(removed.length, 3, 'a second _unloadMesh for the same key is a no-op');
      assertEquals(entry.solid.geometry.disposed, 1, 'and does not double-dispose');
      cm._unloadMesh('never-loaded');
      assertEquals(removed.length, 3, '_unloadMesh for an unknown key is a no-op');
    }

    // ── _onMeshBuilt: THE repointed call site. The previous build must be released. ──
    //
    // This is the assertion the collapse needed. Break `_unloadMesh` and it goes red;
    // it was `_disposeOldMeshes` that used to do this, and nothing checked it.
    {
      const { cm, removed } = makeCM('world-mesh2');
      const old = { solid: stubMesh(), cutout: stubMesh(), trans: stubMesh() };
      cm.loadedMeshes.set('1,2', old);
      cm._rebuilding.add('1,2');

      cm._onMeshBuilt('1,2', 1, 2, null); // null geoResult → "this chunk meshes to nothing"
      assertEquals(removed.length, 3, '_onMeshBuilt takes the PREVIOUS build out of the chunk group');
      assertEquals(old.solid.geometry.disposed, 1, '_onMeshBuilt disposes the previous solid geometry');
      assertEquals(old.cutout.material.disposed, 1, '_onMeshBuilt disposes the previous cutout material');
      assertEquals(old.trans.geometry.disposed, 1, '_onMeshBuilt disposes the previous transparent geometry');
      assert(!cm._rebuilding.has('1,2'), '_onMeshBuilt clears the rebuilding flag');
      assertEquals(cm.loadedMeshes.get('1,2'), null,
        'and records the empty result, so the chunk is not re-queued forever');
    }

    // ── dispose() releases every loaded mesh ──
    {
      const { cm, removed } = makeCM('world-mesh3');
      const a = { solid: stubMesh(), cutout: null, trans: null };
      const b = { solid: stubMesh(), cutout: stubMesh(), trans: null };
      cm.loadedMeshes.set('0,0', a);
      cm.loadedMeshes.set('0,1', b);

      cm.dispose();
      assertEquals(removed.length, 3, 'dispose() removes every non-null sub-mesh of every loaded chunk');
      assertEquals(a.solid.geometry.disposed, 1, 'dispose() disposes the first chunk');
      assertEquals(b.cutout.material.disposed, 1, 'dispose() disposes the second chunk');
      assertEquals(cm.loadedMeshes.size, 0, 'dispose() empties loadedMeshes');
    }

    // ── clientMode: one assignment, and it still reaches init() ──
    //
    // The constructor assigned `this.clientMode = !!options.clientMode` TWICE, back to
    // back, under two wordings of the same comment. Identical right-hand sides, so the
    // second was a no-op — but a duplicated assignment is one edit away from being two
    // different values, and the second would win silently. D-75 deleted the second copy;
    // this pins that the survivor is the live one.
    {
      assertEquals(new ChunkManager({ worldName: 'w-cm1', clientMode: true }).clientMode, true,
        'clientMode: true survives the constructor');
      assertEquals(new ChunkManager({ worldName: 'w-cm2' }).clientMode, false,
        'clientMode defaults to false, not undefined');
      assertEquals(new ChunkManager({ worldName: 'w-cm3', clientMode: 1 }).clientMode, true,
        'clientMode is coerced to a boolean');

      // The consequence: a client never builds a voxel-generation worker pool, because
      // it receives its chunks from the host. `init()` reads the field exactly once.
      const client = new ChunkManager({ worldName: 'w-cm4', clientMode: true });
      let meshWorkersInitialised = 0;
      client._initMeshWorkers = async () => { meshWorkersInitialised++; };
      await client.init();
      assertEquals(client.workerPool, null, 'client mode skips the voxel generation worker pool');
      assertEquals(meshWorkersInitialised, 1, 'but still initialises mesh workers, which render host chunks');
    }
  }

  // ── 25. WorkerPool is still the export ChunkManager.js publishes (D-75) ──
  //
  // `ChunkManager.js` re-exported a `createWorkerPool` factory alongside the class. It had
  // no call site in `src/`, `test/`, `server/` or `shared/`, and it was missing the
  // `?v=Date.now()` cache-bust that `ChunkManager.init()` appends — so anyone who wired in
  // the obvious-looking factory would have reintroduced D-23 (a stale worker script served
  // from the HTTP cache, generating terrain from old code). D-75 deleted it.
  //
  // The class it was a factory for is NOT dead: `init()` and `_initMeshWorkers()` construct
  // it with two different worker counts, which is the actual reason there is no shared
  // factory. This asserts the surviving export, so the deletion cannot be mistaken for
  // permission to remove the class too.
  {
    const mod = await import('../../../src/engine/world/ChunkManager.js');
    assert(typeof mod.WorkerPool === 'function', 'ChunkManager.js still re-exports the WorkerPool class');
    assertEquals(mod.createWorkerPool, undefined,
      'and no longer re-exports createWorkerPool — it had no call site and no cache-bust (D-75)');
    const wp = await import('../../../src/engine/world/WorkerPool.js');
    assertEquals(wp.createWorkerPool, undefined, 'nor does WorkerPool.js itself export it');
    assertEquals(mod.WorkerPool, wp.WorkerPool, 'the re-export is the same binding, not a copy');
  }
}

// ─── Results ────────────────────────────────────────────────────
await run().then(() => {
  console.log(`\n${'='.repeat(50)}`);
  console.log(`Results: ${passCount} passed, ${failCount} failed`);
  if (failures.length > 0) {
    console.log('\nFailures:');
    failures.forEach(f => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log('All tests passed!\n');
  process.exit(0);
}).catch(err => {
  // **D-86 (1).** `process.exit` is a throw inside a Vitest worker (`test/setup.js`), so
  // the `process.exit(0)` two lines above unwinds straight into this handler and printed
  // a "Test file crashed outside the assertion scope" banner on every **green** run. It
  // was invisible only because Vitest suppresses console output for a passing file, which
  // makes it worse rather than better: the banner is in the log the moment anyone turns
  // interception off to read one.
  //
  // The verdict is already recorded by then — `setup.js` records before it throws, and
  // first-exit-wins — so rethrowing hands it to `legacy()` untouched. A real crash has no
  // `__cuubzExit` and still takes the banner and the exit(1).
  if (err && err.__cuubzExit !== undefined) throw err;
  console.error(`\nTest file crashed outside the assertion scope: ${err.stack}`);
  process.exit(1);
});
}));
