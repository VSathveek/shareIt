import type { AddressInfo } from 'node:net';
import type { SignalingMessage } from '@shareit/shared';
import { WebSocket } from 'ws';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer } from '../src/server';

/**
 * End-to-end proof over a real WebSocket: two clients connect, pair by code, and relay an
 * SDP offer through the running server.
 */
describe('signaling over a live WebSocket', () => {
  const app = buildServer({ logLevel: 'silent' });
  let url = '';

  beforeAll(async () => {
    await app.listen({ host: '127.0.0.1', port: 0 });
    const { port } = app.server.address() as AddressInfo;
    url = `ws://127.0.0.1:${port}/ws`;
  });

  afterAll(async () => {
    await app.close();
  });

  function open(): Promise<WebSocket> {
    const ws = new WebSocket(url);
    return new Promise((resolve, reject) => {
      ws.once('open', () => resolve(ws));
      ws.once('error', reject);
    });
  }

  function next(ws: WebSocket): Promise<SignalingMessage> {
    return new Promise((resolve) => {
      ws.once('message', (data) => resolve(JSON.parse(data.toString()) as SignalingMessage));
    });
  }

  it('pairs two clients and relays a signal', async () => {
    const creator = await open();
    creator.send(JSON.stringify({ t: 'create' }));
    const created = await next(creator);
    expect(created.t).toBe('created');
    const code = created.t === 'created' ? created.code : '';

    const joiner = await open();
    const joinerCreated = next(joiner);
    const peerJoined = next(creator);
    joiner.send(JSON.stringify({ t: 'join', code }));
    expect((await joinerCreated).t).toBe('created');
    expect((await peerJoined).t).toBe('peer-joined');

    const relayed = next(joiner);
    creator.send(JSON.stringify({ t: 'signal', data: { kind: 'sdp', sdp: 'offer-1' } }));
    const msg = await relayed;
    expect(msg).toEqual({ t: 'signal', data: { kind: 'sdp', sdp: 'offer-1' } });

    creator.close();
    joiner.close();
  });
});
