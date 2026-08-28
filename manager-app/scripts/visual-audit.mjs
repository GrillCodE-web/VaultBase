// Visual audit для VaultBase Manager: мок Tauri-инвоков + серверного HTTP-роута,
// проход по всем экранам (активация → мастер-пароль → разблокировка → 8 страниц шелла),
// скриншоты и сбор ошибок консоли.
//
// Запуск: node manager-app/scripts/visual-audit.mjs
// Требует запущенный dev-сервер manager-app (npm run dev в manager-app/, :5175).
// Результат: manager-app/audit-shots/*.png + audit-shots/report.json

import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const OUT = path.join(ROOT, 'audit-shots')
const BASE = process.env.AUDIT_URL || 'http://localhost:5175'

fs.mkdirSync(OUT, { recursive: true })

const now = Date.now()
const minsAgo = (n) => new Date(now - n * 60000).toISOString().slice(0, 19).replace('T', ' ')
const daysAgoTs = (n) => new Date(now - n * 86400000).toISOString().slice(0, 19).replace('T', ' ')
const daysAgo = (n) => new Date(now - n * 86400000).toISOString().slice(0, 10)

const workers = [
  { installation_id: 'vb-worker-01aa7f2c9d4e6b8f', label: 'Worker — офис', role: 'admin', is_active: 1, banned: 0, hb_last_seen: minsAgo(2), last_seen: minsAgo(2), quota_cards_day: null, quota_orders_day: 50, min_version: null, version_exempt: 0, permissions_override: null },
  { installation_id: 'vb-worker-02bb3e8a1c5d7f90', label: 'Оператор Максим', role: 'user', is_active: 1, banned: 0, hb_last_seen: minsAgo(4), last_seen: minsAgo(4), quota_cards_day: 20, quota_orders_day: null, min_version: '2.11.0', version_exempt: 0, permissions_override: null },
  { installation_id: 'vb-worker-03cc6a2b8e1d3f47', label: 'Worker — тест', role: 'user', is_active: 1, banned: 1, banned_reason: 'fraud_suspected', hb_last_seen: minsAgo(38), last_seen: minsAgo(38), quota_cards_day: null, quota_orders_day: null, min_version: null, version_exempt: 0, permissions_override: null },
  { installation_id: 'vb-manager-mm11d8c4a2b6e9f3', label: 'manager — ноутбук', role: 'manager', is_active: 1, banned: 0, hb_last_seen: minsAgo(1), last_seen: minsAgo(1), quota_cards_day: null, quota_orders_day: null, min_version: null, version_exempt: 0, permissions_override: null },
]

const snapshots = [
  { installation_id: 'vb-worker-01aa7f2c9d4e6b8f', label: 'Worker — офис', role: 'admin', is_active: 1, hb_last_seen: minsAgo(2), last_seen: minsAgo(2), snapshot: { app_version: '2.11.3', sync_ws: 'ok', imap_ok: true, smtp_ok: true, proxy_ok: true, errors_24h: 0 } },
  { installation_id: 'vb-worker-02bb3e8a1c5d7f90', label: 'Оператор Максим', role: 'user', is_active: 1, hb_last_seen: minsAgo(4), last_seen: minsAgo(4), snapshot: { app_version: '2.10.9', sync_ws: 'ok', imap_ok: true, smtp_ok: false, proxy_ok: true, errors_24h: 3 } },
  { installation_id: 'vb-manager-mm11d8c4a2b6e9f3', label: 'manager — ноутбук', role: 'manager', is_active: 1, hb_last_seen: minsAgo(1), last_seen: minsAgo(1), snapshot: { app_version: '2.11.3', sync_ws: 'ok', imap_ok: true, smtp_ok: true, proxy_ok: true, errors_24h: 0 } },
]

