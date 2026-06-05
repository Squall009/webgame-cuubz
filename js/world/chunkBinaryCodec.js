/**
 * Cuubz — Chunk Binary Codec
 * Encodes/decodes Chunk instances to/from compact ArrayBuffer using RLE compression.
 *
 * Binary layout:
 *   [HEADER - 20 bytes]
 *     magic:        Uint32 (0x43555542 "CUUB")
 *     version:      Uint8  (1)
 *     chunkX:       Int16
 *     chunkZ:       Int16
 *     height:       Uint8  (96)
 *     flags:        Uint8  (bitfield)
 *     blockRunCount: Uint32
 *     reserved:     4 bytes
 *   [BLOCK DATA - variable]
 *     Each run: [blockID: Uint16, count: Uint16]
 *   [WATER LEVELS - variable, if flags & HAS_WATER_LEVELS]
 *     waterRunCount: Uint32
 *     Each run: [level: Uint8, count: Uint16]
 *   [INVENTORIES - variable, if flags & HAS_INVENTORIES]
 *     inventoryCount: Uint16
 *     Per inventory: { localX: Uint8, localY: Int16, localZ: Uint8, slotCount: Uint8 }
 *       Per slot: { itemID: Uint16, count: Uint16 }
 */

const CHUNK_MAGIC = 0x43555542; // "CUUB"
const CHUNK_VERSION = 1;
const HEADER_SIZE = 20;

// Flag bits
const CHUNK_FLAG_DIRTY = 0x01;
const CHUNK_FLAG_HAS_INVENTORIES = 0x02;
const CHUNK_FLAG_HAS_WATER_LEVELS = 0x04;

class ChunkBinaryCodec {
  /**
   * Encode a Chunk instance into a compact ArrayBuffer with RLE compression.
   * @param {Chunk} chunk - The chunk to encode
   * @returns {ArrayBuffer} Binary representation of the chunk
   */
  static encode(chunk) {
    const totalBlocks = chunk.blocks.length;

    // RLE-encode block data
    const blockRuns = this._rleEncode16(chunk.blocks);

    // RLE-encode water levels (only if there are non-zero values)
    let waterRuns = null;
    let flags = 0;
    if (chunk.dirty) flags |= CHUNK_FLAG_DIRTY;

    // Check if any water levels are non-zero and worth encoding
    const hasWaterLevels = this._hasNonZeroWater(chunk.waterLevels, chunk.blocks);
    if (hasWaterLevels) {
      waterRuns = this._rleEncode8(chunk.waterLevels);
      flags |= CHUNK_FLAG_HAS_WATER_LEVELS;
    }

    // Calculate total buffer size
    const blockSize = HEADER_SIZE + blockRuns.length * 4; // header + runs[Uint16, Uint16]
    let waterSize = 0;
    if (waterRuns) {
      waterSize = 4 + waterRuns.length * 3; // runCount(Uint32) + runs[level:Uint8, count:Uint16]
    }

    const bufferSize = blockSize + waterSize;
    const buffer = new ArrayBuffer(bufferSize);
    const view = new DataView(buffer);

    let offset = 0;

    // === HEADER ===
    view.setUint32(offset, CHUNK_MAGIC, true); offset += 4; // little-endian to match decode
    view.setUint8(offset, CHUNK_VERSION); offset += 1;
    view.setInt16(offset, chunk.chunkX, true); offset += 2;
    view.setInt16(offset, chunk.chunkZ, true); offset += 2;
    view.setUint8(offset, 96); // height = CHUNK_HEIGHT (hardcoded for now)
    offset += 1;
    view.setUint8(offset, flags); offset += 1;
    view.setUint32(offset, blockRuns.length / 2, true); offset += 4; // run count
    offset += 4; // reserved

    // === BLOCK DATA (RLE) ===
    for (let i = 0; i < blockRuns.length; i += 2) {
      view.setUint16(offset, blockRuns[i], true);     // blockID
      view.setUint16(offset + 2, blockRuns[i + 1], true); // count
      offset += 4;
    }

    // === WATER LEVELS (RLE, if present) — each run: level(Uint8) + count(Uint16 LE) = 3 bytes ===
    if (waterRuns) {
      const runCount = waterRuns.length / 3;
      view.setUint32(offset, runCount, true); offset += 4;
      for (let i = 0; i < waterRuns.length; i += 3) {
        view.setUint8(offset, waterRuns[i]);             // level
        view.setUint16(offset + 1, (waterRuns[i + 2] << 8) | waterRuns[i + 1], true); // count LE
        offset += 3;
      }
    }

    return buffer;
  }

