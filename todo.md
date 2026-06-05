# Cuubz — Chunk Storage Fix & Rewrite Plan

> **Status:** Draft — awaiting review before implementation.
> **Trigger:** Chunks are being SAVED to IndexedDB but never LOADED back on reload, causing infinite regeneration loops.
> **Based on:** User storage architecture spec (chunked files, IndexedDB, RLE binary format, server-authoritative multiplayer sync).

---

## Root Cause Analysis

### Primary Bug: Manifest / Storage Disconnect

Chunks are regenerated from seed every page load instead of being loaded from IndexedDB. Console shows `SAVED 37 chunk(s)` but never `LOADED`.

**Flow breakdown:**

```
Initial generation (first visit):
  _buildChunk(cx, cz)
    → isChunkGenerated("9,-9") → false (new world)
    → generatorFn(9, -9) creates Chunk instance
    → addGeneratedChunk("9,-9") adds key to manifest.generatedChunks ✅
    → markDirty("9,-9", chunkData) queues for flush

5 seconds later:
  dirtyFlush.flush()
    → encode chunk → saveChunks([{key: "9,-9", data: ArrayBuffer}]) ✅
    → Binary saved to IndexedDB, but manifest NOT updated here

Page reload:
  _buildChunk(cx, cz)
    → isChunkGenerated("9,-9") reads manifest...
```

**Why `isChunkGenerated()` returns false despite chunks being saved:**

The most likely culprits (in order of probability):

1. **Race condition in concurrent manifest writes**: When `_processQueue` builds 3 chunks per frame, each calls `addGeneratedChunk()` which does read-modify-write on the manifest. If IndexedDB transactions interleave incorrectly, earlier chunk keys can be lost when later saves overwrite them.

2. **`addGeneratedChunk` save failure silently ignored** (line 218-222 of chunkManager.js): The `catch` block swallows all errors including manifest write failures. If the save fails, the key is never added to `generatedChunks`.

3. **Decode validation too aggressive**: Loaded chunks that pass magic number check but have `heightRange < 3` get silently purged via `removeGeneratedChunk()`, removing them from both storage AND manifest. On next reload they regenerate and repeat the cycle.

4. **World name mismatch in IndexedDB queries**: `loadManifest()` uses `store.get(this.worldName)` where `worldName = currentWorld.id`. If the id changes between sessions (e.g., regenerated on each start), chunks are saved under one world key but looked up under another.

### Secondary Issues

| Issue | File | Impact |
|-------|------|--------|
| Flush doesn't update manifest | `dirtyFlushManager.js` | Chunks can be in IndexedDB but not tracked by manifest |
| No world isolation for chunk keys | `chunkStore.js` | Multiple worlds would collide on same "cx,cz" keys |
| Aggressive error suppression | All storage files | Masks real bugs, impossible to diagnose failures |
| Double `markDirty` call in `_buildChunk` | `chunkManager.js` lines 227 + 375 | Redundant (Map overwrite), not harmful but wasteful |

---

## Architecture: Current vs. Target

### Current Problems

```
_buildChunk()                    dirtyFlush.flush()
     │                                    │
     ├──► addGeneratedChunk(key) ──► manifest.save()   ← Only path that updates manifest
     ├──► markDirty(key, chunkData)                     │
     │                                                  ▼
     │                                         store.saveChunks(entries)  ← Binary saved, manifest NOT updated
     │
Reload:
     ▼
isChunkGenerated(key) → reads manifest → key may be missing → regenerate from seed ❌
```

### Target Architecture

```
_buildChunk()                    dirtyFlush.flush()
     │                                    │
     ├──► markDirty(key, chunkData)       │
     │                                    ▼
     │                          store.saveChunks(entries)
     │                          + batchAddGeneratedKeys(keys)  ← Manifest updated on flush ✅
     │
Reload:
     ▼
isChunkGenerated(key) → reads manifest → key present → load from IndexedDB ✅
```

**Key change:** The dirty flush must update the manifest's `generatedChunks` list atomically with the binary save. This ensures that any chunk in IndexedDB is tracked by the manifest, and vice versa.

---

## Implementation Plan

### Phase 1: Fix Manifest Consistency (CRITICAL)

**Problem:** Chunks saved to IndexedDB via flush are not reflected in `manifest.generatedChunks`, causing reloads to regenerate from seed instead of loading persisted data.

#### 1.1 Add batch manifest update to ChunkStore

