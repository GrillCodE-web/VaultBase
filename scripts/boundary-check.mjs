// Проверка: ErrorBoundary с resetKey=page обязан сбрасываться при навигации
// после краша страницы. node scripts/boundary-check.mjs (dev-сервер :5173)
import { chromium } from '@playwright/test'
import { buildMock, data } from './visual-mock.mjs'

// ломаем IMAP намеренно: list_domain_routes → null
const mockData = { ...data, get_imap_accounts: [{ id: 1, email: 'a@b.c' }], get_imap_messages: { items: [], total: 0 } }
delete mockData.list_domain_routes

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', m => {
  if (m.type() === 'error') console.log('[err]', m.text().slice(0, 160).replace(/\n/g, ' '))
})

await page.addInitScript(buildMock(mockData))
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.waitForTimeout(4500)
const pw = page.locator('input[type="password"]')
if (await pw.count()) {
  await pw.first().fill('MockPassword1!')
  await page.locator('button.auth-btn').first().click()
  await page.waitForTimeout(2500)
}

// 1. Идём на IMAP — ждём крах
await page.locator('button.sbi', { hasText: /imap/i }).first().click()
await page.waitForTimeout(1500)
const crashed1 = await page.locator('text=Something went wrong').count()
console.log('после IMAP — crash UI:', crashed1 > 0 ? 'ДА' : 'нет')

// 2. Идём на Activity Log — boundary обязан сброситься
await page.locator('button.sbi', { hasText: /activity|активност/i }).first().click()
await page.waitForTimeout(1500)
const crashed2 = await page.locator('text=Something went wrong').count()
console.log('после Activity Log — crash UI:', crashed2 > 0 ? 'ДА (БАГ: reset не сработал)' : 'нет (reset ок)')

// 3. И обратно на дашборд
await page.locator('button.sbi').first().click()
await page.waitForTimeout(1200)
const crashed3 = await page.locator('text=Something went wrong').count()
console.log('после Dashboard — crash UI:', crashed3 > 0 ? 'ДА (БАГ)' : 'нет (ок)')

await browser.close()
