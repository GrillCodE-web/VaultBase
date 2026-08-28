// Visual audit: открывает приложение в браузере с богатым моком Tauri,
// проходит по всем страницам, делает скриншоты и собирает ошибки консоли.
//
// Запуск: node scripts/visual-audit.mjs
// Требует запущенный dev-сервер (npm run dev) на :5173.
// Результат: audit-shots/*.png + audit-shots/report.json

import { chromium } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

const OUT = path.resolve('audit-shots')
const BASE = process.env.AUDIT_URL || 'http://localhost:5173'

fs.mkdirSync(OUT, { recursive: true })

const now = Date.now()
const iso = d => new Date(d).toISOString()
const daysAgo = n => iso(now - n * 86400000)

const mkUser = (id, username, role) => ({
  id,
  username,
  role,
  token: 'mock-token-' + username,
  permissions: [],
  must_change_password: false,
  last_login_at: daysAgo(1),
})

const admin = mkUser(1, 'admin', 'admin')

const cards = [
  { id: 1, bin: '414720', last4: '8834', status: 'free', card_type: 'debit', card_level: 'Classic', bank_name: 'Chase', country: 'US', state: 'NY', city: 'New York', zip: '10001', holder_name: 'JOHN DOE', expiry_date: '12/27', source: 'manual', domain: null, ip_address: null, notes: 'Основная рабочая карта', orders_count: 3, created_at: daysAgo(40) },
  { id: 2, bin: '516805', last4: '1120', status: 'in_use', card_type: 'credit', card_level: 'Platinum', bank_name: 'Bank of America', country: 'US', state: 'CA', city: 'Los Angeles', zip: '90001', holder_name: 'JANE SMITH', expiry_date: '03/26', source: 'import', domain: 'shop.example.com', ip_address: '192.168.1.1', notes: null, orders_count: 12, created_at: daysAgo(90) },
  { id: 3, bin: '371449', last4: '9005', status: 'dead', card_type: 'credit', card_level: 'Gold', bank_name: 'Amex', country: 'GB', state: null, city: 'London', zip: 'SW1A', holder_name: 'ALEX BROWN', expiry_date: '11/25', source: 'import', domain: null, ip_address: null, notes: 'Сгорела после чарджбека', orders_count: 8, created_at: daysAgo(120) },
  { id: 4, bin: '426398', last4: '3371', status: 'free', card_type: 'debit', card_level: 'Business', bank_name: 'Wells Fargo', country: 'US', state: 'TX', city: 'Austin', zip: '73301', holder_name: 'MIKE WILSON', expiry_date: '07/28', source: 'manual', domain: null, ip_address: null, notes: null, orders_count: 0, created_at: daysAgo(5) },
  { id: 5, bin: '404038', last4: '5546', status: 'in_use', card_type: 'credit', card_level: 'Signature', bank_name: 'Citi', country: 'DE', state: null, city: 'Berlin', zip: '10115', holder_name: 'ANNA MULLER', expiry_date: '09/26', source: 'import', domain: null, ip_address: null, notes: null, orders_count: 1, created_at: daysAgo(15) },
]

