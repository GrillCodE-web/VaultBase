import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.js',
    exclude: [
      // Кастомный exclude ЗАМЕНЯЕТ дефолт витеста, поэтому '**/node_modules/**'
      // нужен явно — иначе тесты попадают из вложенных node_modules
      // (например manager-app/node_modules).
      '**/node_modules/**',
      'dist/',
      'e2e/**',
      '**/playwright/**',
      // manager-app is a standalone app (own lint/build toolchain), not part
      // of the worker frontend suite; otherwise its nested node_modules and
      // sources get scanned by this config's include patterns.
      'manager-app/**',
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
