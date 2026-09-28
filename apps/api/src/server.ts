import { env } from './config/env';
import { closeDb } from './db/client';
import { logger } from './lib/logger';
import { createApp } from './app';

const server = createApp().listen(env.PORT, () => {
  logger.info(`API ouvindo em http://localhost:${env.PORT}`);
});

function shutdown(signal: string) {
  logger.info(`${signal} recebido, encerrando...`);
  server.close(() => {
    closeDb().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
