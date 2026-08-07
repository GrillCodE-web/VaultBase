import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    exclude: [
      'node_modules/',
      'dist/',
      'e2e/**',
      '**/playwright/**',
      // Server-side suites use Node's built-in test runner, not vitest.
      // Run them with: npm test --prefix cc-sync-server
      'cc-sync-server/**',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.test.{js,jsx}',
        'src-tauri/',
        'dist/',
        '*.config.js',
      ],
    },
  },
})
