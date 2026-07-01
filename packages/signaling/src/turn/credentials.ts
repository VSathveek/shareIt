import { createHmac } from 'node:crypto';
import type { IceServer } from '@shareit/shared';

export interface TurnSettings {
  stunUrls: string[];
  turnUrls: string[];
  /** Shared secret (coturn `static-auth-secret`); when absent, only STUN is advertised. */
  secret?: string;
  ttlSeconds: number;
}

/**
 * Builds the ICE server list handed to the browser.
 *
 * TURN credentials follow the coturn REST/`use-auth-secret` scheme: the username is an
 * expiry timestamp and the credential is `base64(HMAC-SHA1(secret, username))`. This mints
 * short-TTL credentials per session so relay access can't be reused indefinitely
 * (Phase 2 TURN-abuse control).
 */
export function buildIceServers(turn: TurnSettings, now: number = Date.now()): IceServer[] {
  const servers: IceServer[] = [];

  if (turn.stunUrls.length > 0) {
    servers.push({ urls: turn.stunUrls });
  }

  if (turn.turnUrls.length > 0 && turn.secret) {
    const expiry = Math.floor(now / 1000) + turn.ttlSeconds;
    const username = `${expiry}:shareit`;
    const credential = createHmac('sha1', turn.secret).update(username).digest('base64');
    servers.push({ urls: turn.turnUrls, username, credential });
  }

  return servers;
}
