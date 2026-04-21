import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  root: 'src',
  base: './',
  envDir: path.resolve(__dirname),
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  server: {
    port: 5173,
    hmr: {
      // Prevent full page reload when HMR WebSocket disconnects (e.g. after sleep)
      // Vite will silently retry the connection instead of reloading
      timeout: 60000,
      overlay: false,
    },
  },
});
