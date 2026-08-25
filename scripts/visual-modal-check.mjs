// Проверка модалок: геометрия оверлея/диалога и fill-mode .page-enter.
// Запуск: node scripts/visual-modal-check.mjs (нужен dev-сервер на :5173)
// Результат: audit-shots/modal-orders.png, modal-couriers.png + вердикты в консоль.

import { chromium } from '@playwright/test'
import { buildMock, data } from './visual-mock.mjs'

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)))
page.on('console', m => {
  const t = m.text()
  if (m.type() === 'error') console.log('[err]', t.slice(0, 200))
  const u = t.match(/\[visual-mock\] unhandled invoke: (\w+)/)
  if (u) console.log('[unhandled]', u[1])
})

await page.addInitScript(buildMock(data))

const results = []
const check = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(ok ? 'PASS' : 'FAIL', name, '—', detail)
}

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.waitForTimeout(4500)
const pw = page.locator('input[type="password"]')
if (await pw.count()) {
  await pw.first().fill('MockPassword1!')
  await page.locator('button.auth-btn').first().click()
  await page.waitForTimeout(2500)
}

// 1. Корневой фикс: после анимации .page-enter transform обязан быть none
await page.waitForTimeout(600)
const transform = await page.evaluate(() => {
  const el = document.querySelector('.page-enter')
  return el ? getComputedStyle(el).transform : '(no .page-enter)'
})
check('page-enter transform сброшен', transform === 'none', `transform: ${transform}`)

// 2. Orders → модалка создания заказа (шаред Modal → портал)
await page.locator('button.sbi', { hasText: /orders|заказ/i }).first().click()
await page.waitForTimeout(1200)
await page.locator('button', { hasText: /create order|новый заказ/i }).first().click()
await page.waitForTimeout(900)

const overlayBox = await page.locator('.modal-overlay').first().boundingBox()
check(
  'оверлей покрывает всё окно',
  !!overlayBox && overlayBox.x <= 1 && overlayBox.y <= 1 && overlayBox.width >= 1430 && overlayBox.height >= 890,
  overlayBox ? `x=${overlayBox.x} y=${overlayBox.y} w=${overlayBox.width} h=${overlayBox.height}` : 'overlay not found'
)

const dBox = await page.locator('[role="dialog"]').first().boundingBox()
const centered = dBox && Math.abs(dBox.x + dBox.width / 2 - 720) < 40 && Math.abs(dBox.y + dBox.height / 2 - 450) < 120
check('диалог по центру viewport', !!centered, dBox ? `cx=${Math.round(dBox.x + dBox.width / 2)} cy=${Math.round(dBox.y + dBox.height / 2)} (ожидается 720/450)` : 'dialog not found')
await page.screenshot({ path: 'audit-shots/modal-orders.png' })
// CreateOrderModal — raw-оверлей без Escape: закрываем кнопкой Close
await page.locator('.modal-overlay [aria-label="Close"]').first().click()
await page.waitForTimeout(500)

// 3. Couriers → модалка size="lg" (проверка --modal-size: ширина 720, не 560)
await page.locator('button.sbi', { hasText: /courier|курьер/i }).first().click()
await page.waitForTimeout(1200)
await page.locator('button', { hasText: /^packages$|^посылки$|^пакеты$/i }).first().click()
await page.waitForTimeout(800)
const addBtn = page.locator('button', { hasText: /new package|нов.*посыл|нов.*пакет/i }).first()
if (await addBtn.isVisible().catch(() => false)) {
  await addBtn.click()
  await page.waitForTimeout(900)
  const lgBox = await page.locator('[role="dialog"]').first().boundingBox()
  check(
    'модалка lg = 720px (--modal-size работает)',
    !!lgBox && lgBox.width > 600,
    lgBox ? `width=${Math.round(lgBox.width)}` : 'dialog not found'
  )
  await page.screenshot({ path: 'audit-shots/modal-couriers.png' })
  await page.keyboard.press('Escape')
} else {
  const btns = await page.locator('.main-content-scroll button').allTextContents()
  console.log('[debug] кнопки на странице:', btns.map(b => b.trim()).filter(Boolean).join(' | '))
  await page.screenshot({ path: 'audit-shots/modal-couriers-debug.png' })
  check('модалка lg = 720px (--modal-size работает)', false, 'триггер на Couriers не найден')
}

const failed = results.filter(r => !r.ok).length
console.log(`\n=== ${results.length - failed}/${results.length} проверок пройдено`)
await browser.close()
process.exit(failed ? 1 : 0)