const orders = [
  { id: 1, order_number: 'VB-100234', status: 'delivered', shop_name: 'Amazon', profile_id: 'p1', shop_id: 1, drop_id: 1, holder_masked: 'J. Doe', last4: '8834', bank_name: 'Chase', total_amount: 249.99, tracking_number: '1Z999AA10123456784', carrier: 'UPS', proxy_label: 'proxy-us-1', email_addr: 'john@example.com', notes: null, created_at: daysAgo(12), updated_at: daysAgo(8) },
  { id: 2, order_number: 'VB-100235', status: 'shipped', shop_name: 'BestBuy', profile_id: 'p2', shop_id: 2, drop_id: 2, holder_masked: 'J. Smith', last4: '1120', bank_name: 'BoA', total_amount: 1099.0, tracking_number: '9405511899223197428490', carrier: 'USPS', proxy_label: null, email_addr: 'jane@example.com', notes: 'Хрупкое', created_at: daysAgo(6), updated_at: daysAgo(4) },
  { id: 3, order_number: 'VB-100236', status: 'pending', shop_name: 'Walmart', profile_id: 'p1', shop_id: 3, drop_id: 1, holder_masked: 'J. Doe', last4: '8834', bank_name: 'Chase', total_amount: 89.5, tracking_number: null, carrier: null, proxy_label: null, email_addr: 'john@example.com', notes: null, created_at: daysAgo(1), updated_at: daysAgo(1) },
  { id: 4, order_number: 'VB-100237', status: 'declined', shop_name: 'Amazon', profile_id: 'p3', shop_id: 1, drop_id: 3, holder_masked: 'A. Brown', last4: '9005', bank_name: 'Amex', total_amount: 45.0, tracking_number: null, carrier: null, proxy_label: null, email_addr: 'alex@example.com', notes: 'Отменён магазином', created_at: daysAgo(9), updated_at: daysAgo(9) },
  { id: 5, order_number: 'VB-100238', status: 'shipped', shop_name: 'Target', profile_id: 'p2', shop_id: 4, drop_id: 2, holder_masked: 'J. Smith', last4: '1120', bank_name: 'BoA', total_amount: 320.75, tracking_number: '1Z999AA10123456799', carrier: 'UPS', proxy_label: 'proxy-us-2', email_addr: 'jane@example.com', notes: null, created_at: daysAgo(3), updated_at: daysAgo(0) },
]

const profiles = [
  { id: 'p1', card_id: 1, notes: 'Основной', created_at: daysAgo(60), updated_at: daysAgo(2), bin: '414720', last4: '8834', bank_name: 'Chase', card_type: 'debit', country: 'US', card_status: 'free', holder_masked: 'J*** D***', drop_count: 1, order_count: 15, recipient_name: 'John Doe', address: '123 Main St', city: 'New York', state: 'NY', zip: '10001' },
  { id: 'p2', card_id: 2, notes: 'VIP', created_at: daysAgo(100), updated_at: daysAgo(1), bin: '516805', last4: '1120', bank_name: 'Bank of America', card_type: 'credit', country: 'US', card_status: 'in_use', holder_masked: 'J*** S***', drop_count: 2, order_count: 31, recipient_name: 'Jane Smith', address: '45 Palm Ave', city: 'Los Angeles', state: 'CA', zip: '90001' },
  { id: 'p3', card_id: 3, notes: null, created_at: daysAgo(130), updated_at: daysAgo(20), bin: '371449', last4: '9005', bank_name: 'Amex', card_type: 'credit', country: 'GB', card_status: 'dead', holder_masked: 'A*** B***', drop_count: 0, order_count: 8, recipient_name: null, address: null, city: null, state: null, zip: null },
]

const shops = [
  { id: 1, name: 'Amazon', domain: 'amazon.com', url: 'https://amazon.com', category: 'Marketplace', notes: null, requires_cvv_match: true, blocks_vpn: false, phone_must_match: false, accepts_amex: true, requires_avs: true, high_cancel_risk: false, total_orders: 42, delivered: 38, declined: 3, success_rate: 90.5, avg_order_value: 240.0, created_at: daysAgo(200), updated_at: daysAgo(1) },
  { id: 2, name: 'BestBuy', domain: 'bestbuy.com', url: 'https://bestbuy.com', category: 'Electronics', notes: null, requires_cvv_match: true, blocks_vpn: true, phone_must_match: false, accepts_amex: false, requires_avs: true, high_cancel_risk: false, total_orders: 18, delivered: 15, declined: 2, success_rate: 83.3, avg_order_value: 720.0, created_at: daysAgo(150), updated_at: daysAgo(3) },
  { id: 3, name: 'Walmart', domain: 'walmart.com', url: 'https://walmart.com', category: 'Marketplace', notes: null, requires_cvv_match: false, blocks_vpn: false, phone_must_match: true, accepts_amex: true, requires_avs: false, high_cancel_risk: false, total_orders: 27, delivered: 24, declined: 1, success_rate: 88.9, avg_order_value: 130.0, created_at: daysAgo(180), updated_at: daysAgo(2) },
  { id: 4, name: 'Target', domain: 'target.com', url: 'https://target.com', category: 'Retail', notes: 'Частые верификации', requires_cvv_match: false, blocks_vpn: true, phone_must_match: false, accepts_amex: true, requires_avs: true, high_cancel_risk: true, total_orders: 9, delivered: 6, declined: 3, success_rate: 66.7, avg_order_value: 95.0, created_at: daysAgo(90), updated_at: daysAgo(10) },
]

