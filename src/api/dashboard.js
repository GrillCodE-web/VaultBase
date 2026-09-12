import { invoke } from '@tauri-apps/api/core'

export const dashboardApi = {
  getStats: params => invoke('get_dashboard_stats', params),
  getRevenueChart: params => invoke('get_revenue_chart', params),
  getHeatmap: params => invoke('get_heatmap_data', params),
  getTopBanks: params => invoke('get_top_banks', params),
  getByCountry: params => invoke('get_by_country', params),
  getBySource: params => invoke('get_by_source', params),
  getByDomain: params => invoke('get_by_domain', params),
  getExpiringCards: days => invoke('get_expiring_cards_dashboard', { days }),
  getBinPerformance: () => invoke('get_bin_performance'),
  getBinShopPerformance: bin => invoke('get_bin_shop_performance', { bin }),
  getUsersStats: () => invoke('get_users_stats'),
  exportCsv: params => invoke('export_dashboard_csv', params),
}
