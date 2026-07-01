import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { SignalingMessage } from '@shareit/shared';
import type { SignalingHub } from './hub';
import type { Peer } from './session-store';

/**
 * Thin WebSocket adapter: each socket becomes a `Peer` with a stable id, and all logic is
 * delegated to the hub. Requires `@fastify/websocket` to be registered on `app`.
 */
export function registerSignalingRoute(app: FastifyInstance, hub: SignalingHub): void {
  app.get('/ws', { websocket: true }, (socket) => {
    const peer: Peer = {
      id: randomUUID(),
      send: (msg: SignalingMessage) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
      },
    };

    socket.on('message', (data: Buffer) => hub.onMessage(peer, data.toString()));
    socket.on('close', () => hub.onClose(peer.id));
    socket.on('error', () => hub.onClose(peer.id));
  });
}