const proxies = [
  { id: 1, label: 'proxy-us-1', host: '192.168.10.1', port: 8080, proxy_type: 'http', username: 'u1', password: null, notes: null, is_blocked: false, shops_used: [{ id: 1, name: 'Amazon' }, { id: 3, name: 'Walmart' }], created_at: daysAgo(50), updated_at: daysAgo(1), last_checked: daysAgo(0) },
  { id: 2, label: 'proxy-us-2', host: '192.168.10.2', port: 8080, proxy_type: 'socks5', username: 'u2', password: null, notes: null, is_blocked: false, shops_used: [{ id: 2, name: 'BestBuy' }], created_at: daysAgo(50), updated_at: daysAgo(2), last_checked: daysAgo(1) },
  { id: 3, label: 'proxy-de-1', host: '10.20.30.40', port: 1080, proxy_type: 'socks5', username: null, password: null, notes: 'Не отвечает', is_blocked: true, shops_used: [], created_at: daysAgo(30), updated_at: daysAgo(5), last_checked: daysAgo(2) },
]

const imapAccounts = [
  // Бэкенд возвращает label (см. _imap.rs), а не email — без него дерево
  // аккаунтов рендерит пустые строки.
  { id: 1, label: 'john@example.com', host: 'imap.gmail.com', port: 993, login: 'john@example.com', is_active: true, fail_count: 0, unread_count: 4, last_checked: daysAgo(0) },
  { id: 2, label: 'jane@example.com', host: 'imap.outlook.com', port: 993, login: 'jane@example.com', is_active: true, fail_count: 4, last_error: 'AUTH failed', unread_count: 0, last_checked: daysAgo(2) },
]

const imapMessages = [
  { id: 1, account_id: 1, from_addr: 'orders@amazon.com', subject: 'Your order has shipped', received_at: daysAgo(0), is_read: false, snippet: 'Your package is on the way...' },
  { id: 2, account_id: 1, from_addr: 'support@bestbuy.com', subject: 'Order confirmation #BB123', received_at: daysAgo(1), is_read: true, snippet: 'Thank you for your purchase...' },
]

const activityLog = Array.from({ length: 12 }, (_, i) => ({
  id: i + 1,
  event_type: ['create_card', 'update_order', 'login', 'import_cards'][i % 4],
  entity_type: ['card', 'order', 'user', 'card'][i % 4],
  entity_id: i + 1,
  description: `Действие #${i + 1}: ${['добавлена карта', 'обновлён заказ', 'вход в систему', 'импорт карт'][i % 4]}`,
  created_at: daysAgo(i),
  username: 'admin',
}))

const dashboardStats = {
  total_cc: 128, free_cc: 34, in_use_cc: 71, dead_cc: 23,
  total_profiles: 86, no_drop_profiles: 12,
  total_orders: 512, pending: 14, shipped: 67, delivered: 431, declined: 18,
  revenue: 84230.5, net_profit: 31200.0,
  orders_trend: 12.4, revenue_trend: 8.1, delivered_trend: 5.6,
  alerts: [
    { level: 'warning', message: '6 cards expire in the next 30 days', action: 'cards', count: 6 },
    { level: 'info', message: '12 profiles without a drop', action: 'profiles', count: 12 },
  ],
}

const topBanks = [
  { bank_name: 'Chase', total_cards: 40, free_cards: 12, dead_cards: 5, total_orders: 160, shipped: 40, declined: 4, revenue: 26000, success_rate: 94.1 },
  { bank_name: 'Bank of America', total_cards: 32, free_cards: 9, dead_cards: 8, total_orders: 120, shipped: 30, declined: 9, revenue: 19400, success_rate: 88.2 },
  { bank_name: 'Amex', total_cards: 21, free_cards: 6, dead_cards: 6, total_orders: 74, shipped: 20, declined: 6, revenue: 12800, success_rate: 81.0 },
]

