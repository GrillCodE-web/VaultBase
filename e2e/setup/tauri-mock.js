/**
 * Мок Tauri invoke() для Playwright E2E тестов.
 * Инжектируется через globalSetup или addInitScript в каждый тест.
 *
 * Позволяет запускать E2E против Vite dev-сервера без полного Tauri-бинаря.
 * Команды с неизвестным именем возвращают пустые данные вместо краша.
 */

const MOCK_DATA = {
  user_login: { success: true, user: { id: 1, username: 'admin', role: 'admin' } },
  try_auto_login: null,
  is_locked: true,
  is_password_set: true,
  get_current_user: { id: 1, username: 'admin', role: 'admin' },
  get_dashboard_stats: {
    total_cards: 0, active_cards: 0, total_orders: 0, revenue: 0,
    success_rate: 0, avg_order_value: 0,
  },
  get_sidebar_badges: { orders_pending: 0, cards_expiring: 0, imap_unread: 0 },
  get_cards: { items: [], total: 0 },
  get_orders: { items: [], total: 0 },
  get_app_version: '2.11.2',
  get_license_status: { status: 'active', plan: 'dev' },
  stuffer_get_config: { api_key_set: false, base_url: '' },
  get_config: {},
};

/**
 * Возвращает строку скрипта для инжекции через page.addInitScript().
 */
export function getTauriMockScript() {
  return `
(function() {
  const MOCK = ${JSON.stringify(MOCK_DATA)};

  // Tauri v2 IPC stub
  window.__TAURI_IPC__ = function(message) {
    const { cmd, callback, error } = message;
    const result = MOCK[cmd] !== undefined ? MOCK[cmd] : null;
    setTimeout(() => {
      if (typeof window[callback] === 'function') {
        window[callback](result);
      }
    }, 0);
  };

  // Tauri v2 invoke()
  window.__TAURI__ = window.__TAURI__ || {};
  window.__TAURI__.core = window.__TAURI__.core || {};
  window.__TAURI__.core.invoke = function(cmd, args) {
    return new Promise((resolve) => {
      const result = MOCK[cmd] !== undefined ? MOCK[cmd] : null;
      setTimeout(() => resolve(result), 10);
    });
  };

  // Tauri v2 plugin API stubs
  window.__TAURI__.updater = { check: () => Promise.resolve(null) };
  window.__TAURI__.process = { relaunch: () => Promise.resolve() };
  window.__TAURI__.dialog = {
    open: () => Promise.resolve(null),
    save: () => Promise.resolve(null),
  };
})();
`;
}
