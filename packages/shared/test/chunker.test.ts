import { describe, expect, it } from 'vitest';
import {
  chunkIndexAt,
  chunksPerBlock,
  offsetOfChunk,
  totalBlocks,
  totalChunks,
} from '../src/transfer/chunker';

describe('chunker addressing', () => {
  it('counts chunks with a partial final chunk', () => {
    expect(totalChunks(0, 16)).toBe(0);
    expect(totalChunks(16, 16)).toBe(1);
    expect(totalChunks(17, 16)).toBe(2);
  });

  it('maps offsets to chunk indices and back', () => {
    expect(chunkIndexAt(0, 16)).toBe(0);
    expect(chunkIndexAt(15, 16)).toBe(0);
    expect(chunkIndexAt(16, 16)).toBe(1);
    expect(offsetOfChunk(3, 16)).toBe(48);
  });

  it('derives chunks per block only for aligned sizes', () => {
    expect(chunksPerBlock(64, 16)).toBe(4);
    expect(() => chunksPerBlock(60, 16)).toThrow(RangeError);
  });

  it('counts blocks like chunks at block granularity', () => {
    expect(totalBlocks(1024, 512)).toBe(2);
    expect(totalBlocks(1025, 512)).toBe(3);
  });

  it('rejects invalid inputs', () => {
    expect(() => totalChunks(-1, 16)).toThrow(RangeError);
    expect(() => chunkIndexAt(0, 0)).toThrow(RangeError);
    expect(() => offsetOfChunk(1.5, 16)).toThrow(RangeError);
  });
});
