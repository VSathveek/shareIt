import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { SignalingMessage } from '@shareit/shared';
import { isOriginAllowed } from '../security/origin';
import type { SignalingHub } from './hub';
import type { Peer } from './session-store';

export interface RouteOptions {
  originAllowlist: string[];
}

/**
 * Thin WebSocket adapter: rejects disallowed origins, then turns each socket into a `Peer`
 * (id + client-IP rate-limit key) and delegates all logic to the hub. Requires
 * `@fastify/websocket` to be registered on `app`.
 */
export function registerSignalingRoute(
  app: FastifyInstance,
  hub: SignalingHub,
  options: RouteOptions,
): void {
  app.get('/ws', { websocket: true }, (socket, req) => {
    if (!isOriginAllowed(req.headers.origin, options.originAllowlist)) {
      socket.close(1008, 'origin not allowed');
      return;
    }

    const peer: Peer = {
      id: randomUUID(),
      key: req.ip,
      send: (msg: SignalingMessage) => {
        if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
      },
    };

    socket.on('message', (data: Buffer) => hub.onMessage(peer, data.toString()));
    socket.on('close', () => hub.onClose(peer.id));
    socket.on('error', () => hub.onClose(peer.id));
  });
}
