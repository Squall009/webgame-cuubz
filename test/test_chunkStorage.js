#!/usr/bin/env node
/**
 * Cuubz — Chunk Storage Integrity Tests (PR 6c)
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
'use strict';

const path = require('path');
require(path.resolve(__dirname, '..', 'js', 'util', 'logger'));
const { Chunk, BLOCK_TYPES } = require(path.resolve(__dirname, '..', 'js', 'world', 'chunkData'));
const ChunkBinaryCodec = require(path.resolve(__dirname, '..', 'js', 'world', 'chunkBinaryCodec'));
const { ChunkManager } = require(path.resolve(__dirname, '..', 'js', 'chunkmanager'));

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
      const kp = KEY_PATHS[name];
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

  return { name: 'cuubz-worlds', version: 2, transaction, close() {}, _data: data, _ops: ops };
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
  console.log('\n=== Chunk storage integrity (PR 6c) ===\n');

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
}

// ─── Results ────────────────────────────────────────────────────
run().then(() => {
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
  console.error(`\nTest file crashed outside the assertion scope: ${err.stack}`);
  process.exit(1);
});
