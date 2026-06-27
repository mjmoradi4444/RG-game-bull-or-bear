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
    // Pin the dev server to 5174 so it coexists with another session on Vite's
    // usual 5173. strictPort:false lets Vite auto-increment if 5174 is also taken.
    port: 5174,
    strictPort: false,
  },
});
