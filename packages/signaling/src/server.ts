import fastifyWebsocket from '@fastify/websocket';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Config, SecuritySettings } from './config';
import { SlidingWindowLimiter } from './security/rate-limiter';
import { buildIceServers, type TurnSettings } from './turn/credentials';
import { SignalingHub } from './ws/hub';
import { registerSignalingRoute } from './ws/route';
import { InMemorySessionStore } from './ws/session-store';

const NO_TURN: TurnSettings = { stunUrls: [], turnUrls: [], ttlSeconds: 86400 };
const DEFAULT_SECURITY: SecuritySettings = { createPerMinute: 20, joinPerMinute: 30 };
const MINUTE_MS = 60 * 1000;

/** Signaling messages are tiny (SDP/ICE); cap payload size to blunt abuse. */
const MAX_WS_PAYLOAD = 64 * 1024;

/**
 * Builds the Fastify instance without binding a port, so tests can drive it via
 * `app.inject(...)` or a real listen. Registers the health route and the WebSocket
 * signaling endpoint backed by an in-memory session store.
 */
export function buildServer(config?: Partial<Config>): FastifyInstance {
  const app = Fastify({
    logger: { level: config?.logLevel ?? 'info' },
    // Behind Cloudflare/Railway, use X-Forwarded-For so rate-limit keys are real client IPs
    // (otherwise every client shares the proxy IP and one abuser throttles everyone).
    trustProxy: true,
  });

  app.get('/health', async () => ({ status: 'ok', uptime: process.uptime() }));

  const turn = config?.turn ?? NO_TURN;
  const security = config?.security ?? DEFAULT_SECURITY;
  const originAllowlist = config?.originAllowlist ?? [];

  const store = new InMemorySessionStore();
  const hub = new SignalingHub(store, () => buildIceServers(turn), {
    create: new SlidingWindowLimiter(security.createPerMinute, MINUTE_MS),
    join: new SlidingWindowLimiter(security.joinPerMinute, MINUTE_MS),
  });

  app.get('/metrics', async () => ({
    uptime: process.uptime(),
    activeSessions: store.size(),
    ...hub.getMetrics(),
  }));

  app.register(fastifyWebsocket, { options: { maxPayload: MAX_WS_PAYLOAD } });
  app.register(async (scoped) => {
    registerSignalingRoute(scoped, hub, { originAllowlist });
  });

  app.decorate('sessionStore', store);
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    sessionStore: InMemorySessionStore;
  }
}