const byCountry = [
  { country: 'US', total_cards: 90, free_cards: 24, total_orders: 380, revenue: 64000, success_rate: 92.3 },
  { country: 'GB', total_cards: 24, free_cards: 6, total_orders: 90, revenue: 14200, success_rate: 88.9 },
  { country: 'DE', total_cards: 14, free_cards: 4, total_orders: 42, revenue: 6000, success_rate: 85.7 },
]

const bySource = [
  { source: 'manual', total_cards: 60, free_cards: 18, dead_cards: 10, total_orders: 240, revenue: 40000, success_rate: 90.0 },
  { source: 'import', total_cards: 68, free_cards: 16, dead_cards: 13, total_orders: 272, revenue: 44230, success_rate: 92.6 },
]

const heatmap = [
  { bank: 'Chase', shop: 'Amazon', total: 60, shipped: 52, success_rate: 93.3 },
  { bank: 'Chase', shop: 'BestBuy', total: 34, shipped: 28, success_rate: 88.2 },
  { bank: 'Chase', shop: 'Walmart', total: 22, shipped: 19, success_rate: 90.9 },
  { bank: 'BoA', shop: 'Amazon', total: 44, shipped: 36, success_rate: 86.4 },
  { bank: 'BoA', shop: 'Target', total: 18, shipped: 14, success_rate: 83.3 },
  { bank: 'Amex', shop: 'Amazon', total: 20, shipped: 15, success_rate: 80.0 },
  { bank: 'Amex', shop: 'BestBuy', total: 12, shipped: 8, success_rate: 75.0 },
]

const expiring = [
  { id: 2, last4: '1120', expiry_date: '03/26', holder_name: 'JANE SMITH', days_left: 12, has_profile: true },
  { id: 3, last4: '9005', expiry_date: '11/25', holder_name: 'ALEX BROWN', days_left: 3, has_profile: true },
]

const binPerf = [
  { bin: '414720', bank_name: 'Chase', total_orders: 40, delivered: 36, declined: 2, total_revenue: 6800, delivery_rate: 90.0 },
  { bin: '516805', bank_name: 'Bank of America', total_orders: 28, delivered: 24, declined: 3, total_revenue: 9100, delivery_rate: 85.7 },
]

const userStats = [
  { user_id: 1, username: 'admin', display_name: 'Administrator', role: 'admin', is_active: true, cards_taken: 34, orders_created: 140, orders_delivered: 128, orders_declined: 4, total_spent: 21400.5, tracking_count: 96, cards_added_manual: 12, last_seen: daysAgo(0), active_sessions: 1, last_ip: '127.0.0.1' },
  { user_id: 2, username: 'operator1', display_name: 'Оператор 1', role: 'user', is_active: true, cards_taken: 22, orders_created: 87, orders_delivered: 71, orders_declined: 9, total_spent: 9800.0, tracking_count: 40, cards_added_manual: 0, last_seen: daysAgo(1), active_sessions: 0, last_ip: '10.0.0.5' },
]

const adminOverview = { users: userStats, today_orders: 7, today_delivered: 4, today_spent: 1240.0, total_cards_in_pool: 128, total_cards_assigned: 71, online_sessions: 1 }