const alerts = [
  { id: 1, severity: 'critical', category: 'worker_offline', title: 'Worker — тест не выходит на связь', message: 'Нет heartbeat 38 минут (порог 10 минут)', created_at: minsAgo(38), status: 'new' },
  { id: 2, severity: 'warning', category: 'dead_ratio', title: 'Высокий dead-ratio у BIN 371449', message: 'dead_ratio = 41% за последние 24 часа', created_at: minsAgo(120), status: 'ack' },
  { id: 3, severity: 'info', category: 'quota', title: 'Оператор Максим исчерпал квоту карт', message: 'quota_cards_day = 20 из 20', created_at: minsAgo(300), status: 'closed' },
]

const news = [
  { id: 1, severity: 'critical', title: 'Смена endpoint Stuffer API', target_role: 'all', target_iid: null, created_at: daysAgoTs(2), is_published: 1, published_at: daysAgoTs(2), read_count: 3 },
  { id: 2, severity: 'info', title: 'Обновление 2.11.3 доступно', target_role: 'operator', target_iid: null, created_at: daysAgoTs(5), is_published: 1, published_at: daysAgoTs(5), read_count: 2 },
  { id: 3, severity: 'warning', title: 'Плановые работы sync-сервера', target_role: 'all', target_iid: null, created_at: daysAgoTs(1), is_published: 0, published_at: null, read_count: 0 },
]

const priorities = [
  { id: 1, shop_domain: 'amazon.com', target: '', target_label: null, weight: 9, notes: 'Приоритетный шоп — лучший success rate' },
  { id: 2, shop_domain: 'walmart.com', target: 'role:operator', target_label: null, weight: 5, notes: '' },
  { id: 3, shop_domain: 'target.com', target: 'iid:vb-worker-01aa7f2c9d4e6b8f', target_label: 'Worker — офис', weight: 2, notes: '' },
]

const releases = [
  { version: '2.11.3', file_type: 'manager-updater', platform: 'windows-x86_64', published_at: daysAgo(3), is_published: 1 },
  { version: '2.11.3', file_type: 'updater', platform: 'windows-x86_64', published_at: daysAgo(3), is_published: 1 },
  { version: '2.11.2', file_type: 'updater', platform: 'linux-x86_64', published_at: daysAgo(10), is_published: 1 },
  { version: '2.11.1', file_type: 'updater', platform: 'macos-aarch64', published_at: daysAgo(20), is_published: 0 },
]

const keys = [
  { id: 1, pubkey: 'MDIwMTAyMDMwODAwMDIxMDIwMzA4MDAwMDIxMDIwMzA4MDAwMDIx', is_active: 1 },
  { id: 2, pubkey: 'MDIwMTAyMDMwODAwMDIxMDIwMzA4MDAwMDIxMDIwMzA4MDAwMDIx', is_active: 0 },
]

const analytics = {
  reports: 5,
  orders_total: 530,
  cards_taken: 128,
  cards_used: 96,
  cards_dead: 23,
  dead_ratio: 18,
  drops_taken: 57,
  health: { imap_ok: 24, imap_fail: 2, smtp_ok: 19, smtp_fail: 1 },
  days: Array.from({ length: 30 }, (_, i) => ({
    date: daysAgo(29 - i),
    orders: 8 + Math.round(Math.sin(i / 3) * 6 + i * 0.4),
    dead: Math.max(0, Math.round(Math.sin(i / 2) * 2 + 1)),
  })),
  orders_by_status: { delivered: 431, shipped: 67, pending: 14, declined: 18 },
  by_bin: [
    { bin: '414720', used: 40, dead: 5, dead_ratio: 12.5 },
    { bin: '516805', used: 32, dead: 8, dead_ratio: 25.0 },
    { bin: '371449', used: 21, dead: 6, dead_ratio: 28.6 },
    { bin: '426398', used: 14, dead: 1, dead_ratio: 7.1 },
  ],
  by_shop: [
    { shop: 'amazon.com', orders: 42, delivered: 38, declined: 3, cancelled: 1, decline_ratio: 7.1 },
    { shop: 'bestbuy.com', orders: 18, delivered: 15, declined: 2, cancelled: 1, decline_ratio: 11.1 },
    { shop: 'target.com', orders: 9, delivered: 6, declined: 3, cancelled: 0, decline_ratio: 33.3 },
  ],
  by_worker: [
    { installation_id: 'vb-worker-01aa7f2c9d4e6b8f', label: 'Worker — офис', cards_taken: 34, orders: 140, drops_taken: 28, dead_ratio: 12 },
    { installation_id: 'vb-worker-02bb3e8a1c5d7f90', label: 'Оператор Максим', cards_taken: 22, orders: 87, drops_taken: 19, dead_ratio: 31 },
  ],
  drops_destinations: [
    { destination: 'US/NY/New York', count: 18 },
    { destination: 'US/CA/Los Angeles', count: 12 },
    { destination: 'US/TX/Austin', count: 7 },
    { destination: 'DE/Berlin', count: 3 },
  ],
}

