import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Pages serves a static product introduction; the workspace still uses Fastify.
export default defineConfig({
  root: fileURLToPath(new URL('./site', import.meta.url)),
  build: {
    outDir: fileURLToPath(new URL('./dist-pages', import.meta.url)),
    emptyOutDir: true,
  },
});