**File:** `js/world/chunkStore.js`
**Change:** New method that atomically adds multiple keys to the manifest's generated list.

```javascript
/**
 * Batch-add chunk keys to manifest.generatedChunks in a single transaction.
 * Called by DirtyFlushManager after saving chunks to IndexedDB.
 */
async batchAddGeneratedChunks(chunkKeys) {
  await this._open();

  let manifest = await this.loadManifest();
  if (!manifest) {
    manifest = {
      worldName: this.worldName,
      seed: '',
      createdAt: Date.now(),
      lastPlayed: Date.now(),
      playerCount: 1,
      spawnPoint: { x: 0, y: 64, z: 0 },
      generatedChunks: []
    };
  }

  if (!manifest.generatedChunks) manifest.generatedChunks = [];

  let added = 0;
  for (const key of chunkKeys) {
    if (!manifest.generatedChunks.includes(key)) {
      manifest.generatedChunks.push(key);
      added++;
    }
  }

  manifest.lastPlayed = Date.now();
  await this.saveManifest(manifest);
  return added;
}
```

#### 1.2 Update DirtyFlushManager.flush() to update manifest

**File:** `js/world/dirtyFlushManager.js`
**Change:** After saving chunks, call `batchAddGeneratedChunks` with the flushed keys.

```javascript
async flush() {
  // ... existing encode logic ...

  try {
    await this.store.saveChunks(entries);

    // Update manifest to track all saved chunk keys
    const flushedKeys = entries.map(e => e.key);
    await this.store.batchAddGeneratedChunks(flushedKeys);

    // Clear dirty tracking...
    // ... existing cleanup logic ...
  } catch (err) {
    // ... error handling ...
  }
}
```

Also update `_syncFlush()` (beforeunload handler) to do the same manifest update after synchronous IndexedDB writes.

#### 1.3 Remove redundant `addGeneratedChunk` from `_buildChunk` generation path

**File:** `js/renderer/chunkManager.js`
**Change:** Since flush now handles manifest updates, remove the separate `addGeneratedChunk()` call in the generation path to avoid duplicate work and race conditions. The chunk is already marked dirty — it will be picked up by flush.

**Before (lines 217-228):**
```javascript
if (!chunkData && this.generatorFn) {
  chunkData = this.generatorFn(cx, cz);

  if (this.chunkStore) {
    try {
      await this.chunkStore.addGeneratedChunk(key);  // REMOVE THIS
    } catch (e) { /* silent */ }
  }

  if (this.dirtyFlush) {
    this.dirtyFlush.markDirty(key, chunkData);
  }
}
```

**After:**
```javascript
if (!chunkData && this.generatorFn) {
  chunkData = this.generatorFn(cx, cz);

  // Mark dirty — flush will save binary AND update manifest atomically
  if (this.dirtyFlush) {
    this.dirtyFlush.markDirty(key, chunkData);
  }
}
```

#### 1.4 Remove second redundant `markDirty` call in `_buildChunk`

**File:** `js/renderer/chunkManager.js` ~line 375
**Change:** The code at the end of `_buildChunk` calls `markDirty` again for newly generated chunks, but this was already called earlier. Remove to avoid confusion:

```javascript
// REMOVE this block (~lines 374-376):
if (!fromStorage && this.dirtyFlush) {
  this.dirtyFlush.markDirty(key, chunkData);
}
```

---

### Phase 2: Add World Isolation (HIGH)

**Problem:** Chunk keys like `"9,-9"` are global across all worlds. Two different worlds would collide on the same coordinates.

#### 2.1 Namespace chunk keys by world

**File:** `js/world/chunkStore.js`
**Change:** Prefix all chunk keys with the world name to ensure isolation.

```javascript
// Internal key transformation
_chunkKey(key) {
  return `${this.worldName}:${key}`;  // e.g., "myworld:9,-9"
}

// Update saveChunk, loadChunk, deleteChunk, hasChunk, saveChunks, loadChunks
// to use _chunkKey() for all IndexedDB operations.
```

The manifest store already uses `worldName` as its keyPath, so it's already isolated.

#### 2.2 Update DirtyFlushManager to pass through keys correctly

**File:** `js/world/dirtyFlushManager.js`
**Change:** No changes needed — the flush manager passes raw `"cx,cz"` keys to ChunkStore methods, which handle namespacing internally. The manifest update uses the same raw keys since they're stored in the world-specific manifest.

