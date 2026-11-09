import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// Strict CSP for the packaged app; the dev build additionally allows the Vite HMR socket.
const PROD_CSP = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const DEV_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' ws://localhost:5173; object-src 'none'";

function csp(): Plugin {
  return {
    name: 'csp',
    transformIndexHtml: {
      order: 'pre',
      handler(html, ctx) {
        return html.replace('%CSP%', ctx.server ? DEV_CSP : PROD_CSP);
      },
    },
  };
}

export default defineConfig({
  root: '.',
  base: './',
  plugins: [react(), csp()],
  build: { outDir: 'dist/renderer', emptyOutDir: true, assetsInlineLimit: 0, chunkSizeWarningLimit: 2000, target: 'chrome130' },
  server: { port: 5173, strictPort: true },
});
