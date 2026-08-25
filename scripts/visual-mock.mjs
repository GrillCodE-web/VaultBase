// Общий мок Tauri для визуальных проверок (visual-audit.mjs / visual-modal-check.mjs).
// Держать синхронным с visual-audit.mjs.

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
]

const orders = [
  { id: 1, order_number: 'VB-100234', status: 'delivered', shop_name: 'Amazon', profile_id: 'p1', shop_id: 1, drop_id: 1, holder_masked: 'J. Doe', last4: '8834', bank_name: 'Chase', total_amount: 249.99, tracking_number: '1Z999AA10123456784', carrier: 'UPS', proxy_label: 'proxy-us-1', email_addr: 'john@example.com', notes: null, created_at: daysAgo(12), updated_at: daysAgo(8) },
  { id: 2, order_number: 'VB-100235', status: 'shipped', shop_name: 'BestBuy', profile_id: 'p2', shop_id: 2, drop_id: 2, holder_masked: 'J. Smith', last4: '1120', bank_name: 'BoA', total_amount: 1099.0, tracking_number: '9405511899223197428490', carrier: 'USPS', proxy_label: null, email_addr: 'jane@example.com', notes: 'Хрупкое', created_at: daysAgo(6), updated_at: daysAgo(4) },
  { id: 3, order_number: 'VB-100236', status: 'pending', shop_name: 'Walmart', profile_id: 'p1', shop_id: 3, drop_id: 1, holder_masked: 'J. Doe', last4: '8834', bank_name: 'Chase', total_amount: 89.5, tracking_number: null, carrier: null, proxy_label: null, email_addr: 'john@example.com', notes: null, created_at: daysAgo(1), updated_at: daysAgo(1) },
]

const profiles = [
  { id: 'p1', card_id: 1, notes: 'Основной', created_at: daysAgo(60), updated_at: daysAgo(2), bin: '414720', last4: '8834', bank_name: 'Chase', card_type: 'debit', country: 'US', card_status: 'free', holder_masked: 'J*** D***', drop_count: 1, order_count: 15, recipient_name: 'John Doe', address: '123 Main St', city: 'New York', state: 'NY', zip: '10001' },
]

const shops = [
  { id: 1, name: 'Amazon', domain: 'amazon.com', url: 'https://amazon.com', category: 'Marketplace', notes: null, requires_cvv_match: true, blocks_vpn: false, phone_must_match: false, accepts_amex: true, requires_avs: true, high_cancel_risk: false, total_orders: 42, delivered: 38, declined: 3, success_rate: 90.5, avg_order_value: 240.0, created_at: daysAgo(200), updated_at: daysAgo(1) },
]

const dashboardStats = {
  total_cc: 128, free_cc: 34, in_use_cc: 71, dead_cc: 23,
  total_profiles: 86, no_drop_profiles: 12,
  total_orders: 512, pending: 14, shipped: 67, delivered: 431, declined: 18,
  revenue: 84230.5, net_profit: 31200.0,
  orders_trend: 12.4, revenue_trend: 8.1, delivered_trend: 5.6,
  alerts: [],
}

export const data = {
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
  global_search: { cards: [], orders: [], profiles: [], shops: [], emails: [], proxies: [] },

  get_cards: { items: cards, total: cards.length, free_total: 1 },
  get_card_stats: { total: 128, free: 34, assigned: 71, burned: 23 },
  get_card_filter_meta: { countries: ['US'], banks: ['Chase'], sources: ['manual'] },
  get_orders: { items: orders, total: orders.length },
  get_order_templates: [],
  get_profiles: { items: profiles, total: profiles.length },
  get_shops: { items: shops, total: shops.length },
  get_proxies: { items: [], total: 0 },
  get_emails: { items: [], total: 0 },
  search_catalog_shops: [],
  search_catalog_items: [],
  get_catalog_stats: { items: 1, shops: 1 },

  get_dashboard_stats: dashboardStats,
  get_revenue_chart: [],
  get_heatmap_data: [],
  get_top_banks: [],
  get_by_country: [],
  get_by_source: [],
  get_by_domain: [],
  get_expiring_cards_dashboard: [],
  get_bin_performance: [],
  get_users_stats: [],

  get_user_with_permissions: { ...admin, permissions: [] },

  stuffer_list_couriers: [{ id: 1, name: 'DHL Courier', status: 'available', phone: '+1 555 000 1' }],
  stuffer_list_available_couriers: [{ id: 2, name: 'FedEx Guy', status: 'available' }],
  stuffer_list_packages: [],
  stuffer_get_config: {},
  stuffer_get_labels: [],

  sync_get_group_status: { connected: false, group_id: null },
}

export function buildMock(d) {
  return `
(function () {
  try { localStorage.setItem('onboarding_done', '1') } catch {}
  const DATA = ${JSON.stringify(d)};
  let evtId = 0;
  window.__TAURI_INTERNALS__ = window.__TAURI_INTERNALS__ || {};
  window.__TAURI_INTERNALS__.transformCallback = function (cb) {
    return 1;
  };
  window.__TAURI_INTERNALS__.invoke = function (cmd, args) {
    if (cmd.startsWith('plugin:event|listen')) return Promise.resolve(++evtId);
    if (cmd.startsWith('plugin:')) return Promise.resolve(null);
    if (Object.prototype.hasOwnProperty.call(DATA, cmd)) {
      const v = DATA[cmd];
      return Promise.resolve(typeof v === 'function' ? v(args) : v);
    }
    console.warn('[visual-mock] unhandled invoke: ' + cmd);
    return Promise.resolve(null);
  };
  window.__TAURI_INTERNALS__.metadata = { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: function () {} };
})();`
}
