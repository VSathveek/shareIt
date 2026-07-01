import { loadConfig } from './config';
import { buildServer } from './server';

const PENDING_TTL_MS = 10 * 60 * 1000; // drop un-joined codes after 10 minutes
const REAP_INTERVAL_MS = 60 * 1000;

const config = loadConfig();
const app = buildServer(config);

app.log.info(
  {
    port: config.port,
    originAllowlist: config.originAllowlist.length > 0 ? config.originAllowlist : 'ALL (dev)',
    turnEnabled: config.turn.turnUrls.length > 0 && Boolean(config.turn.secret),
    rateLimits: config.security,
  },
  'signaling configuration',
);

const reaper = setInterval(() => {
  const removed = app.sessionStore.reapPending(PENDING_TTL_MS);
  if (removed > 0) app.log.debug(`reaped ${removed} pending session(s)`);
}, REAP_INTERVAL_MS);
reaper.unref();

async function shutdown(signal: string): Promise<void> {
  app.log.info(`${signal} received — shutting down gracefully`);
  clearInterval(reaper);
  try {
    await app.close();
    process.exit(0);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error(err);
  process.exit(1);
}
