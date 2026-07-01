import Fastify, { type FastifyInstance } from 'fastify';
import type { Config } from './config';

/**
 * Builds the Fastify instance without binding a port, so tests can drive it via
 * `app.inject(...)` and the bootstrap (index.ts) can own the listen/shutdown lifecycle.
 *
 * Pairing (WebSocket) and TURN-credential routes are added in Phase 6; this is the
 * foundation they plug into.
 */
export function buildServer(config?: Partial<Config>): FastifyInstance {
  const app = Fastify({
    logger: { level: config?.logLevel ?? 'info' },
  });

  app.get('/health', async () => ({
    status: 'ok',
    uptime: process.uptime(),
  }));

  return app;
}
