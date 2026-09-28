import { fileURLToPath } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const webDir = fileURLToPath(new URL('.', import.meta.url));
const apiDir = fileURLToPath(new URL('../api', import.meta.url));

export default defineConfig(({ mode }) => {
  // Porta da API vem do mesmo apps/api/.env que a API usa: trocar em um lugar só
  const apiEnv = loadEnv(mode, apiDir, '');
  const webEnv = loadEnv(mode, webDir, '');
  const webPort = Number(webEnv.WEB_PORT || 5173);
  const apiTarget = webEnv.VITE_API_PROXY || `http://localhost:${apiEnv.PORT || 3333}`;

  return {
    plugins: [react(), tailwindcss()],
    server: {
      port: webPort,
      // Porta ocupada = erro explícito, em vez de subir em outra porta sem avisar
      // (e o navegador continuar abrindo outro projeto na porta antiga)
      strictPort: true,
      proxy: { '/api': { target: apiTarget, changeOrigin: true } },
    },
    preview: { port: webPort, strictPort: true },
  };
});
