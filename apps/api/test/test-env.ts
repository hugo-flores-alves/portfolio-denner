/** Variáveis de ambiente da suíte de testes (banco isolado erp_test). */
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/erp_test';

export function applyTestEnv() {
  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.JWT_SECRET = 'segredo-de-teste-com-tamanho-suficiente';
  process.env.LOG_LEVEL = 'silent';
}
