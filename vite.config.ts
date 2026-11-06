import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { localLibrary, securityHeaders } from './backend/lib.mjs';

const encoderModule = (): Plugin => ({
  name: 'software-encoder-esm',
  enforce: 'pre',
  load(id: string) {
    const path = id.split('?')[0];
    if (!path.endsWith('h264-mp4-encoder.web.js')) return;
    const source = readFileSync(path, 'utf8');
    const binding = 'A.FS=E.FS,A';
    if (source.split(binding).length !== 2) throw new Error('Pinned encoder memory instrumentation no longer matches. Review the adapter before updating.');
    return source.replace(binding, 'Object.defineProperty(A,"wasmMemoryBytes",{get:function(){return E.HEAPU8.byteLength}}),A.FS=E.FS,A') + '\nexport default HME;';
  },
});
export default defineConfig({
  plugins: [
    encoderModule(),
    react(),
    {
      name: 'local-read-only-library',
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          for (const [name, value] of Object.entries(securityHeaders(false, Boolean(request.url?.includes('/src/render.worker.ts'))))) response.setHeader(name, value);
          if (localLibrary(request, response)) return;
          next();
        });
      },
    },
  ],
  server: {
    fs: { deny: ['.env', '.env.*', '**/*.{crt,pem}', '**/data/**', '**/outputs/**'] },
    watch: { ignored: ['**/test-results/**', '**/playwright-report/**', '**/.venv/**', '**/data/**', '**/outputs/**'] },
  },
  html: { cspNonce: 'shopreel-local-dev' },
  build: { target: 'es2022', sourcemap: false },
  worker: { format: 'es', plugins: () => [encoderModule()] },
  optimizeDeps: { exclude: ['h264-mp4-encoder'], include: ['mediabunny', '@mediabunny/mp3-encoder'] },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
