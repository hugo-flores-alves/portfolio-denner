/**
 * Build para o Vercel via Build Output API (v3).
 *
 *   .vercel/output/static/              painel React (Vite)
 *   .vercel/output/functions/api.func/  API Express empacotada em um único arquivo
 *   .vercel/output/config.json          rotas: /api/* → função; resto → SPA
 *
 * Empacotar a API evita depender da resolução de módulos em runtime
 * (imports sem extensão, pacote @erp/shared em TypeScript).
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { build } from 'esbuild';

const out = '.vercel/output';
rmSync(out, { recursive: true, force: true });

execSync('npm run build -w @erp/web', { stdio: 'inherit' });
cpSync('apps/web/dist', `${out}/static`, { recursive: true });

const fn = `${out}/functions/api.func`;
mkdirSync(fn, { recursive: true });
await build({
  entryPoints: ['apps/api/src/vercel.ts'],
  outfile: `${fn}/index.mjs`,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  sourcemap: true,
  // Dependências CommonJS dentro de um bundle ESM ainda chamam require()
  banner: { js: "import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" },
  // Opcionais que o código nunca carrega em produção
  external: ['pg-native', 'pino-pretty'],
  logLevel: 'info',
});

writeFileSync(
  `${fn}/.vc-config.json`,
  JSON.stringify(
    {
      runtime: 'nodejs22.x',
      handler: 'index.mjs',
      launcherType: 'Nodejs',
      // Sem helpers do Vercel: o Express lê o corpo da requisição sozinho
      shouldAddHelpers: false,
      shouldAddSourcemapSupport: true,
      maxDuration: 60,
      // Garante o modo produção na função, independente das variáveis do projeto
      environment: { NODE_ENV: 'production' },
      // São Paulo, perto do banco (Supabase sa-east-1)
      regions: ['gru1'],
    },
    null,
    2,
  ),
);

writeFileSync(
  `${out}/config.json`,
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/api(?:/.*)?$', dest: '/api' },
        {
          src: '^/assets/(.*)$',
          headers: { 'cache-control': 'public, max-age=31536000, immutable' },
          continue: true,
        },
        { handle: 'filesystem' },
        // Rotas do React Router (ex.: /ordens-servico/123) caem no index.html
        { src: '^/(.*)$', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);

console.log('✔ Build Output API gerado em .vercel/output');
