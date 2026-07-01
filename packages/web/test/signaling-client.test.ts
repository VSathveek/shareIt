import type { SignalingMessage } from '@shareit/shared';
import { describe, expect, it, vi } from 'vitest';
import { SignalingClient, type SocketLike } from '../src/connection/signaling-client';

/** Controllable fake socket that records sends and lets the test drive lifecycle events. */
class FakeSocket implements SocketLike {
  readyState = 0;
  sent: string[] = [];
  onopen: ((ev?: unknown) => void) | null = null;
  onclose: ((ev?: unknown) => void) | null = null;
  onerror: ((ev?: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;

  send(data: string): void {
    this.sent.push(data);
  }
  close(): void {
    this.readyState = 3;
    this.onclose?.();
  }
  fireOpen(): void {
    this.readyState = 1;
    this.onopen?.();
  }
  deliver(msg: SignalingMessage): void {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
}

describe('SignalingClient', () => {
  it('buffers messages until open, then flushes them', () => {
    const socket = new FakeSocket();
    const client = new SignalingClient('ws://x', { socketFactory: () => socket });

    client.connect();
    client.create(); // queued before open
    expect(socket.sent).toHaveLength(0);

    socket.fireOpen();
    expect(socket.sent).toEqual([JSON.stringify({ t: 'create' })]);
  });

  it('emits typed events for created / peer-joined / signal', () => {
    const socket = new FakeSocket();
    const client = new SignalingClient('ws://x', { socketFactory: () => socket });
    const created = vi.fn();
    const peerJoined = vi.fn();
    const signal = vi.fn();
    client.on('created', created);
    client.on('peer-joined', peerJoined);
    client.on('signal', signal);

    client.connect();
    socket.fireOpen();
    socket.deliver({ t: 'created', code: 'ABCDEF', iceServers: [{ urls: 'stun:x' }] });
    socket.deliver({ t: 'peer-joined' });
    socket.deliver({ t: 'signal', data: { kind: 'sdp', sdp: 'o' } });

    expect(created).toHaveBeenCalledWith({ code: 'ABCDEF', iceServers: [{ urls: 'stun:x' }] });
    expect(peerJoined).toHaveBeenCalledOnce();
    expect(signal).toHaveBeenCalledWith({ kind: 'sdp', sdp: 'o' });
  });

  it('reconnects with backoff after an unexpected close', () => {
    let built = 0;
    const sockets: FakeSocket[] = [];
    const scheduled: Array<() => void> = [];
    const client = new SignalingClient('ws://x', {
      socketFactory: () => {
        built += 1;
        const s = new FakeSocket();
        sockets.push(s);
        return s;
      },
      setTimeoutFn: (fn) => scheduled.push(fn),
    });

    client.connect();
    sockets[0]?.fireOpen();
    sockets[0]?.onclose?.(); // unexpected drop
    expect(scheduled).toHaveLength(1);

    scheduled[0]?.(); // fire the backoff timer
    expect(built).toBe(2);
  });

  it('does not reconnect after an explicit close', () => {
    const socket = new FakeSocket();
    const scheduled: Array<() => void> = [];
    const client = new SignalingClient('ws://x', {
      socketFactory: () => socket,
      setTimeoutFn: (fn) => scheduled.push(fn),
    });
    client.connect();
    socket.fireOpen();
    client.close();
    expect(scheduled).toHaveLength(0);
  });
});