const emptyWorkerStats = (iid) => ({
  installation_id: iid,
  label: '',
  days: 30,
  reports: 0,
  totals: { orders: 0, delivered: 0, declined: 0, cancelled: 0, cards_taken: 0, cards_dead: 0, dead_ratio: 0, drops: 0, imap_ok: 0, imap_fail: 0, smtp_ok: 0, smtp_fail: 0, proxy_ok: 0, proxy_fail: 0 },
  by_day: [],
  feed: [],
})

const workerStats = {
  'vb-worker-01aa7f2c9d4e6b8f': {
    installation_id: 'vb-worker-01aa7f2c9d4e6b8f',
    label: 'Worker — офис',
    days: 30,
    reports: 12,
    totals: { orders: 140, delivered: 121, declined: 12, cancelled: 7, cards_taken: 34, cards_dead: 4, dead_ratio: 11.8, drops: 28, imap_ok: 26, imap_fail: 1, smtp_ok: 24, smtp_fail: 0, proxy_ok: 25, proxy_fail: 2 },
    by_day: Array.from({ length: 12 }, (_, i) => ({ date: daysAgo(11 - i), orders: 8 + (i % 5), delivered: 7 + (i % 4), declined: i === 9 ? 5 : 0, dead: i === 9 ? 4 : 0 })),
    feed: [
      { date: daysAgo(2), kind: 'fail', code: 'decline_spike', params: { declined: 5, orders: 9 } },
      { date: daysAgo(2), kind: 'fail', code: 'dead_cards', params: { dead: 4 } },
      { date: daysAgo(0), kind: 'success', code: 'clean_streak', params: { n: 3 } },
      { date: daysAgo(0), kind: 'success', code: 'clean_day', params: { orders: 11 } },
      { date: daysAgo(4), kind: 'fail', code: 'proxy_down', params: { fails: 3 } },
      { date: daysAgo(6), kind: 'success', code: 'high_volume', params: { orders: 14 } },
      { date: daysAgo(8), kind: 'info', code: 'idle_day', params: {} },
    ],
  },
}

const emptyStats = emptyWorkerStats('')

const overview = {
  workers_total: 4,
  workers_active: 4,
  workers_online: 2,
  workers_banned: 1,
  alerts_new: 1,
  alerts_open: 2,
  managers: 1,
  cards_in_groups: 128,
  sync_groups: 3,
  footprints_24h: 41,
  reports_24h: 3,
  latest_release: '2.11.3',
  server_time: minsAgo(0),
}

