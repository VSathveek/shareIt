import { loadConfig } from './config';
import { buildServer } from './server';

const config = loadConfig();
const app = buildServer(config);

async function shutdown(signal: string): Promise<void> {
  app.log.info(`${signal} received — shutting down gracefully`);
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
