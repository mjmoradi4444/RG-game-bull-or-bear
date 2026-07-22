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
    // Honor the port assigned by the harness (PORT env, via launch.json autoPort);
    // strictPort keeps Vite from silently drifting to another port and desyncing
    // from the preview manager. Falls back to 5173 for a plain `npm run dev`.
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
    allowedHosts: true,
  },
});