---

### Phase 3: Improve Error Visibility (HIGH)

**Problem:** All errors are silently swallowed, making it impossible to diagnose why chunks aren't loading.

#### 3.1 Add diagnostic logging for storage failures

**Files:** `js/world/chunkStore.js`, `js/world/dirtyFlushManager.js`
**Change:** Re-enable targeted error logging for operations that should never fail in normal operation:

```javascript
// In ChunkStore.saveChunks():
} catch (err) {
  console.error(`[ChunkStore] FAILED to save ${entries.length} chunk(s):`, err.message);
}

// In DirtyFlushManager.flush():
} catch (err) {
  console.error(`[DirtyFlush] FAILED flush:`, err.message);
}
```

Keep the existing two signal logs (`LOADED` and `SAVED`) — only add error logs for unexpected failures. This gives us visibility into what's actually going wrong without flooding the console during normal operation.

#### 3.2 Add decode verification log

**File:** `js/renderer/chunkManager.js`
**Change:** When a chunk fails to load from storage (decode error or flat terrain), log WHY before silently regenerating:

```javascript
// In _buildChunk, after load attempt fails:
if (!chunkData && isGenerated) {
  console.warn(`[ChunkManager] Chunk ${key} in manifest but failed to load — regenerating from seed`);
}
```

This single log line would immediately tell us whether the problem is (a) keys missing from manifest, (b) decode failures, or (c) flat terrain detection.

---

### Phase 4: Fix Race Condition in Concurrent Manifest Writes (MEDIUM)

**Problem:** When multiple chunks build simultaneously, each calls operations that read-modify-write the manifest, potentially losing earlier writes.

#### 4.1 Batch manifest updates instead of per-chunk writes

**Strategy:** Instead of calling `addGeneratedChunk()` for each chunk individually during generation, accumulate keys and batch-update once per frame cycle.

**Option A (simple):** Since Phase 1 moves manifest updates to the flush path, this race condition is largely eliminated — chunks are tracked when they're flushed, not when they're generated.

**Option B (belt-and-suspenders):** Add a `_pendingKeys` Set to ChunkStore that accumulates keys from `addGeneratedChunk()` calls and batch-commits them on the next manifest save:

```javascript
class ChunkStore {
  constructor(worldName) {
    this.worldName = worldName;
    this._db = null;
    this._ready = null;
    this._pendingKeys = new Set();  // Accumulate keys between saves
  }

  async addGeneratedChunk(chunkKey) {
    await this._open();
    this._pendingKeys.add(chunkKey);
    await this._flushPendingKeys();
  }

  async _flushPendingKeys() {
    if (this._pendingKeys.size === 0) return;

    const keys = [...this._pendingKeys];
    this._pendingKeys.clear();

    let manifest = await this.loadManifest();
    // ... update and save manifest with all pending keys atomically
  }
}
```

**Recommendation:** Implement Option A first (Phase 1 handles it). Only add Option B if we see evidence of race conditions after Phase 1.

---

### Phase 5: Verify Codec Round-Trip Integrity (MEDIUM)

**Problem:** If encode/decode produces different data, loaded chunks could fail validation even though they were saved correctly.

#### 5.1 Add round-trip test

Create a simple test script that generates a chunk, encodes it, decodes it, and compares:

```javascript
// Test in browser console:
const testChunk = new Chunk(9, -9);
// Fill with some non-zero blocks...
for (let x = 0; x < 16; x++) {
  for (let z = 0; z < 16; z++) {
    const h = Math.floor(Math.sin(x * 0.3) * 10 + 40); // Terrain height
    for (let y = 0; y <= h; y++) {
      testChunk.setBlock(x, y, z, y === h ? 1 : 2); // grass on top, dirt below
    }
  }
}

// Round-trip test
const encoded = ChunkBinaryCodec.encode(testChunk);
console.log(`Encoded size: ${encoded.byteLength} bytes`);

const decoded = ChunkBinaryCodec.decode(encoded);
let match = true;
for (let i = 0; i < testChunk.blocks.length; i++) {
  if (decoded.blocks[i] !== testChunk.blocks[i]) {
    console.error(`Mismatch at index ${i}: expected ${testChunk.blocks[i]}, got ${decoded.blocks[i]}`);
    match = false;
    break;
  }
}
console.log(match ? '✅ Round-trip OK' : '❌ Round-trip FAILED');
```

