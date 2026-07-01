import type { SignalingMessage } from '@shareit/shared';
import { describe, expect, it } from 'vitest';
import { SignalingHub } from '../src/ws/hub';
import { InMemorySessionStore, type Peer } from '../src/ws/session-store';

function fakePeer(id: string): Peer & { sent: SignalingMessage[] } {
  const sent: SignalingMessage[] = [];
  return { id, sent, send: (msg) => sent.push(msg) };
}

function newHub() {
  const store = new InMemorySessionStore();
  const hub = new SignalingHub(store, () => [{ urls: ['stun:x'] }]);
  return { store, hub };
}

describe('SignalingHub', () => {
  it('pairs two peers and relays signals both ways', () => {
    const { hub } = newHub();
    const a = fakePeer('a');
    const b = fakePeer('b');

    hub.onMessage(a, JSON.stringify({ t: 'create' }));
    const created = a.sent[0];
    expect(created?.t).toBe('created');
    const code = created?.t === 'created' ? created.code : '';

    hub.onMessage(b, JSON.stringify({ t: 'join', code }));
    expect(b.sent[0]?.t).toBe('created');
    expect(a.sent[1]).toEqual({ t: 'peer-joined' });

    hub.onMessage(a, JSON.stringify({ t: 'signal', data: { kind: 'sdp', sdp: 'offer' } }));
    expect(b.sent.at(-1)).toEqual({ t: 'signal', data: { kind: 'sdp', sdp: 'offer' } });

    hub.onMessage(b, JSON.stringify({ t: 'signal', data: { kind: 'ice', candidate: 'c' } }));
    expect(a.sent.at(-1)).toEqual({ t: 'signal', data: { kind: 'ice', candidate: 'c' } });
  });

  it('rejects joining an unknown or full code', () => {
    const { hub } = newHub();
    const a = fakePeer('a');
    const b = fakePeer('b');
    const c = fakePeer('c');

    hub.onMessage(a, JSON.stringify({ t: 'join', code: 'ZZZZZZ' }));
    expect(a.sent[0]).toEqual({ t: 'error', reason: 'not-found' });

    hub.onMessage(a, JSON.stringify({ t: 'create' }));
    const created = a.sent.at(-1);
    const code = created?.t === 'created' ? created.code : '';
    hub.onMessage(b, JSON.stringify({ t: 'join', code }));
    hub.onMessage(c, JSON.stringify({ t: 'join', code }));
    expect(c.sent.at(-1)).toEqual({ t: 'error', reason: 'full' });
  });

  it('rejects malformed input and unsupported messages', () => {
    const { hub } = newHub();
    const a = fakePeer('a');
    hub.onMessage(a, 'not json');
    expect(a.sent[0]).toEqual({ t: 'error', reason: 'invalid message' });
    hub.onMessage(a, JSON.stringify({ t: 'join', code: 'bad' }));
    expect(a.sent[1]).toEqual({ t: 'error', reason: 'invalid code' });
  });

  it('notifies the counterpart when a peer disconnects', () => {
    const { hub } = newHub();
    const a = fakePeer('a');
    const b = fakePeer('b');
    hub.onMessage(a, JSON.stringify({ t: 'create' }));
    const created = a.sent[0];
    const code = created?.t === 'created' ? created.code : '';
    hub.onMessage(b, JSON.stringify({ t: 'join', code }));

    hub.onClose('a');
    expect(b.sent.at(-1)).toEqual({ t: 'peer-left' });
  });
});
