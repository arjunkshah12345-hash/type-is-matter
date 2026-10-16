import { defineConfig } from 'vite';
// GitHub Pages serves the build under /type-is-matter/; dev stays at / so local tests and URLs are unchanged.
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/type-is-matter/' : '/',
  server: { allowedHosts: true }, preview: { allowedHosts: true },
  build: { target: 'es2022', chunkSizeWarningLimit: 3000 },
}));
