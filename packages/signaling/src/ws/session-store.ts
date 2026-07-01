import type { SignalingMessage } from '@shareit/shared';
import { generateCode } from '../pairing/code';

/**
 * A connected browser, abstracted away from the WebSocket so the store and hub are
 * transport-agnostic and unit-testable with a fake `send`.
 */
export interface Peer {
  readonly id: string;
  /** Stable rate-limit key (client IP); distinct from the per-connection id. */
  readonly key: string;
  send(msg: SignalingMessage): void;
}

export interface Session {
  code: string;
  creator: Peer;
  joiner?: Peer;
  createdAt: number;
}

export type JoinResult =
  | { ok: true; session: Session }
  | { ok: false; reason: 'not-found' | 'full' };

/**
 * Holds the ephemeral `code → waiting peer` map. In-memory for MVP; the interface lets a
 * Redis-backed implementation drop in at multi-instance scale (Phase 2, §6) without touching
 * the hub.
 */
export interface SessionStore {
  create(creator: Peer): Session;
  join(code: string, joiner: Peer): JoinResult;
  getByPeer(peerId: string): Session | undefined;
  counterpart(peerId: string): Peer | undefined;
  /** Removes the whole session a peer belongs to; returns it so callers can notify the other side. */
  removeByPeer(peerId: string): Session | undefined;
  /** Drops pending (un-joined) sessions older than the cutoff; returns how many were removed. */
  reapPending(maxAgeMs: number, now?: number): number;
  size(): number;
}

export class InMemorySessionStore implements SessionStore {
  private readonly sessions = new Map<string, Session>();
  private readonly peerIndex = new Map<string, string>();

  create(creator: Peer): Session {
    let code = generateCode();
    while (this.sessions.has(code)) code = generateCode();

    const session: Session = { code, creator, createdAt: Date.now() };
    this.sessions.set(code, session);
    this.peerIndex.set(creator.id, code);
    return session;
  }

  join(code: string, joiner: Peer): JoinResult {
    const session = this.sessions.get(code);
    if (!session) return { ok: false, reason: 'not-found' };
    if (session.joiner) return { ok: false, reason: 'full' };

    session.joiner = joiner;
    this.peerIndex.set(joiner.id, code);
    return { ok: true, session };
  }

  getByPeer(peerId: string): Session | undefined {
    const code = this.peerIndex.get(peerId);
    return code ? this.sessions.get(code) : undefined;
  }

  counterpart(peerId: string): Peer | undefined {
    const session = this.getByPeer(peerId);
    if (!session) return undefined;
    return session.creator.id === peerId ? session.joiner : session.creator;
  }

  removeByPeer(peerId: string): Session | undefined {
    const code = this.peerIndex.get(peerId);
    if (!code) return undefined;
    const session = this.sessions.get(code);
    this.sessions.delete(code);
    this.peerIndex.delete(session?.creator.id ?? '');
    if (session?.joiner) this.peerIndex.delete(session.joiner.id);
    return session;
  }

  reapPending(maxAgeMs: number, now: number = Date.now()): number {
    let removed = 0;
    for (const session of this.sessions.values()) {
      if (!session.joiner && now - session.createdAt > maxAgeMs) {
        this.sessions.delete(session.code);
        this.peerIndex.delete(session.creator.id);
        removed += 1;
      }
    }
    return removed;
  }

  size(): number {
    return this.sessions.size;
  }
}
