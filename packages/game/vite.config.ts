import { defineConfig } from 'vite';

// Rebate Rush — game build config.
// Telegram opens the game in an in-app webview and users bounce on slow loads,
// so the priority is a tiny bundle and a fast first paint.
//   - base './'         → works when the game is hosted under any subpath / game URL.
//   - assetsInlineLimit → small assets inline as data URIs (fewer round-trips).
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
    // Honor the harness/host-assigned port (PORT env) so the dev server doesn't
    // collide on a fixed port; fall back to Vite's default for plain local dev.
    port: process.env.PORT ? Number(process.env.PORT) : 5173,
  },
});
