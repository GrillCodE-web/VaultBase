import { expect } from '@playwright/test'
import { getTauriMockScript } from './setup/tauri-mock.js'

/** init-скрипт мока + загрузка приложения (без ожидания app-shell). */
export async function setupApp(page, { autoLogin = true } = {}) {
  if (process.env.E2E_VERBOSE) {
    page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 400)))
    page.on('console', m => {
      const txt = m.text()
      if (txt.includes('unhandled command') || m.type() === 'error') {
        console.log('[browser]', m.type(), txt.slice(0, 300))
      }
    })
  }
  await page.addInitScript({
    content: getTauriMockScript() + '\nwindow.__e2e.autoLogin = ' + (autoLogin === false ? 'false' : 'true') + ';\n',
  })
  await page.goto('/')
}

/** setupApp + ожидание основного интерфейса (MainShell). */
export async function bootApp(page, { autoLogin = true } = {}) {
  await setupApp(page, { autoLogin })
  await unlockMaster(page)
  await expect(page.locator('.main-content-wrapper')).toBeVisible({ timeout: 20000 })
}

/** Реальный флоу приложения: экран мастер-пароля (Login) → кнопка Unlock. */
export async function unlockMaster(page) {
  const pwInput = page.locator('.auth-input[placeholder="••••••••••••"]').first()
  // 30s: под параллельными воркерами (особенно firefox) первый рендер может
  // превышать прежние 15s — это тайминги dev-Vite, не регрессия приложения.
  await expect(pwInput).toBeVisible({ timeout: 30000 })
  await pwInput.fill('E2eMasterPass1!')
  await page.locator('.auth-card button.auth-btn').first().click()
}

/** Клик по пункту сайдбара (кнопки .sbi, подпись в .sbi-label). */
export async function navTo(page, label) {
  await page.locator('button.sbi', { hasText: label }).first().click()
}

/** Текущее значение из инстанса мока (например 'state.orders'). */
export function mockState(page, path) {
  const keys = path.split('.')
  return page.evaluate(
    ks => {
      let cur = window.__e2e
      for (const k of ks) cur = cur ? cur[k] : undefined
      return JSON.parse(JSON.stringify(cur === undefined ? null : cur))
    },
    keys
  )
}

/** Список вызванных команд моком. */
export function mockCommands(page) {
  return page.evaluate(() => [...window.__e2e.commands])
}
