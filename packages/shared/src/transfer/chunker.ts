/**
 * Deterministic chunk/block addressing. Pure functions only — no I/O, no crypto.
 *
 * A file is sliced into fixed-size wire *chunks*; N chunks form an integrity *block*
 * (the unit of hashing and resume checkpointing). Because addressing is deterministic,
 * `offset` alone is enough to resume a reliable+ordered transfer (see Phase 2, §5).
 */

function assertPositiveInt(name: string, value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive integer, got ${value}`);
  }
}

/** Total wire chunks needed to cover a file of `size` bytes. */
export function totalChunks(size: number, chunkSize: number): number {
  assertPositiveInt('chunkSize', chunkSize);
  if (!Number.isInteger(size) || size < 0) {
    throw new RangeError(`size must be a non-negative integer, got ${size}`);
  }
  return Math.ceil(size / chunkSize);
}

/** Zero-based chunk index containing a given byte offset. */
export function chunkIndexAt(offset: number, chunkSize: number): number {
  assertPositiveInt('chunkSize', chunkSize);
  if (!Number.isInteger(offset) || offset < 0) {
    throw new RangeError(`offset must be a non-negative integer, got ${offset}`);
  }
  return Math.floor(offset / chunkSize);
}

/** Byte offset at which a given chunk starts. */
export function offsetOfChunk(index: number, chunkSize: number): number {
  assertPositiveInt('chunkSize', chunkSize);
  if (!Number.isInteger(index) || index < 0) {
    throw new RangeError(`index must be a non-negative integer, got ${index}`);
  }
  return index * chunkSize;
}

/** Number of wire chunks per integrity block. */
export function chunksPerBlock(blockSize: number, chunkSize: number): number {
  assertPositiveInt('blockSize', blockSize);
  assertPositiveInt('chunkSize', chunkSize);
  if (blockSize % chunkSize !== 0) {
    throw new RangeError(`blockSize (${blockSize}) must be a multiple of chunkSize (${chunkSize})`);
  }
  return blockSize / chunkSize;
}

/** Total integrity blocks needed to cover a file of `size` bytes. */
export function totalBlocks(size: number, blockSize: number): number {
  return totalChunks(size, blockSize);
}
