import { describe, expect, it } from 'vitest';
import { merkleRoot, sha256Hex } from '../src/transfer/integrity';

describe('integrity', () => {
  it('computes the known SHA-256 of "abc"', async () => {
    const abc = new Uint8Array([0x61, 0x62, 0x63]);
    expect(await sha256Hex(abc)).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('produces a deterministic, order-sensitive root', async () => {
    const a = await sha256Hex(new Uint8Array([1]));
    const b = await sha256Hex(new Uint8Array([2]));
    expect(await merkleRoot([a, b])).toBe(await merkleRoot([a, b]));
    expect(await merkleRoot([a, b])).not.toBe(await merkleRoot([b, a]));
  });
});
