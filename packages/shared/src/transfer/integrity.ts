/**
 * Block-level integrity via Web Crypto (available in both browsers and Node ≥ 20).
 *
 * We hash per block rather than once over the whole file because SubtleCrypto has no
 * streaming digest — a single hash would require buffering the entire (up to 1TB) file
 * (Phase 2, §2.8). Per-block hashing streams and doubles as resume granularity.
 */

type DigestFn = (algorithm: string, data: Uint8Array) => Promise<ArrayBuffer>;

function digest(): DigestFn {
  const c = (globalThis as { crypto?: { subtle?: { digest: DigestFn } } }).crypto;
  if (!c?.subtle) throw new Error('Web Crypto (crypto.subtle) is unavailable in this environment');
  return c.subtle.digest.bind(c.subtle);
}

const HEX = '0123456789abcdef';

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) out += HEX.charAt(b >> 4) + HEX.charAt(b & 0x0f);
  return out;
}

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const buf = await digest()('SHA-256', data);
  return toHex(new Uint8Array(buf));
}

/**
 * Flat root over the ordered list of block hashes — a whole-file integrity check without a
 * full-file buffer. (A binary Merkle tree can replace this later for partial-proof needs.)
 */
export async function merkleRoot(blockHashesHex: string[]): Promise<string> {
  const joined = blockHashesHex.join('');
  const bytes = new Uint8Array(joined.length);
  for (let i = 0; i < joined.length; i += 1) bytes[i] = joined.charCodeAt(i);
  return sha256Hex(bytes);
}