function buildMock() {
  // Мок живёт на странице (не в Node): состояние фаз переживает серию invoke
  // без перезагрузки. Формат ответов server_request: { status, body } — как в Rust.
  return `
(function () {
  let cbId = 0;
  const callbacks = new Map();
  window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
  window.__TAURI_INTERNALS__.transformCallback = function (cb) {
    const id = ++cbId;
    callbacks.set(id, cb);
    return id;
  };
  window.__TAURI_INTERNALS__.metadata = { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: function () {} };

  const DATA = ${JSON.stringify({ workers, snapshots, alerts, news, priorities, releases, keys, analytics, overview, workerStats, emptyStats })};
  const state = {
    phase: 'not_activated',
    installation_id: 'vb-mgr-a1b2c3d4e5f6a7b8',
    challenge: 'CHLL-9F3K-Q7WD-2026',
    server_url: 'https://sync.vaultbase.example.com',
    role: null,
  };

  const ok = (body) => ({ status: 200, body });
  const created = (body) => ({ status: 201, body });

  function route(method, url) {
    const [path, qs] = url.split('?');
    const q = Object.fromEntries(new URLSearchParams(qs || ''));
    if (method === 'GET' && path === '/manager/api/overview') return ok(DATA.overview);
    if (method === 'GET' && path === '/manager/api/workers') return ok({ workers: DATA.workers });
    if (method === 'GET' && path === '/manager/api/alerts') {
      const items = q.status && q.status !== 'all' ? DATA.alerts.filter(a => a.status === q.status) : DATA.alerts;
      return ok({ alerts: items });
    }
    if (method === 'GET' && path === '/manager/api/news') return ok({ news: DATA.news });
    if (method === 'POST' && path === '/manager/api/news') return created({ id: 99 });
    if (method === 'GET' && path === '/manager/api/priorities') return ok({ priorities: DATA.priorities });
    if (method === 'POST' && path === '/manager/api/priorities') return created({ id: 98 });
    if (method === 'GET' && path === '/manager/api/releases') return ok({ releases: DATA.releases });
    if (method === 'GET' && path === '/manager/api/keys') return ok({ keys: DATA.keys });
    if (/^\\/manager\\/api\\/news\\/\\d+\\/(publish|unpublish|readers)$/.test(path)) {
      if (path.endsWith('/readers')) return ok({ read_count: 3, audience_count: 2, readers: [{ installation_id: DATA.workers[0].installation_id, label: DATA.workers[0].label, read_at: DATA.news[0].published_at }] });
      return ok({});
    }
    if (/^\\/manager\\/api\\/alerts\\/\\d+\\/(ack|close)$/.test(path)) return ok({});
    if (/^\\/manager\\/api\\/priorities\\/\\d+$/.test(path)) return ok({});
    if (/^\\/manager\\/api\\/workers\\/[^/]+\\/(policy|force-logout)$/.test(path)) return ok({});
    if (/^\\/manager\\/api\\/news\\/\\d+$/.test(path) && method === 'DELETE') return ok({});
    console.warn('[visual-audit mock] unhandled route: ' + method + ' ' + url);
    return { status: 404, body: { error: 'not_found' } };
  }

  window.__TAURI_INTERNALS__.invoke = function (cmd, args) {
    if (cmd.startsWith('plugin:event|listen')) return Promise.resolve(1);
    if (cmd.startsWith('plugin:')) return Promise.resolve(null);
    switch (cmd) {
      case 'get_app_state':
        return Promise.resolve({ ...state });
      case 'set_server_url':
        state.server_url = args.url;
        return Promise.resolve(null);
      case 'activate_license':
        if (!args.activationKey || args.activationKey.trim().length < 6) return Promise.reject('invalid_key');
        state.phase = 'needs_master';
        return Promise.resolve(null);
      case 'setup_master_password':
        state.phase = 'locked';
        return Promise.resolve(null);
      case 'unlock_app':
        state.phase = 'ready';
        state.role = 'manager';
        return Promise.resolve(null);
      case 'lock_app':
        state.phase = 'locked';
        return Promise.resolve(null);
      case 'wipe_local_data':
        state.phase = 'not_activated';
        state.role = null;
        return Promise.resolve(null);
      case 'sync_telemetry':
        return Promise.resolve({ workers: 4, reports: 2, unseal_failures: 0, sealed_to_other_key: 1 });
      case 'get_analytics':
        return Promise.resolve(DATA.analytics);
      case 'get_worker_snapshots':
        return Promise.resolve({ snapshots: DATA.snapshots });
      case 'get_worker_stats':
        return Promise.resolve(DATA.workerStats[args.installationId] || Object.assign({}, DATA.emptyStats, { installation_id: args.installationId }));
      case 'server_request':
        return Promise.resolve(route(args.method, args.path));
      default:
        console.warn('[visual-audit mock] unhandled invoke: ' + cmd);
        return Promise.resolve(null);
    }
  };
})();`
}

