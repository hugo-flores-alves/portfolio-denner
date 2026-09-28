import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { pinoHttp } from 'pino-http';
import { env } from './config/env';
import { pool } from './db/client';
import { logger } from './lib/logger';
import { authenticate } from './middleware/auth';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { authRouter } from './modules/auth/auth.routes';
import { customersRouter } from './modules/customers/customers.routes';
import { dashboardRouter } from './modules/dashboard/dashboard.routes';
import { importsRouter } from './modules/imports/imports.routes';
import { inventoryRouter } from './modules/inventory/inventory.routes';
import { metaRouter } from './modules/meta/meta.routes';
import { productsRouter } from './modules/products/products.routes';
import { rolesRouter } from './modules/roles/roles.routes';
import { salesRouter } from './modules/sales/sales.routes';
import { serviceOrdersRouter } from './modules/service-orders/service-orders.routes';
import { storesRouter } from './modules/stores/stores.routes';
import { transfersRouter } from './modules/transfers/transfers.routes';
import { usersRouter } from './modules/users/users.routes';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({ origin: env.CORS_ORIGIN.split(',').map((o) => o.trim()), exposedHeaders: ['Content-Disposition'] }));
  app.use(express.json({ limit: '2mb' }));
  if (env.NODE_ENV !== 'test') app.use(pinoHttp({ logger, autoLogging: { ignore: (req) => req.url === '/api/health' } }));

  app.get('/api/health', async (_req, res) => {
    await pool.query('select 1');
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  const api = Router();
  api.use('/auth', authRouter);

  // Todas as rotas abaixo exigem autenticação
  api.use(authenticate);
  api.use('/meta', metaRouter);
  api.use('/dashboard', dashboardRouter);
  api.use('/stores', storesRouter);
  api.use('/roles', rolesRouter);
  api.use('/users', usersRouter);
  api.use('/customers', customersRouter);
  api.use('/products', productsRouter);
  api.use('/stock', inventoryRouter);
  api.use('/stock-transfers', transfersRouter);
  api.use('/service-orders', serviceOrdersRouter);
  api.use('/sales', salesRouter);
  api.use('/imports', importsRouter);

  app.use('/api', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
