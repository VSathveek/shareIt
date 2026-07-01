import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildIceServers } from '../src/turn/credentials';

describe('buildIceServers', () => {
  it('advertises only STUN when no TURN secret is set', () => {
    const servers = buildIceServers({
      stunUrls: ['stun:stun.example:3478'],
      turnUrls: ['turn:turn.example:3478'],
      ttlSeconds: 3600,
    });
    expect(servers).toEqual([{ urls: ['stun:stun.example:3478'] }]);
  });

  it('mints time-limited HMAC TURN credentials', () => {
    const now = 1_700_000_000_000;
    const [, turnServer] = buildIceServers(
      {
        stunUrls: ['stun:stun.example:3478'],
        turnUrls: ['turn:turn.example:3478'],
        secret: 's3cret',
        ttlSeconds: 3600,
      },
      now,
    );
    const expectedUser = `${Math.floor(now / 1000) + 3600}:shareit`;
    const expectedCred = createHmac('sha1', 's3cret').update(expectedUser).digest('base64');
    expect(turnServer).toEqual({
      urls: ['turn:turn.example:3478'],
      username: expectedUser,
      credential: expectedCred,
    });
  });
});
