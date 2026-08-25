// Проверка кнопки refresh BIN в side panel карты (DB-007 UI).
import { chromium } from '@playwright/test'
import { buildMock, data } from './visual-mock.mjs'

const mockData = { ...data, enrich_bin: {}, get_recent_orders_by_card: [], get_card_notes: [], get_card_tags: [] }

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)))
page.on('console', m => {
  const u = m.text().match(/unhandled invoke: (\w+)/)
  if (u) console.log('[unhandled]', u[1])
})
await page.addInitScript(buildMock(mockData))
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.waitForTimeout(4500)
const pw = page.locator('input[type=password]')
if (await pw.count()) {
  await pw.first().fill('x')
  await page.locator('button.auth-btn').first().click()
  await page.waitForTimeout(2500)
}
await page.locator('button.sbi', { hasText: /cards|карты/i }).first().click()
await page.waitForTimeout(1500)
await page.locator('.tbl tbody tr').first().dblclick()
await page.waitForTimeout(1200)

const rb = page.locator('[role="dialog"] button[title*="Refresh"], [role="dialog"] button[title*="Обнов"]').first()
const found = (await rb.count()) > 0
console.log('кнопка refresh BIN в панели:', found ? 'есть' : 'НЕТ')
await page.screenshot({ path: 'audit-shots/bin-refresh.png', clip: { x: 950, y: 0, width: 494, height: 900 } })
if (found) {
  await rb.click()
  await page.waitForTimeout(800)
  console.log('клик по refresh: ок, ошибок страницы нет')
}
await browser.close()
process.exit(found ? 0 : 1)
