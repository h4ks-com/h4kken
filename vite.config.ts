import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        debug: resolve(__dirname, 'debug.html'),
        arenaDebug: resolve(__dirname, 'arena-debug.html'),
      },
    },
  },
  server: {
    proxy: {
      '/ws': { target: 'ws://localhost:3000', ws: true, rewriteWsOrigin: true },
      '/api': 'http://localhost:3000',
    },
  },
});
