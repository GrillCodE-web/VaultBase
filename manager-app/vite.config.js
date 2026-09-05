import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  css: { postcss: { plugins: [] } },
  server: {
    port: 5175,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    outDir: 'dist',
  },
})
