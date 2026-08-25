// Проверка модалок: геометрия оверлея/диалога и fill-mode .page-enter.
// Запуск: node scripts/visual-modal-check.mjs (нужен dev-сервер на :5173)
// Результат: audit-shots/modal-orders.png, modal-couriers.png + вердикты в консоль.

import { chromium } from '@playwright/test'

const admin = { id: 1, username: 'admin', role: 'admin', token: 'mock-token', permissions: [], must_change_password: false }

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)))

await page.addInitScript(`
  try { localStorage.setItem('onboarding_done', '1') } catch {}
  const ADMIN = ${JSON.stringify(admin)};
  let evtId = 0;
  const LIST = { items: [], total: 0 };
  const DATA = {
    is_password_set: true,
    unlock: true,
    try_auto_login: ADMIN,
    resume_session: ADMIN,
    get_license_status: { status: 'active' },
    get_config: null,
    get_app_version: '2.11.3',
    get_sidebar_badges: {},
    get_user_with_permissions: ADMIN,
    get_cards: { items: [{ id: 1 }], total: 1, free_total: 1 },
    get_orders: LIST,
    get_profiles: LIST,
    get_shops: LIST,
    get_emails: LIST,
    get_proxies: LIST,
    get_order_templates: [],
    search_catalog_shops: [],
    search_catalog_items: [],
    get_catalog_stats: { items: 1, shops: 1 },
    stuffer_list_couriers: [{ id: 1, name: 'DHL Courier', status: 'available', phone: '+1 555 000 1' }],
    stuffer_list_available_couriers: [],
    stuffer_list_packages: [],
    stuffer_get_config: {},
    stuffer_get_labels: [],
  };
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 1,
    invoke: (cmd) => {
      if (cmd.startsWith('plugin:event|listen')) return Promise.resolve(++evtId);
      if (cmd.startsWith('plugin:')) return Promise.resolve(null);
      if (Object.prototype.hasOwnProperty.call(DATA, cmd)) return Promise.resolve(DATA[cmd]);
      return Promise.resolve(null);
    },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`)

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
console.log(
  '[state] sbi:',
  await page.locator('button.sbi').count(),
  'page-enter:',
  await page.locator('.page-enter').count(),
  'body:',
  (await page.evaluate(() => document.body.innerText.slice(0, 160))).replace(/\n/g, ' | ')
)

// 1. Корневой фикс: после анимации .page-enter transform обязан быть none
await page.waitForTimeout(600)
const transform = await page.evaluate(() => {
  const el = document.querySelector('.page-enter')
  return el ? getComputedStyle(el).transform : '(no .page-enter)'
})
check('page-enter transform сброшен', transform === 'none', `transform: ${transform}`)

// 2. Orders → модалка создания заказа (шаред Modal → портал)
const ordersBtn = page.locator('button.sbi', { hasText: /orders|заказ/i }).first()
await ordersBtn.click()
await page.waitForTimeout(1200)
await page.locator('button', { hasText: /create order|новый заказ/i }).first().click()
await page.waitForTimeout(900)

const overlayBox = await page.locator('.modal-overlay').first().boundingBox()
check(
  'оверлей покрывает всё окно',
  !!overlayBox && overlayBox.x <= 1 && overlayBox.y <= 1 && overlayBox.width >= 1430 && overlayBox.height >= 890,
  overlayBox ? `x=${overlayBox.x} y=${overlayBox.y} w=${overlayBox.width} h=${overlayBox.height}` : 'overlay not found'
)

const dialog = page.locator('[role="dialog"]').first()
const dBox = await dialog.boundingBox()
const centered = dBox && Math.abs(dBox.x + dBox.width / 2 - 720) < 40 && Math.abs(dBox.y + dBox.height / 2 - 450) < 120
check('диалог по центру viewport', !!centered, dBox ? `cx=${Math.round(dBox.x + dBox.width / 2)} cy=${Math.round(dBox.y + dBox.height / 2)} (ожидается 720/450)` : 'dialog not found')
await page.screenshot({ path: 'audit-shots/modal-orders.png' })
await page.keyboard.press('Escape')
await page.waitForTimeout(500)

// 3. Couriers → модалка size="lg" (проверка --modal-size: ширина 720, не 560)
const couriersBtn = page.locator('button.sbi', { hasText: /courier|курьер/i }).first()
await couriersBtn.click()
await page.waitForTimeout(1200)
const addBtn = page.locator('button', { hasText: /add|добавить|assign|назначить/i }).first()
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
  check('модалка lg = 720px (--modal-size работает)', false, 'триггер на Couriers не найден')
}

const failed = results.filter(r => !r.ok).length
console.log(`\n=== ${results.length - failed}/${results.length} проверок пройдено`)
await browser.close()
process.exit(failed ? 1 : 0)
