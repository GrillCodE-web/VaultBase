import { invoke } from '@tauri-apps/api/core'

export const cardsApi = {
  getCards: (filters, page, perPage) => invoke('get_cards', { filter: filters, page, perPage }),
  getCard: id => invoke('get_card', { id }),
  createCard: data => invoke('create_card', { data }),
  updateCardStatus: (id, status) => invoke('update_card_status', { id, status }),
  deleteCard: id => invoke('delete_card', { id }),
  revealCard: id => invoke('reveal_card', { id }),
  bulkDeleteCards: ids => invoke('bulk_delete_cards', { ids }),
  bulkUpdateStatus: (ids, status) => invoke('bulk_update_card_status', { ids, status }),
  enrichBin: id => invoke('enrich_card_bin', { id }),
  bulkEnrichBin: ids => invoke('bulk_enrich_bin', { ids }),
  exportCards: filters => invoke('export_cards_csv', { filter: filters }),
  getCardStats: () => invoke('get_card_stats'),
}