const data = {
  is_password_set: true,
  unlock: true,
  lock: null,
  try_auto_login: admin,
  resume_session: admin,
  user_login: admin,
  user_logout: null,
  get_config: null,
  set_config: null,
  get_app_version: '2.11.3',
  get_installation_id: 'mock-installation',
  get_license_status: { status: 'active', plan: 'pro', expires_at: null },
  get_challenge_code: 'MOCK-CHALLENGE',
  get_sidebar_badges: { pending_orders: 1, expiring_cards: 2, no_drop_profiles: 0, clean_emails: 3, unread_imap: 4, unsynced_footprints: 0 },
  global_search: { cards: cards.slice(0, 2), orders: orders.slice(0, 2), profiles: profiles.slice(0, 1), shops: shops.slice(0, 1), emails: [], proxies: [] },
  // FEAT-018/FEAT-011/UX: стабы, чтобы вкладки рендерились без warning-шума
  upanel_connections_list: [],
  upanel_get_api_status: { ok: true, message: 'mock' },
  stuffer_list_accounts: [],
  has_panic_password: false,

  get_cards: { items: cards, total: cards.length, free_total: 2 },
  get_card: cards[0],
  get_card_stats: { total: 128, free: 34, assigned: 71, burned: 23 },
  get_card_filter_meta: { countries: ['US', 'GB', 'DE'], banks: ['Chase', 'BoA', 'Amex'], sources: ['manual', 'import'] },
  get_card_timeline: [],
  get_card_shop_usage: [],
  get_recent_orders_by_card: orders.slice(0, 2),
  reveal_card: { number: '4147201234568834', cvv: '123', expiry: '12/27' },

  get_orders: { items: orders, total: orders.length },
  get_order: orders[0],
  get_order_templates: [],

  get_profiles: { items: profiles, total: profiles.length },
  get_profile: profiles[0],
  get_profile_detail: { profile: profiles[0], orders: orders.slice(0, 2), drops: [], stats: { orders: 15, spent: 2340.5 } },
  get_profile_ltv: { ltv: 2340.5, orders: 15 },
  get_profile_templates: [],
  get_recent_orders_by_profile: orders.slice(0, 2),
  get_latest_order_by_profile: orders[0],

  get_shops: { items: shops, total: shops.length },
  get_shop: {
    shop: shops[0],
    stats: {
      total: shops[0].total_orders,
      delivered: shops[0].delivered,
      declined: shops[0].declined,
      pending: 1,
      processing: 0,
      shipped: 0,
      avg_order_value: shops[0].avg_order_value,
      success_rate: shops[0].success_rate,
      decline_rate: 7.1,
    },
    recent_orders: orders.filter(o => o.shop_id === shops[0].id),
    products: [
      { id: 1, asin: 'B08N5WRWNW', name: 'Test Product A', amazon_price: 199.99, shop_price: 249.99, margin: 50, url: 'https://amazon.com/dp/B08N5WRWNW', notes: null },
    ],
  },
  get_shop_risk_score: { shop_id: 1, decline_rate: 7.1, unique_emails: 12, unique_ips: 8, risk_level: 'low' },
  get_shop_win_loss: shops.map(s => ({ shop_id: s.id, shop_name: s.name, total: s.total_orders, delivered: s.delivered, declined: s.declined, delivery_pct: s.success_rate, net_revenue: Math.round(s.total_orders * s.avg_order_value * 0.4), expected_value: Math.round(s.avg_order_value * 0.4) })),
  get_shop_smart_suggestions: [],

  get_proxies: { items: proxies, total: proxies.length },
  get_proxy_usage_stats: { total: 3, healthy: 2, dead: 1 },
  get_all_proxy_shop_bindings: [],

  get_imap_accounts: imapAccounts,
  get_imap_messages: { items: imapMessages, total: imapMessages.length },
  // JSON.stringify выкидывает функции из мока — только статичные значения
  get_imap_stats: { total: 25, unread: 4 },
  get_imap_folders: ['INBOX', 'Sent', 'Spam'],
  get_smtp_configs: [{ id: 1, name: 'Mock SMTP', host: 'smtp.mock.dev', port: 587, username: 'mock', from_email: 'mock@example.com', use_tls: true }],
  list_domain_routes: [],
  get_emails: { items: imapAccounts.map(a => ({ id: a.id, email: a.label, status: 'free' })), total: 2 },

  get_catalog_items: { items: [], total: 0 },
  // MGR-006: наполняем таблицу шопов, чтобы было видно сортировку по приоритетам
  get_catalog_shops: {
    items: [
      { id: 1, domain: 'amazon.com', category: 'Marketplace', score: 92, ship_us: true, fraud_level: 'low', excluded: false },
      { id: 2, domain: 'bestbuy.com', category: 'Electronics', score: 84, ship_us: true, fraud_level: 'low', excluded: false },
      { id: 3, domain: 'walmart.com', category: 'Marketplace', score: 88, ship_us: true, fraud_level: 'medium', excluded: false },
      { id: 4, domain: 'target.com', category: 'Retail', score: 71, ship_us: false, fraud_level: 'high', excluded: false },
    ],
    total: 4,
    pages: 1,
  },
  get_catalog_stats: { items: 0, shops: 0 },
  import_catalog_items: null,
  import_catalog_shops: null,

  get_activity_log: { items: activityLog, total: activityLog.length },
  get_full_audit_log: { items: activityLog, total: activityLog.length },

  get_dashboard_stats: dashboardStats,
  get_revenue_chart: Array.from({ length: 14 }, (_, i) => ({ date: daysAgo(13 - i).slice(0, 10), revenue: 400 + Math.round(Math.sin(i) * 300 + i * 40), profit: 150 + Math.round(Math.sin(i) * 100 + i * 15) })),
  get_heatmap_data: heatmap,
  get_top_banks: topBanks,
  get_by_country: byCountry,
  get_by_source: bySource,
  get_by_domain: [{ domain: 'shop.example.com', total_cards: 12, free_cards: 3, dead_cards: 2, quarantined_cards: 1, total_orders: 40, revenue: 7000, success_rate: 91.0 }],
  get_expiring_cards_dashboard: expiring,
  get_bin_performance: binPerf,
  get_users_stats: userStats,

  get_admin_overview: adminOverview,
  get_online_sessions: [{ id: 1, user_id: 1, username: 'admin', ip_address: '127.0.0.1', device_info: 'Mock', created_at: daysAgo(0), last_seen_at: daysAgo(0), expires_at: daysAgo(-1) }],
  get_user_with_permissions: { ...admin, permissions: [] },
  get_user_period_stats: { period: '30d', orders_created: 15, orders_delivered: 12, total_spent: 2340.5, cards_taken: 8 },
  get_user_activity_log: activityLog.slice(0, 5),

  stuffer_list_couriers: [{ id: 1, name: 'DHL Courier', status: 'available', phone: '+1 555 000 1' }],
  stuffer_list_available_couriers: [{ id: 2, name: 'FedEx Guy', status: 'available' }],
  stuffer_list_packages: [{ id: 1, tracking: '1Z999AA10123456784', status: 'in_transit', courier_id: 1, created_at: daysAgo(2) }],
  stuffer_get_config: {},
  stuffer_get_labels: [],

  // MGR-005: политика применяется живьём — useAuth поллит их раз в минуту
  telemetry_tick: null,
  telemetry_get_policy: {
    banned: false,
    banned_reason: null,
    ban_until: null,
    update_required: false,
    min_version: null,
    permissions_override: null,
    quota_cards_day: null,
    quota_orders_day: null,
    force_logout: false,
  },

  // MGR-006: новости менеджера (баннер по severity) и приоритеты шопов
  get_manager_news: {
    news: [
      { id: 2, severity: 'warning', title: 'Плановые работы на сервере синхронизации', body: '29.08 с 03:00 до 04:00 UTC возможны перерывы синка.', published_at: daysAgo(0), expires_at: null, is_read: false },
      { id: 1, severity: 'info', title: 'Обновлены приоритеты шопов на неделю', body: null, published_at: daysAgo(1), expires_at: null, is_read: false },
    ],
    unread: 2,
  },
  mark_manager_news_read: null,
  manager_refresh_feeds: { news: 2, priorities: 3 },
  get_shop_priorities: {
    by_domain: { 'amazon.com': 9, 'bestbuy.com': 6, 'target.com': 3 },
    list: [
      { domain: 'amazon.com', weight: 9, notes: 'Основной фокус недели' },
      { domain: 'bestbuy.com', weight: 6, notes: null },
      { domain: 'target.com', weight: 3, notes: null },
    ],
  },

  sync_get_group_status: { connected: false, group_id: null },
  get_available_emails: [],
  get_free_email_for_shop: null,
}

