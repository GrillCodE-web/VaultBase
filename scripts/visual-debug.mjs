import { chromium } from '@playwright/test'

const admin = { id: 1, username: 'admin', role: 'admin', token: 'mock-token', permissions: [], must_change_password: false }

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('pageerror', e => console.log('[pageerror]', String(e).slice(0, 300)))
page.on('console', m => { if (m.type() === 'error') console.log('[err]', m.text().slice(0, 200)) })

await page.addInitScript(`
  const ADMIN = ${JSON.stringify(admin)};
  let evtId = 0;
  window.__TAURI_INTERNALS__ = {
    transformCallback: (cb) => { window.__lastCb = cb; return 1; },
    invoke: (cmd, args) => {
      if (cmd.startsWith('plugin:event|listen')) return Promise.resolve(++evtId);
      if (cmd.startsWith('plugin:')) return Promise.resolve(null);
      console.log('[mock]', cmd);
      if (cmd === 'is_password_set') return Promise.resolve(true);
      if (cmd === 'unlock') return Promise.resolve(true);
      if (cmd === 'try_auto_login' || cmd === 'resume_session') return Promise.resolve(ADMIN);
      if (cmd === 'get_license_status') return Promise.resolve({ status: 'active' });
      return Promise.resolve(null);
    },
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
`)

await page.goto('http://localhost:5173', { waitUntil: 'networkidle' })
await page.waitForTimeout(4500)
console.log('password inputs:', await page.locator('input[type="password"]').count())
const pw = page.locator('input[type="password"]')
if (await pw.count()) {
  await pw.first().fill('MockPassword1!')
  await page.locator('button.auth-btn').click()
  await page.waitForTimeout(2500)
}
console.log('sbi count:', await page.locator('button.sbi').count())
console.log('BODY:', (await page.evaluate(() => document.body.innerText.slice(0, 300))))
await page.screenshot({ path: 'audit-shots/debug.png' })
await browser.close()