#### 5.2 Verify magic number endianness consistency

Current code uses little-endian (`true` flag) on both encode (line 73 of codec) and decode (line 113). This is correct for x86 systems but should be verified explicitly:

- Encode: `view.setUint32(offset, CHUNK_MAGIC, true);` // little-endian ✅
- Decode: `const magic = view.getUint32(0, true);` // little-endian ✅

Both match — no change needed.

---

### Phase 6: Graceful Shutdown Reliability (LOW)

**Current state:** `_syncFlush()` writes dirty chunks to IndexedDB synchronously during `beforeunload`/`pagehide`. Works in Chrome/Firefox but not guaranteed.

#### 6.1 Add manifest update to sync flush

**File:** `js/world/dirtyFlushManager.js`
**Change:** The synchronous flush path should also update the manifest's generated list. Since we can't use async IndexedDB operations reliably during beforeunload, add a simple in-memory flag that gets persisted on next normal load:

```javascript
_syncFlush() {
  // ... existing encode + save logic ...

  // Also write keys to localStorage as a fallback for manifest update
  const keys = entries.map(e => e.key).join('|');
  localStorage.setItem(`cuubz:${this.store.worldName}:pendingKeys`, keys);
}
```

Then in `main.js` during startup, check and merge these pending keys into the manifest.

---

## Execution Order

```
Phase 1: Fix manifest consistency (flush updates generatedChunks)     ~30 min
      ↓
Phase 2: Add world isolation to chunk keys                            ~15 min
      ↓
Phase 3: Improve error visibility for diagnosis                       ~10 min
      ↓
Phase 4: Race condition fix (if needed after Phase 1)                 ~15 min
      ↓
Phase 5: Verify codec round-trip integrity                             ~10 min
      ↓
Phase 6: Graceful shutdown reliability                                 ~20 min
```

**Total estimated work:** Phases 1-3 = ~55 minutes / ~80 lines of changes across 4 files.

---

## Files Modified

| File | Phase | Change Type | Lines Affected |
|------|-------|-------------|----------------|
| `js/world/chunkStore.js` | 1, 2, 3 | Add batchAddGeneratedChunks(), namespace keys, error logging | ~40 lines added/modified |
| `js/world/dirtyFlushManager.js` | 1, 3, 6 | Call batchAddGeneratedChunks in flush(), error logging, sync manifest update | ~20 lines added/modified |
| `js/renderer/chunkManager.js` | 1, 3 | Remove redundant addGeneratedChunk/markDirty calls, add diagnostic log | ~5 lines removed, ~2 added |
| `js/main.js` | 6 | Merge pending keys from localStorage on startup | ~10 lines added |

---

## Verification Checklist (After Implementation)

- [ ] **Primary test:** Save chunks → reload page → see `[ChunkManager] LOADED ...` for all previously saved chunks, NOT regenerated
- [ ] Console shows `LOADED` messages with byte sizes and height ranges on every page reload after first visit
- [ ] Console shows `SAVED` messages only when new chunks are generated or existing ones modified (not on every load)
- [ ] World deletion cleans up all chunk data AND manifest entries in IndexedDB
- [ ] Multiple worlds don't collide on same chunk coordinates
- [ ] Codec round-trip test passes (encode → decode produces identical block data)
- [ ] No `console.error` messages during normal operation

---

## Risk Assessment

| Risk | Severity | Mitigation |
|------|----------|------------|
| Existing chunks in IndexedDB use non-namespaced keys | MEDIUM | Add migration step: on first load after Phase 2, copy existing chunks from old key format to new namespaced format |
| Manifest update fails silently during flush | LOW | Error logging (Phase 3) catches this. Chunks still save — only tracking is lost |
| Breaking change to chunkStore API | LOW | Internal method changes only; public API surface remains the same for callers |

---

## Notes on Current Implementation vs Spec

What's working:
- ✅ Per-chunk storage (IndexedDB keyed by coordinates)
- ✅ RLE binary encoding with compact header
- ✅ Dirty flush on 5s interval
- ✅ Graceful shutdown handlers
- ✅ World manifest schema matches spec
- ✅ Multiplayer host callbacks wired

What needs fixing:
- ❌ Manifest not updated during flush → reload regenerates everything
- ❌ No world isolation for chunk keys
- ❌ Error suppression masks real bugs
- ⚠️ Race condition in concurrent manifest writes (mitigated by Phase 1)