function buildMock(data) {
  return `
(function () {
  const DATA = ${JSON.stringify(data)};
  let cbId = 0;
  let evtId = 0;
  const callbacks = new Map();
  window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
  window.__TAURI_INTERNALS__.transformCallback = function (cb) {
    const id = ++cbId;
    callbacks.set(id, cb);
    return id;
  };
  window.__TAURI_INTERNALS__.invoke = function (cmd, args) {
    if (cmd.startsWith('plugin:event|listen')) return Promise.resolve(++evtId);
    if (cmd.startsWith('plugin:')) return Promise.resolve(null);
    if (Object.prototype.hasOwnProperty.call(DATA, cmd)) {
      const v = DATA[cmd];
      return Promise.resolve(typeof v === 'function' ? v(args) : v);
    }
    console.warn('[visual-audit mock] unhandled invoke: ' + cmd);
    return Promise.resolve(null);
  };
  window.__TAURI_INTERNALS__.metadata = { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: function () {} };
})();`
}

const report = { pages: {}, consoleErrors: [], pageErrors: [], unhandled: [] }

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })

page.on('console', msg => {
  const text = msg.text()
  if (msg.type() === 'error') report.consoleErrors.push(text)
  const m = text.match(/\[visual-audit mock\] unhandled invoke: (\w+)/)
  if (m && !report.unhandled.includes(m[1])) report.unhandled.push(m[1])
})
page.on('pageerror', err => report.pageErrors.push(String(err)))

