import { test, expect } from '@playwright/test'
import { setupApp, unlockMaster } from './helpers.js'

// Аудит визуала: каждый экран рендерится в СВЕЖЕМ контексте, чтобы краш/лупы
// тостов на одной странице не тянули остальные. Скрин viewport (1440x900).
const PAGES = [
  'Dashboard',
  'Orders',
  'Delivery calendar',
  'Shops',
  'Catalog',
  'Cards',
  'Profiles',
  'Proxies',
  'Couriers / Packages',
  'IMAP',
  'Chat',
  'Updates',
  'Activity Log',
  'Settings',
]

const pad = n => String(n).padStart(2, '0')

for (let i = 0; i < PAGES.length; i++) {
  const label = PAGES[i]
  const safe = label.replace(/[^a-z0-9]+/gi, '_')
  test(`audit ${pad(i)} ${label}`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(String(e).slice(0, 200)))
    try {
      await setupApp(page, { autoLogin: true })
      await unlockMaster(page)
      await expect(page.locator('.main-content-wrapper')).toBeVisible({ timeout: 20000 })
      if (i > 0) {
        // первый пункт (Dashboard) уже открыт по умолчанию
        await page.locator('nav.sidebar button.sbi').nth(i).click({ timeout: 8000 })
      }
      await page.waitForTimeout(2500)
      await page.screenshot({ path: `audit-shots/${pad(i)}_${safe}.png` })
    } catch (e) {
      // всё равно снимем то, что есть на экране
      try { await page.screenshot({ path: `audit-shots/${pad(i)}_${safe}_PARTIAL.png` }) } catch {}
      require('fs').writeFileSync(
        `audit-shots/${pad(i)}_${safe}_ERR.txt`,
        String(e).slice(0, 500) + '\n\nPAGEERRORS:\n' + errors.join('\n')
      )
    }
    await ctx.close()
  })
}
