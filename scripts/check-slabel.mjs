import { chromium } from '@playwright/test'

const admin = { id: 1, username: 'admin', role: 'admin', token: 't', permissions: [], must_change_password: false }
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
await page.addInitScript(`
  const ADMIN = ${JSON.stringify(admin)};
  let evt = 0;
  window.__TAURI_INTERNALS__ = {
    transformCallback: () => 1,
    invoke: (cmd) => {
      if (cmd.startsWith('plugin:')) return Promise.resolve(++evt);
      if (cmd === 'is_password_set' || cmd === 'unlock') return Promise.resolve(true);
      if (cmd === 'try_auto_login' || cmd === 'resume_session') return Promise.resolve(ADMIN);
      if (cmd === 'get_license_status') return Promise.resolve({ status: 'active' });
      if (cmd === 'get_dashboard_stats') return Promise.resolve({ total_cc: 5, free_cc: 2, in_use_cc: 2, dead_cc: 1, total_profiles: 3, no_drop_profiles: 0, total_orders: 10, pending: 1, shipped: 2, delivered: 6, declined: 1, revenue: 1000, net_profit: 400, orders_trend: 0, revenue_trend: 0, delivered_trend: 0, alerts: [] });
      if (cmd === 'get_revenue_chart' || cmd === 'get_heatmap_data' || cmd === 'get_top_banks' || cmd === 'get_by_country' || cmd === 'get_by_source' || cmd === 'get_by_domain' || cmd === 'get_expiring_cards_dashboard' || cmd === 'get_bin_performance' || cmd === 'get_users_stats') return Promise.resolve([]);
      if (cmd === 'get_orders') return Promise.resolve({ items: [], total: 0 });
      return Promise.resolve(null);
    },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`)
await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.waitForTimeout(4500)
const pw = page.locator('input[type="password"]')
if (await pw.count()) { await pw.first().fill('x'); await page.locator('button.auth-btn').click(); await page.waitForTimeout(2000) }

const res = await page.evaluate(() => {
  const el = [...document.querySelectorAll('.slabel')].map(e => ({
    text: e.textContent,
    scrollW: e.scrollWidth,
    clientW: e.clientWidth,
    overflow: getComputedStyle(e).overflow,
    ws: getComputedStyle(e).whiteSpace,
  }))
  return res = el
})
console.log(JSON.stringify(res, null, 1))
await browser.close()
