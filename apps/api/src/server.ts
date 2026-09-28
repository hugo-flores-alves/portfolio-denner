import { env } from './config/env';
import { closeDb } from './db/client';
import { logger } from './lib/logger';
import { createApp } from './app';

// No Express 5 o callback do listen recebe também o erro de inicialização
const server = createApp().listen(env.PORT, (err?: NodeJS.ErrnoException) => {
  if (err) {
    logger.fatal(
      err.code === 'EADDRINUSE'
        ? `A porta ${env.PORT} já está em uso por outro programa. Encerre-o ou defina outra porta em apps/api/.env ` +
            '(ex.: PORT=3334) — o painel acompanha automaticamente.'
        : `Falha ao iniciar o servidor HTTP: ${err.message}`,
    );
    process.exit(1);
  }
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
