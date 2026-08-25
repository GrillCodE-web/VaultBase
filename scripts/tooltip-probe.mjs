// Диагностика клиппинга тултипов сайдбара (.sbi-tip) в свёрнутом виде.
import { chromium } from '@playwright/test'
import { buildMock, data } from './visual-mock.mjs'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript(buildMock(data))
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.waitForTimeout(4500)
const pw = page.locator('input[type="password"]')
if (await pw.count()) {
  await pw.first().fill('MockPassword1!')
  await page.locator('button.auth-btn').first().click()
  await page.waitForTimeout(2500)
}

// убедиться, что сайдбар свёрнут
const sidebar = page.locator('.sidebar').first()
if ((await sidebar.getAttribute('class'))?.includes('expanded')) {
  await page.locator('button.sbi', { hasText: /свернуть|collapse/i }).first().click()
  await page.waitForTimeout(500)
}

// наводим на пункт Catalog
const item = page.locator('button.sbi', { hasText: /catalog|каталог/i }).first()
await item.hover()
await page.waitForTimeout(400)

const probe = await page.evaluate(() => {
  const btn = [...document.querySelectorAll('button.sbi')].find(b =>
    /catalog|каталог/i.test(b.textContent)
  )
  if (!btn) return { error: 'button not found' }
  const tip = btn.querySelector('.sbi-tip')
  const tipRect = tip.getBoundingClientRect()
  const btnRect = btn.getBoundingClientRect()
  const sidebarRect = btn.closest('.sidebar').getBoundingClientRect()
  const cs = getComputedStyle(tip)
  // что находится поверх тултипа в его центре
  const atPoint = document.elementFromPoint(
    tipRect.left + Math.min(tipRect.width, 30) / 2,
    tipRect.top + tipRect.height / 2
  )
  return {
    tipText: tip.textContent,
    tipRect: { x: tipRect.x, y: tipRect.y, w: tipRect.width, h: tipRect.height },
    btnRect: { x: btnRect.x, w: btnRect.width },
    sidebarRect: { x: sidebarRect.x, w: sidebarRect.width },
    tipOpacity: cs.opacity,
    tipZ: cs.zIndex,
    sidebarOverflow: getComputedStyle(btn.closest('.sidebar')).overflow,
    sidebarOverflowX: getComputedStyle(btn.closest('.sidebar')).overflowX,
    atPoint: atPoint ? atPoint.className.toString().slice(0, 80) || atPoint.tagName : null,
  }
})
console.log(JSON.stringify(probe, null, 2))
await page.screenshot({ path: 'audit-shots/tooltip-probe.png', clip: { x: 0, y: 200, width: 400, height: 200 } })
await browser.close()
