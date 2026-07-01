import { randomInt } from 'node:crypto';

/**
 * Pairing-code alphabet: uppercase letters + digits with visually ambiguous characters
 * removed (no I, L, O, 0, 1) so codes are easy to read aloud and type. 30^6 ≈ 729M codes;
 * brute-force is further bounded by rate limiting (Phase 10).
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;

/** Cryptographically-random pairing code. */
export function generateCode(length: number = CODE_LENGTH): string {
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[randomInt(ALPHABET.length)];
  }
  return out;
}

/** Validates a code's shape before touching the store (cheap reject of malformed input). */
export function isValidCodeFormat(code: string, length: number = CODE_LENGTH): boolean {
  if (typeof code !== 'string' || code.length !== length) return false;
  for (const ch of code) {
    if (!ALPHABET.includes(ch)) return false;
  }
  return true;
}
