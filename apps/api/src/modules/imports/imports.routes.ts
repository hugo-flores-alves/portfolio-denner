import { Router } from 'express';
import multer from 'multer';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { IMPORT_MODES, IMPORT_STOCK_MODES } from '@erp/shared';
import { env } from '../../config/env';
import { db } from '../../db/client';
import { importJobs, users } from '../../db/schema';
import { badRequest, notFound } from '../../lib/errors';
import { paginationSchema, toLimitOffset } from '../../lib/pagination';
import { idParamsSchema, queryBoolean, uuidSchema } from '../../lib/validation';
import { getAuth, requireAnyPermission, requirePermission } from '../../middleware/auth';
import { hasGlobalAccess } from '../auth/auth-context';
import { detectFileType } from './file-parser';
import { importProducts, listStoresForTemplate } from './product-import.service';
import { buildCsvTemplate, buildXlsxTemplate } from './template';

export const importsRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.IMPORT_MAX_FILE_MB * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    try {
      detectFileType(file.originalname);
      cb(null, true);
    } catch (err) {
      cb(err as Error);
    }
  },
});

const importOptionsSchema = z.object({
  mode: z.enum(IMPORT_MODES).default('UPSERT'),
  stockMode: z.enum(IMPORT_STOCK_MODES).default('SET'),
  dryRun: queryBoolean,
  strict: queryBoolean,
  defaultStoreId: uuidSchema.optional(),
});

/**
 * POST /imports/products (multipart/form-data)
 *   file            .csv ou .xlsx
 *   mode            CREATE_ONLY | UPSERT (padrão UPSERT)
 *   stockMode       SET | ADD (padrão SET)
 *   dryRun          true → só valida e devolve a pré-visualização
 *   strict          true → qualquer erro cancela a importação inteira
 *   defaultStoreId  loja para a coluna única "quantidade"
 */
importsRouter.post('/products', requirePermission('imports.execute'), upload.single('file'), async (req, res) => {
  const auth = getAuth(req);
  if (!req.file) throw badRequest('Envie o arquivo no campo "file"');
  const options = importOptionsSchema.parse(req.body ?? {});
  // Multer entrega o nome em latin1; restaura acentos de nomes UTF-8
  const fileName = Buffer.from(req.file.originalname, 'latin1').toString('utf8');

  const report = await importProducts(
    { buffer: req.file.buffer, fileName },
    {
      ...options,
      allowedStoreIds: hasGlobalAccess(auth) ? null : auth.storeId ? [auth.storeId] : [],
    },
    { userId: auth.userId },
  );
  const status = report.status === 'FAILED' ? 422 : report.dryRun ? 200 : 201;
  res.status(status).json(report);
});

importsRouter.get(
  '/products/template',
  requireAnyPermission('imports.execute', 'imports.view'),
  async (req, res) => {
    const format = z.enum(['csv', 'xlsx']).default('xlsx').parse(req.query.format);
    const stores = await listStoresForTemplate();
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="modelo-importacao-produtos.csv"');
      res.send(buildCsvTemplate(stores));
      return;
    }
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename="modelo-importacao-produtos.xlsx"');
    res.send(await buildXlsxTemplate(stores));
  },
);

importsRouter.get('/', requirePermission('imports.view'), async (req, res) => {
  const q = paginationSchema.parse(req.query);
  const { limit, offset } = toLimitOffset(q);
  const [data, [count]] = await Promise.all([
    db
      .select({
        id: importJobs.id,
        fileName: importJobs.fileName,
        fileType: importJobs.fileType,
        mode: importJobs.mode,
        stockMode: importJobs.stockMode,
        status: importJobs.status,
        totalRows: importJobs.totalRows,
        createdCount: importJobs.createdCount,
        updatedCount: importJobs.updatedCount,
        skippedCount: importJobs.skippedCount,
        errorCount: importJobs.errorCount,
        stockEntries: importJobs.stockEntries,
        durationMs: importJobs.durationMs,
        createdAt: importJobs.createdAt,
        userName: users.name,
      })
      .from(importJobs)
      .leftJoin(users, eq(users.id, importJobs.userId))
      .orderBy(desc(importJobs.createdAt))
      .limit(limit)
      .offset(offset),
    db.select({ total: sql<number>`count(*)::int` }).from(importJobs),
  ]);
  res.json({ data, total: count?.total ?? 0, page: q.page, pageSize: q.pageSize });
});

importsRouter.get('/:id', requirePermission('imports.view'), async (req, res) => {
  const { id } = idParamsSchema.parse(req.params);
  const [job] = await db
    .select({ job: importJobs, userName: users.name })
    .from(importJobs)
    .leftJoin(users, eq(users.id, importJobs.userId))
    .where(eq(importJobs.id, id));
  if (!job) throw notFound('Importação não encontrada');
  res.json({ ...job.job, userName: job.userName });
});