await page.addInitScript(buildMock(data))

// AUDIT_LANG=ru|en — фиксируем язык интерфейса для снимков (по умолчанию не трогаем)
if (process.env.AUDIT_LANG) {
  await page.addInitScript(`localStorage.setItem('vaultbase_lang', ${JSON.stringify(process.env.AUDIT_LANG)})`)
}

async function shot(name) {
  await page.waitForTimeout(900)
  await page.screenshot({ path: path.join(OUT, name + '.png') })
  report.pages[name] = 'ok'
  console.log('[shot]', name)
}

// 1. Экран логина: приложение ждёт лицензионные события ~3с, потом показывает Login
await page.goto(BASE, { waitUntil: 'networkidle' })
await page.waitForTimeout(4500)

const pwInput = page.locator('input[type="password"]')
if (await pwInput.isVisible().catch(() => false)) {
  await shot('00-login')
  await pwInput.first().fill('MockPassword1!')
  const btn = page.locator('button.auth-btn, button[type="submit"]').first()
  await btn.click().catch(() => {})
  await page.waitForTimeout(2500)
}

// 2. Все страницы сайдбара по порядку
const navButtons = page.locator('button.sbi')
const count = await navButtons.count()
console.log('nav buttons:', count)

for (let i = 0; i < count; i++) {
  const btn = navButtons.nth(i)
  const aria = (await btn.getAttribute('aria-label').catch(() => null)) || ''
  if (/lock|выйти|logout/i.test(aria)) { console.log('[skip]', aria); continue }
  const label = ((await btn.locator('.sbi-label').textContent().catch(() => null)) || aria || `nav-${i}`).trim()
  const name = String(i + 1).padStart(2, '0') + '-' + label.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase()
  try {
    await btn.click({ timeout: 5000 })
    await shot('nav-' + name)
    // Поиск — это оверлей: закрываем, чтобы не блокировать следующие клики
    const overlay = page.locator('.search-overlay')
    if (await overlay.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape')
      await page.waitForTimeout(400)
    }
  } catch (e) {
    report.pages['nav-' + name] = 'FAILED: ' + e.message.split('\n')[0]
    console.log('[fail]', name, e.message.split('\n')[0])
    await page.keyboard.press('Escape').catch(() => {})
    await page.waitForTimeout(300)
  }
}

function slug(s, fallback) {
  const v = String(s || '').replace(/\d+/g, '').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').toLowerCase()
  return v || fallback
}

async function navTo(re) {
  const nav = page.locator('button.sbi', { hasText: re }).first()
  if (!(await nav.count())) return false
  try {
    await nav.click({ timeout: 5000 })
    await page.waitForTimeout(700)
    return true
  } catch {
    return false
  }
}

