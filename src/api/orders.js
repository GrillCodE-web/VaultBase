import { invoke } from '@tauri-apps/api/core'

export const ordersApi = {
  getOrders: (filters, page, perPage) => invoke('get_orders', { filter: filters, page, perPage }),
  getOrder: id => invoke('get_order', { id }),
  getCalendarEvents: month => invoke('get_calendar_events', { month }),
  createOrder: data => invoke('create_order', { data }),
  updateOrderStatus: (id, status) => invoke('update_order_status', { id, status }),
  deleteOrder: id => invoke('delete_order', { id }),
  bulkDeleteOrders: ids => invoke('bulk_delete_orders', { ids }),
  bulkUpdateStatus: (ids, status) => invoke('bulk_update_order_status', { ids, status }),
  repeatOrder: id => invoke('repeat_order', { id }),
  exportOrders: filters => invoke('export_orders_csv', { filter: filters }),
  batchImport: text => invoke('batch_import_orders', { text }),
}
