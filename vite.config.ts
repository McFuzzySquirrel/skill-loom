import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * The web build is emitted to dist/web so the Fastify production server can
 * serve the API and the UI from a single loopback origin.
 */
export default defineConfig({
  plugins: [react()],
  root: '.',
  build: {
    outDir: 'dist/web',
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      // Development only: the server owns /api.
      '/api': {
        target: 'http://127.0.0.1:7373',
      },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
  },
});