// 3. Под-табы топбара на всех страницах, где они есть
const tabbedPages = [
  { nav: /cards|карты/i, prefix: 'cards' },
  { nav: /orders|заказы/i, prefix: 'orders' },
  { nav: /profiles|профили/i, prefix: 'profiles' },
  { nav: /catalog|каталог/i, prefix: 'catalog' },
  { nav: /couriers|курьер/i, prefix: 'couriers' },
]
for (const p of tabbedPages) {
  if (!(await navTo(p.nav))) continue
  const tabs = page.locator('.topbar .tab')
  const tn = await tabs.count()
  for (let i = 0; i < tn; i++) {
    try {
      const label = ((await tabs.nth(i).textContent()) || '').trim()
      await tabs.nth(i).click({ timeout: 3000 })
      await shot(`tab-${p.prefix}-${String(i + 1).padStart(2, '0')}-${slug(label, 'tab-' + i)}`)
    } catch (e) {
      report.pages[`tab-${p.prefix}-${i}`] = 'FAILED: ' + e.message.split('\n')[0]
      console.log('[fail] tab', p.prefix, i, e.message.split('\n')[0])
    }
  }
}

// 4. Proxies: внутренние вкладки (PPTP — дефолт, список прокси — вторая)
if (await navTo(/proxies|прокси/i)) {
  const innerTabs = page.locator('.content .tabs .tab')
  const n = await innerTabs.count()
  for (let i = 0; i < n; i++) {
    try {
      const label = ((await innerTabs.nth(i).textContent()) || '').trim()
      await innerTabs.nth(i).click({ timeout: 3000 })
      await shot(`tab-proxies-${String(i + 1).padStart(2, '0')}-${slug(label, 'tab-' + i)}`)
    } catch (e) {
      console.log('[fail] proxies tab', i, e.message.split('\n')[0])
    }
  }
}

// 5. Типовые модалки создания на ключевых страницах
const modalPages = [
  { nav: /cards|карты/i, prefix: 'cards', triggers: [/add|добавить|import|импорт/i] },
  { nav: /orders|заказы/i, prefix: 'orders', triggers: [/create|создать|new|нов/i] },
  { nav: /profiles|профили/i, prefix: 'profiles', triggers: [/нов|new|add|добавить|create|создать/i] },
  { nav: /shops|магаз/i, prefix: 'shops', triggers: [/нов|new|add|добавить|create|создать/i] },
  { nav: /imap|почта|mail/i, prefix: 'imap', triggers: [/compose|написать/i] },
]
for (const p of modalPages) {
  if (!(await navTo(p.nav))) continue
  for (const re of p.triggers) {
    const btns = page.locator('main button', { hasText: re })
    const n = Math.min(await btns.count(), 2)
    for (let i = 0; i < n; i++) {
      try {
        const label = ((await btns.nth(i).textContent()) || '').trim()
        await btns.nth(i).click({ timeout: 3000 })
        await page.waitForTimeout(800)
        const modal = page.locator('.modal, [role="dialog"]').first()
        if (await modal.isVisible().catch(() => false)) {
          await shot(`modal-${p.prefix}-${slug(label, 'm' + i)}`)
        }
        await page.keyboard.press('Escape')
        await page.waitForTimeout(400)
      } catch { /* триггер не сработал — не критично */ }
    }
  }
}

// 6. Глобальный поиск с результатами
try {
  const searchBtn = page.locator('button.sbi', { hasText: /search|поиск/i }).first()
  if (await searchBtn.count()) {
    await searchBtn.click({ timeout: 5000 })
    await page.waitForTimeout(600)
    const input = page.locator('.search-overlay input, [class*="search"] input').first()
    if (await input.isVisible().catch(() => false)) {
      await input.fill('amazon')
      await page.waitForTimeout(900)
      await shot('search-results')
    }
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
  }
} catch (e) {
  console.log('[fail] search', e.message.split('\n')[0])
}

// 7. Settings: секции длинной страницы (верх / середина / низ)
if (await navTo(/settings|настройки/i)) {
  const scroller = page.locator('.main-content-scroll')
  try {
    const h = await scroller.evaluate(el => el.scrollHeight - el.clientHeight)
    for (const [i, pos] of [0, 0.5, 1].entries()) {
      await scroller.evaluate((el, y) => el.scrollTo({ top: y }), Math.round(h * pos))
      await shot(`settings-scroll-${i + 1}`)
    }
  } catch (e) {
    console.log('[fail] settings scroll', e.message.split('\n')[0])
  }
}

fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
console.log('\n=== console errors:', report.consoleErrors.length)
console.log('=== page errors:', report.pageErrors.length)
console.log('=== unhandled invokes:', report.unhandled.join(', ') || 'none')

await browser.close()
