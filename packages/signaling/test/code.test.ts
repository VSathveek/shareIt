import { describe, expect, it } from 'vitest';
import { CODE_LENGTH, generateCode, isValidCodeFormat } from '../src/pairing/code';

describe('pairing code', () => {
  it('generates codes of the expected length from the safe alphabet', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(isValidCodeFormat(code)).toBe(true);
      expect(code).not.toMatch(/[ILO01]/);
    }
  });

  it('rejects malformed codes', () => {
    expect(isValidCodeFormat('ABC')).toBe(false); // too short
    expect(isValidCodeFormat('ABCDE0')).toBe(false); // contains 0
    expect(isValidCodeFormat('abcdef')).toBe(false); // lowercase
    expect(isValidCodeFormat('ABCDEF')).toBe(true);
  });
});
