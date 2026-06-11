/**
 * Chunk Binary Codec (v3)
 *
 * v1: Original X-major layout — DEPRECATED, triggers migration on load.
 * v2: Added checksum (still X-major block data).
 * v3: Y-major block data layout (matches Chunk._idx + meshWorker indexing).
 *     Legacy v1/v2 chunks are auto-regenerated on first load.
 *
 *   [HEADER - 20 bytes]
 *     magic:        Uint32 (0x43555542 "CUUB")
 *     version:      Uint8  (3)
 *     chunkX:       Int16
 *     chunkZ:       Int16
 *     height:       Uint16 (256)
 *     flags:        Uint8  (bitfield)
 *     blockRunCount: Uint32
 *     checksum:     Uint32 (FNV-1a hash of data portion after header — v2+ only)
 *   [BLOCK DATA - variable]
 *     Each run: [blockID: Uint16, count: Uint16]
 */

const CHUNK_MAGIC = 0x43555542; // "CUUB"
const CHUNK_VERSION = 3;       // v3: Y-major block data layout
const LEGACY_LAYOUT_MAX = 2;   // v1 and v2 use X-major — must regenerate
const HEADER_SIZE = 20;
const _CHUNK_HEIGHT = 256;     // Must match CHUNK_HEIGHT from chunkData.js

/**
 * FNV-1a 32-bit hash — fast, good distribution for binary data verification.
 */
function computeChecksum(data) {
  const arr = data instanceof Uint8Array ? data : new Uint8Array(data);
  let hash = 0x811c9dc5;

  for (let i = 0; i < arr.length; i++) {
    hash ^= arr[i];
    hash = (hash * 0x01000193) >>> 0;
  }

  return hash;
}

// Flag bits
const CHUNK_FLAG_DIRTY = 0x01;

class ChunkBinaryCodec {
  /**
   * Encode a Chunk instance into a compact ArrayBuffer with RLE compression.
   */
  static encode(chunk) {
    const blockRuns = this._rleEncode16(chunk.blocks);

    let flags = 0;
    // NOTE: dirty flag is NOT persisted — chunks saved to disk are always clean.
    // Dirty is purely an in-memory state that only matters until flush completes.

    // Calculate total buffer size: header + block runs only
    const bufferSize = HEADER_SIZE + blockRuns.length * 4;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    let offset = 0;

    // === HEADER ===
    view.setUint32(offset, CHUNK_MAGIC, true); offset += 4;
    view.setUint8(offset, CHUNK_VERSION);       offset += 1;
    view.setInt16(offset, chunk.cx ?? chunk.chunkX, true); offset += 2;
    view.setInt16(offset, chunk.cz ?? chunk.chunkZ, true); offset += 2;
    view.setUint16(offset, _CHUNK_HEIGHT, true);            offset += 2;
    view.setUint8(offset, flags);                     offset += 1;
    view.setUint32(offset, blockRuns.length / 2, true);   offset += 4; // run count
    offset += 4; // reserved (checksum written after)

    // === BLOCK DATA (RLE) ===
    for (let i = 0; i < blockRuns.length; i += 2) {
      view.setUint16(offset, blockRuns[i], true);       // blockID
      view.setUint16(offset + 2, blockRuns[i + 1], true); // count
      offset += 4;
    }

    // === COMPUTE & WRITE CHECKSUM (over data portion after header) ===
    const checksum = computeChecksum(new Uint8Array(buffer, HEADER_SIZE));
    view.setUint32(16, checksum, true);

    return buffer;
  }

  /**
   * Decode a binary ArrayBuffer back into a Chunk instance.
   */
  static decode(buffer) {
    const view = new DataView(buffer);

    // Validate header
    const magic = view.getUint32(0, true);
    if (magic !== CHUNK_MAGIC) {
      throw new Error(`Invalid chunk binary format: bad magic 0x${magic.toString(16)}, expected 0x${CHUNK_MAGIC.toString(16)}`);
    }

    const version = view.getUint8(4);
    if (version > CHUNK_VERSION) {
      throw new Error(`Unsupported chunk format version ${version} (max supported: ${CHUNK_VERSION})`);
    }

    // Legacy v1/v2 chunks use X-major block layout — incompatible with current Y-major Chunk._idx.
    // Reject them so _ensureChunkInMemory catches the error and triggers regeneration.
    if (version <= LEGACY_LAYOUT_MAX) {
      throw new Error(`Legacy chunk format v${version} (X-major layout) — must regenerate`);
    }

    let offset = 5;
    const cx = view.getInt16(offset, true); offset += 2;
    const cz = view.getInt16(offset, true); offset += 2;
    const height = view.getUint16(offset, true); offset += 2;
    const flags = view.getUint8(offset);       offset += 1;
    const blockRunCount = view.getUint32(offset, true); offset += 4;

    // Read checksum (v2+ only)
    let storedChecksum = null;
    if (version >= 2) {
      storedChecksum = view.getUint32(16, true);
    }
    offset += 4; // skip reserved/checksum

    const totalBlocks = 16 * 16 * height;

    // === DECODE BLOCK DATA (RLE) ===
    const blocks = new Uint8Array(totalBlocks);
    let blockIdx = 0;
    for (let i = 0; i < blockRunCount && blockIdx < totalBlocks; i++) {
      const blockID = view.getUint16(offset, true); offset += 2;
      const count   = view.getUint16(offset, true); offset += 2;
      for (let j = 0; j < count && blockIdx < totalBlocks; j++) {
        blocks[blockIdx++] = Math.min(blockID, 255);
      }
    }

    // === VERIFY CHECKSUM (v2+) ===
    if (version >= 2 && storedChecksum !== null) {
      const computedChecksum = computeChecksum(new Uint8Array(buffer, HEADER_SIZE));
      if (computedChecksum !== storedChecksum) {
        throw new Error(
          `Chunk checksum mismatch: stored=0x${storedChecksum.toString(16)}, ` +
          `computed=0x${computedChecksum.toString(16)} — data corrupted in storage`
        );
      }
    }

    // Reconstruct Chunk — dirty flag is ALWAYS false on load (purely in-memory concept)
    const chunk = new Chunk(cx, cz);
    chunk.blocks.set(blocks);
    // NOTE: Do NOT restore CHUNK_FLAG_DIRTY from storage. Old chunks may have it set, but
    // dirty is an in-memory-only state that only matters until flush completes. Chunks loaded
    // from disk are by definition clean (persisted).

    return chunk;
  }

  /**
   * RLE-encode a Uint8Array into [value, count] pairs.
   */
  static _rleEncode16(data) {
    if (data.length === 0) return [];

    const runs = [];
    let currentVal = data[0];
    let count = 1;

    for (let i = 1; i < data.length; i++) {
      if (data[i] === currentVal && count < 0xFFFF) {
        count++;
      } else {
        runs.push(currentVal, count);
        currentVal = data[i];
        count = 1;
      }
    }
    runs.push(currentVal, count);

    return new Uint16Array(runs);
  }

  /**
   * Get estimated compressed size for a chunk without actually encoding.
   */
  static estimateSize(chunk) {
    const blockRuns = this._rleEncode16(chunk.blocks);
    return HEADER_SIZE + blockRuns.length * 4;
  }
}

ChunkBinaryCodec.FLAGS = {
  DIRTY: CHUNK_FLAG_DIRTY,
};

ChunkBinaryCodec.computeChecksum = computeChecksum;

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChunkBinaryCodec;
}