const report = { pages: {}, consoleErrors: [], pageErrors: [], unhandled: [] }

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

page.on('console', (msg) => {
  const text = msg.text()
  if (msg.type() === 'error') report.consoleErrors.push(text)
  const m = text.match(/\[visual-audit mock\] unhandled (invoke|route): (\S+)/)
  if (m && !report.unhandled.includes(m[2])) report.unhandled.push(m[2])
})
page.on('pageerror', (err) => report.pageErrors.push(String(err)))

await page.addInitScript(`localStorage.setItem('vb-mgr-lang', 'ru')`)
await page.addInitScript(buildMock())

async function shot(name) {
  await page.waitForTimeout(900)
  await page.screenshot({ path: path.join(OUT, name + '.png') })
  report.pages[name] = 'ok'
  console.log('[shot]', name)
}

// 1. Активация
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(800)
await shot('00-activate')

// 2. Экран активации с введённым ключом, затем мастер-пароль с чек-листом
await page.locator('input[placeholder="XXXX-XXXX-XXXX-XXXX"]').fill('MOCK-KEY-2026')
await page.waitForTimeout(300)
await shot('01-activate-key')
await page.locator('button.btn.primary').click()
await page.waitForTimeout(700)

const pwdInputs = page.locator('.auth-card input[type="password"]')
await pwdInputs.nth(0).fill('VbMock!2026#Audit')
await pwdInputs.nth(1).fill('VbMock!2026#Audit')
await page.waitForTimeout(300)
await shot('02-setup-master')

// 3. Разблокировка
await page.locator('button.btn.primary').click()
await page.waitForTimeout(800)
await shot('03-unlock')

await pwdInputs.first().fill('VbMock!2026#Audit')
await page.locator('button.btn.primary').click()
await page.waitForTimeout(1200)
await shot('04-dashboard')

// 4. Страницы шелла по порядку сайдбара (nth(0) — dashboard, уже сняли)
const nav = ['workers', 'analytics', 'news', 'alerts', 'priorities', 'updates', 'settings']
const navButtons = page.locator('.sidebar .nav-item')
for (let i = 0; i < nav.length; i++) {
  await navButtons.nth(i + 1).click()
  await shot(String(i + 5).padStart(2, '0') + '-' + nav[i])

  if (nav[i] === 'workers') {
    // Политика работника: модалка поверх списка
    const policyBtn = page.locator('.panel button.btn.small').first()
    if (await policyBtn.isVisible().catch(() => false)) {
      await policyBtn.click()
      await page.waitForTimeout(500)
      await shot('modal-worker-policy')
      await page.mouse.click(8, 8)
      await page.waitForTimeout(400)
    }
    // Карточка работника: персональная стата + умная лента
    const row = page.locator('table.data tr.clickable').first()
    if (await row.isVisible().catch(() => false)) {
      await row.click()
      await page.waitForTimeout(700)
      await shot('modal-worker-detail')
      await page.mouse.click(8, 8)
      await page.waitForTimeout(400)
    }
  }
}

// 5. Результат ручного sync (кнопка в сайдбаре: 8 страниц, затем sync)
await navButtons.nth(8).click()
await page.waitForTimeout(700)
await shot('12-sync-result')

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
console.log('\n=== console errors:', report.consoleErrors.length)
console.log('=== page errors:', report.pageErrors.length)
console.log('=== unhandled:', report.unhandled.join(', ') || 'none')

await browser.close()
