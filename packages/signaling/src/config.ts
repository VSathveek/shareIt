/**
 * Environment-driven configuration. Fails fast on invalid input so a misconfigured
 * deploy never silently starts on the wrong port or with no origin allowlist.
 */
export interface Config {
  host: string;
  port: number;
  /** Allowed browser origins for CORS / WebSocket upgrade (empty = allow all, dev only). */
  originAllowlist: string[];
  logLevel: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? 8080);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`Invalid PORT: ${String(env.PORT)}`);
  }

  return {
    host: env.HOST ?? '0.0.0.0',
    port,
    originAllowlist: (env.ORIGIN_ALLOWLIST ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    logLevel: env.LOG_LEVEL ?? 'info',
  };
}