  /**
   * Decode a binary ArrayBuffer back into a Chunk instance.
   * @param {ArrayBuffer} buffer - Binary chunk data
   * @returns {Chunk} Reconstructed chunk
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

    let offset = 5;
    const chunkX = view.getInt16(offset, true); offset += 2;
    const chunkZ = view.getInt16(offset, true); offset += 2;
    const height = view.getUint8(offset); offset += 1;
    const flags = view.getUint8(offset); offset += 1;
    const blockRunCount = view.getUint32(offset, true); offset += 4;
    offset += 4; // skip reserved

    const totalBlocks = 16 * 16 * height;

    // === DECODE BLOCK DATA (RLE) ===
    const blocks = new Uint8Array(totalBlocks);
    let blockIdx = 0;
    for (let i = 0; i < blockRunCount && blockIdx < totalBlocks; i++) {
      const blockID = view.getUint16(offset, true); offset += 2;
      const count = view.getUint16(offset, true);     offset += 2;
      for (let j = 0; j < count && blockIdx < totalBlocks; j++) {
        blocks[blockIdx++] = Math.min(blockID, 255); // Clamp to Uint8 range
      }
    }

    // === DECODE WATER LEVELS (RLE) ===
    const waterLevels = new Uint8Array(totalBlocks);
    if (flags & CHUNK_FLAG_HAS_WATER_LEVELS) {
      const waterRunCount = view.getUint32(offset, true); offset += 4;
      let waterIdx = 0;
      for (let i = 0; i < waterRunCount && waterIdx < totalBlocks; i++) {
        const level = view.getUint8(offset);     offset += 1;
        const count = view.getUint16(offset, true); offset += 2;
        for (let j = 0; j < count && waterIdx < totalBlocks; j++) {
          waterLevels[waterIdx++] = level;
        }
      }
    }

    // Reconstruct Chunk
    const chunk = new Chunk(chunkX, chunkZ);
    chunk.blocks.set(blocks);
    chunk.waterLevels.set(waterLevels);
    if (flags & CHUNK_FLAG_DIRTY) {
      chunk.dirty = true;
    }

    return chunk;
  }

  // ============================================================
  // RLE Encoding Helpers
  // ============================================================

  /**
   * RLE-encode a Uint8Array into an array of [value, count] pairs.
   * Values are stored as-is (0-255), counts capped at 65535.
   * Returns flat Uint16Array: [v0, c0, v1, c1, ...]
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
   * RLE-encode a Uint8Array into [value, countLow, countHigh] triplets.
   * Each run takes 3 bytes: level(1 byte) + count as little-endian uint16 split across 2 bytes.
   * Returns flat Uint8Array: [v0, c0_low, c0_high, v1, c1_low, c1_high, ...]
   */
  static _rleEncode8(data) {
    if (data.length === 0) return new Uint8Array(0);

    const runs = []; // flat array of bytes: [value, countLow, countHigh, ...]
    let currentVal = data[0];
    let count = 1;

    for (let i = 1; i < data.length; i++) {
      if (data[i] === currentVal && count < 0xFFFF) {
        count++;
      } else {
        runs.push(currentVal, count & 0xFF, (count >> 8) & 0xFF);
        currentVal = data[i];
        count = 1;
      }
    }
    runs.push(currentVal, count & 0xFF, (count >> 8) & 0xFF);

    return new Uint8Array(runs);
  }

  /**
   * Check if the chunk has any non-zero water levels worth encoding.
   */
  static _hasNonZeroWater(waterLevels, blocks) {
    for (let i = 0; i < waterLevels.length; i++) {
      if (waterLevels[i] > 0 && waterLevels[i] < 8) {
        // Only encode flowing levels (1-7); source levels (8) are implicit for WATER/LAVA blocks
        return true;
      }
    }
    return false;
  }

  /**
   * Get estimated compressed size for a chunk without actually encoding.
   */
  static estimateSize(chunk) {
    const blockRuns = this._rleEncode16(chunk.blocks);
    let waterRunsLen = 0;
    if (this._hasNonZeroWater(chunk.waterLevels, chunk.blocks)) {
      const wr = this._rleEncode8(chunk.waterLevels);
      waterRunsLen = 4 + wr.length * 3;
    }
    return HEADER_SIZE + blockRuns.length * 4 + waterRunsLen;
  }
}

// Export flags for use elsewhere
ChunkBinaryCodec.FLAGS = {
  DIRTY: CHUNK_FLAG_DIRTY,
  HAS_INVENTORIES: CHUNK_FLAG_HAS_INVENTORIES,
  HAS_WATER_LEVELS: CHUNK_FLAG_HAS_WATER_LEVELS
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = ChunkBinaryCodec;
}
