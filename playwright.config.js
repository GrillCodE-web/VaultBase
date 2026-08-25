// Playwright Configuration for VaultBase E2E tests.
// Тесты запускаются против Vite dev-сервера (npm run dev).
// Tauri invoke() мокируется через setup/tauri-mock.js, поэтому
// для E2E не нужен полный Tauri-бинарь.
//
// Запуск:  npm run test:e2e
// С UI:    npm run test:e2e:ui

import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }], ['list']],

  use: {
    // Свой порт (5199): порт 5173 занят dev-сервером РАБОЧЕЙ копии или
    // параллельной сессии — у vite.config.js strictPort, второй инстанс там падает.
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5199',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'firefox',
      use: { ...devices['Desktop Firefox'] },
    },
  ],

  outputDir: 'test-results/',

  webServer: {
    command: 'npm run dev -- --port 5199',
    url: 'http://localhost:5199',
    reuseExistingServer: !process.env.CI,
    timeout: 120000,
  },
});
