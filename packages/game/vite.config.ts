import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 4096,
    sourcemap: false,
    cssMinify: true,
  },
  server: {
    host: true,
    port: 5174,
    strictPort: false,
    allowedHosts: true,
    
  },
});
