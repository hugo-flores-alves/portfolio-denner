import { defineConfig } from 'tsup';

export default defineConfig({
  entry: {
    server: 'src/server.ts',
    migrate: 'src/db/migrate.ts',
    seed: 'src/db/seed.ts',
    'import-products': 'src/scripts/import-products.ts',
  },
  format: ['esm'],
  target: 'node20',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  // O pacote compartilhado é TypeScript puro: embutimos no bundle
  noExternal: ['@erp/shared'],
});
