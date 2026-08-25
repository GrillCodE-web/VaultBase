// Проверка CTA в пустых состояниях Couriers + табов IMAP.
import { chromium } from '@playwright/test'
import { buildMock, data } from './visual-mock.mjs'

const mockData = {
  ...data,
  stuffer_get_config: { api_key_set: true },
  stuffer_list_couriers: [],
  stuffer_list_available_couriers: [{ id: 2, name: 'FedEx Guy', status: 'available', city: 'Austin', zip: '73301', country: 'US' }],
  stuffer_list_packages: [],
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)))
await page.addInitScript(buildMock(mockData))
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.waitForTimeout(4500)
const pw = page.locator('input[type="password"]')
if (await pw.count()) {
  await pw.first().fill('MockPassword1!')
  await page.locator('button.auth-btn').first().click()
  await page.waitForTimeout(2500)
}

// 1. Couriers → пустое "My Couriers" должно иметь CTA, ведущий на Available
await page.locator('button.sbi', { hasText: /courier|курьер/i }).first().click()
await page.waitForTimeout(1500)
const cta = page.locator('button', { hasText: /browse available|перейти к доступным/i })
console.log('CTA на assigned-empty:', (await cta.count()) > 0 ? 'есть' : 'НЕТ')
await page.screenshot({ path: 'audit-shots/couriers-empty-cta.png' })
if (await cta.count()) {
  await cta.first().click()
  await page.waitForTimeout(1200)
  const availCard = await page.locator('.courier-card').count()
  console.log('после клика — карточек доступных:', availCard)
  await page.screenshot({ path: 'audit-shots/couriers-available.png' })
}

// 2. Packages → пустое состояние с CTA "New Package"
await page.locator('button.tab, button', { hasText: /^packages$|^посылки$/i }).first().click()
await page.waitForTimeout(1200)
const pkgCta = await page.locator('.empty-state button, [class*="empty"] button', { hasText: /new package|новая посылка/i }).count()
const pkgCtaAny = await page.locator('button', { hasText: /new package|новая посылка/i }).count()
console.log('CTA на packages-empty:', pkgCta + pkgCtaAny > 0 ? 'есть' : 'НЕТ')
await page.screenshot({ path: 'audit-shots/couriers-packages-empty.png' })

await browser.close()
