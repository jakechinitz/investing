import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Use /investing/ on GitHub Pages, / for local dev
  base: process.env.GITHUB_ACTIONS ? '/investing/' : '/',
  build: {
    outDir: 'dist',
  },
});
