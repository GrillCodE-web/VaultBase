// ============================================================
// PATCH — merge these keys into src/i18n/en.js and ru.js
// ============================================================

// ── en.js additions ──────────────────────────────────────────
export const en_dashboard = {
  // Page header
  dashboard_title: "Dashboard",

  // Quick actions
  quick_import_cc: "Import CC",
  quick_create_profile: "Create Profile",
  quick_new_order: "New Order",

  // Period selector
  period_today: "Today",
  period_7d: "7d",
  period_30d: "30d",
  period_all: "All time",
  period_custom: "Custom",

  // Static counters
  total_cc: "Total CC",
  free_cc: "Free CC",
  in_use: "In Use",
  dead_cc: "Dead CC",
  profiles: "Profiles",
  no_drop: "No Drop",

  // Period stats
  orders: "Orders",
  pending: "Pending",
  shipped: "Shipped",
  delivered: "Delivered",
  declined: "Declined",
  revenue: "Revenue",
  net_profit: "Net Profit",
  delivered_only: "Delivered only",

  // Trends
  vs_prev_period: "vs prev period",

  // Chart
  chart_title: "Revenue & Profit",
  chart_revenue: "Revenue",
  chart_profit: "Net Profit",
  chart_no_data: "No orders in this period",

  // Heatmap
  heatmap_title: "Bank × Shop Success Rate",
  heatmap_no_data: "Not enough data (need ≥3 orders per combination)",

  // Analytics sections
  section_top_banks: "Top Banks",
  section_by_country: "By Country",
  section_by_source: "By Source",
  section_expiring: "Expiring Cards (30d)",

  // Table headers
  bank: "Bank",
  country: "Country",
  source: "Source",
  cards: "Cards",
  free: "Free",
  dead: "Dead",
  success_rate: "Success",
  days_left: "Days Left",
  has_profile: "Profile",

  // Alerts
  alerts_title: "Alerts",
  alert_stale_pending: "{n} order(s) pending for more than 5 days",
  alert_expiring_profile: "{n} card(s) expiring within 30 days (active profiles)",
  alert_no_drop: "{n} profile(s) have no drop address",
  alert_bin_declined: "{n} BIN(s) declined ≥3 times at the same shop",

  // Export
  export_csv: "Export CSV",
  export_success: "Exported successfully",
  export_fail: "Export failed",
  exporting: "Exporting…",

  // Sidebar badges
  badge_pending_orders: "pending orders",
  badge_expiring_cards: "expiring cards",
  badge_no_drop: "no drop",
  badge_clean_emails: "clean emails",
  badge_unsynced: "unsynced",
  offline_mode: "Offline",
};

// ── ru.js additions ──────────────────────────────────────────
export const ru_dashboard = {
  dashboard_title: "Главная",

  quick_import_cc: "Импорт CC",
  quick_create_profile: "Создать профиль",
  quick_new_order: "Новый заказ",

  period_today: "Сегодня",
  period_7d: "7д",
  period_30d: "30д",
  period_all: "Всё время",
  period_custom: "Период",

  total_cc: "Всего CC",
  free_cc: "Свободных",
  in_use: "В работе",
  dead_cc: "Мёртвых",
  profiles: "Профилей",
  no_drop: "Без дропа",

  orders: "Заказов",
  pending: "Ожидают",
  shipped: "Отправлено",
  delivered: "Доставлено",
  declined: "Отказано",
  revenue: "Выручка",
  net_profit: "Чистая прибыль",
  delivered_only: "Только доставленные",

  vs_prev_period: "vs пред. период",

  chart_title: "Выручка и прибыль",
  chart_revenue: "Выручка",
  chart_profit: "Чистая прибыль",
  chart_no_data: "Нет заказов за этот период",

  heatmap_title: "Успех: банк × магазин",
  heatmap_no_data: "Недостаточно данных (нужно ≥3 заказов)",

  section_top_banks: "Топ банки",
  section_by_country: "По странам",
  section_by_source: "По источнику",
  section_expiring: "Истекающие карты (30д)",

  bank: "Банк",
  country: "Страна",
  source: "Источник",
  cards: "Карт",
  free: "Свободных",
  dead: "Мёртвых",
  success_rate: "Успех",
  days_left: "Осталось",
  has_profile: "Профиль",

  alerts_title: "Предупреждения",
  alert_stale_pending: "{n} заказ(ов) в ожидании более 5 дней",
  alert_expiring_profile: "{n} карт(ы) истекают в течение 30 дней (активные профили)",
  alert_no_drop: "{n} профиль(ей) без дропа",
  alert_bin_declined: "{n} BIN(ов) отклонено ≥3 раз в одном магазине",

  export_csv: "Экспорт CSV",
  export_success: "Экспорт выполнен",
  export_fail: "Ошибка экспорта",
  exporting: "Экспортируем…",

  badge_pending_orders: "ожидают",
  badge_expiring_cards: "истекают",
  badge_no_drop: "без дропа",
  badge_clean_emails: "чистых email",
  badge_unsynced: "не синхр.",
  offline_mode: "Офлайн",
};
