/**
 * Environment-driven configuration. Fails fast on invalid input so a misconfigured
 * deploy never silently starts on the wrong port or with no origin allowlist.
 */
import type { TurnSettings } from './turn/credentials';

export interface SecuritySettings {
  createPerMinute: number;
  joinPerMinute: number;
}

export interface Config {
  host: string;
  port: number;
  /** Allowed browser origins for CORS / WebSocket upgrade (empty = allow all, dev only). */
  originAllowlist: string[];
  logLevel: string;
  turn: TurnSettings;
  security: SecuritySettings;
}

const DEFAULT_STUN = 'stun:stun.l.google.com:19302';

function csv(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${String(env.PORT)}`);
  }

  const ttlSeconds = Number(env.TURN_TTL ?? 86400);
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error(`Invalid TURN_TTL: ${String(env.TURN_TTL)}`);
  }

  const createPerMinute = Number(env.CREATE_PER_MIN ?? 20);
  const joinPerMinute = Number(env.JOIN_PER_MIN ?? 30);
  if (createPerMinute <= 0 || joinPerMinute <= 0) {
    throw new Error('rate limits must be positive');
  }

  return {
    host: env.HOST ?? '0.0.0.0',
    port,
    originAllowlist: csv(env.ORIGIN_ALLOWLIST),
    logLevel: env.LOG_LEVEL ?? 'info',
    turn: {
      stunUrls: csv(env.STUN_URLS ?? DEFAULT_STUN),
      turnUrls: csv(env.TURN_URLS),
      secret: env.TURN_SECRET || undefined,
      ttlSeconds,
    },
    security: { createPerMinute, joinPerMinute },
  };
}
