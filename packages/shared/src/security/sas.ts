import { sha256Hex } from '../transfer/integrity';

/**
 * Short Authentication String (SAS) — defends against a malicious signaling server performing a
 * man-in-the-middle. WebRTC's DTLS makes the media path E2E *if signaling is trusted*; if the
 * server swapped the SDP, the two peers would end up with different DTLS fingerprints. Deriving
 * a short code from both fingerprints lets the users compare it out-of-band and detect tampering.
 */

/** Extracts the DTLS fingerprint (hex, lowercased) from an SDP blob, or null if absent. */
export function parseDtlsFingerprint(sdp: string): string | null {
  const match = /a=fingerprint:\S+\s+([0-9A-Fa-f:]+)/.exec(sdp);
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * Derives a 6-digit verification code from the two DTLS fingerprints. Order-independent (the
 * inputs are sorted) so both peers compute the same code.
 */
export async function deriveShortAuthString(fingerprintA: string, fingerprintB: string): Promise<string> {
  const [x, y] = [fingerprintA, fingerprintB].sort();
  const input = `${x}|${y}`;
  const bytes = new Uint8Array(input.length);
  for (let i = 0; i < input.length; i += 1) bytes[i] = input.charCodeAt(i);

  const hex = await sha256Hex(bytes);
  const code = parseInt(hex.slice(0, 8), 16) % 1_000_000;
  return String(code).padStart(6, '0');
}
