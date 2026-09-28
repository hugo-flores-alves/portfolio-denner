import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globalSetup: ['./test/global-setup.ts'],
    setupFiles: ['./test/setup-env.ts'],
    // Os testes de integração compartilham um único banco: execução sequencial
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
