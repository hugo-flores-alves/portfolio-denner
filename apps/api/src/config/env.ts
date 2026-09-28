import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3333),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL é obrigatória'),
  JWT_SECRET: z.string().min(16, 'JWT_SECRET deve ter ao menos 16 caracteres'),
  JWT_EXPIRES_IN: z.string().default('12h'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  /** Fuso usado para agrupar métricas por dia no dashboard. */
  APP_TIMEZONE: z.string().default('America/Sao_Paulo'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  IMPORT_MAX_FILE_MB: z.coerce.number().positive().default(15),
  IMPORT_MAX_ROWS: z.coerce.number().int().positive().default(50_000),
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Variáveis de ambiente inválidas:\n${details}`);
  }
  if (parsed.data.NODE_ENV === 'production' && parsed.data.JWT_SECRET.startsWith('troque')) {
    throw new Error('Defina um JWT_SECRET real em produção.');
  }
  return parsed.data;
}

export const env = loadEnv();
