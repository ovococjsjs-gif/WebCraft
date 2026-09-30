import { defineConfig } from 'vite';
import { aliases } from './scripts/aliases';
export default defineConfig({
  root: 'apps/browser',
  resolve: { alias: aliases },
  server: { host: '0.0.0.0', port: 5173, strictPort: true, allowedHosts: true },
  preview: { host: '0.0.0.0', port: 4173, allowedHosts: true },
  build: { outDir: '../../dist', emptyOutDir: true, target: 'es2022', chunkSizeWarningLimit: 650 },
  worker: { format: 'es' },
});
