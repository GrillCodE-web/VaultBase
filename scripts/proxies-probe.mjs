// Проверка: страница Proxies рендерит таблицу (не вечный спиннер).
import { chromium } from '@playwright/test'
import { buildMock, data } from './visual-mock.mjs'

const mockData = {
  ...data,
  get_proxies: {
    items: [
      { id: 1, label: 'proxy-us-1', host: 'us.proxy.com', port: 8080, type: 'http', is_blocked: false, last_checked_at: new Date().toISOString(), shops_used: [1, 2] },
      { id: 2, label: 'proxy-de-1', host: 'de.proxy.com', port: 1080, type: 'socks5', is_blocked: true, last_checked_at: new Date().toISOString(), shops_used: [] },
    ],
    total: 2,
  },
  get_proxy_usage_stats: { total: 2, healthy: 1, dead: 1 },
  get_all_proxy_shop_bindings: [],
}

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 200)))
page.on('console', m => {
  if (m.type() === 'error') console.log('[err]', m.text().slice(0, 160).replace(/\n/g, ' '))
  const u = m.text().match(/\[visual-mock\] unhandled invoke: (\w+)/)
  if (u) console.log('[unhandled]', u[1])
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

await page.locator('button.sbi', { hasText: /proxies|прокси/i }).first().click()
await page.waitForTimeout(3000)

const rows = await page.locator('.tbl tbody tr').count()
const spinner = await page.locator('.spinner, .spinner-container').count()
const crash = await page.locator('text=Something went wrong').count()
console.log('rows:', rows, '| spinner:', spinner, '| crash:', crash)
await page.screenshot({ path: 'audit-shots/proxies-check.png' })
await browser.close()
