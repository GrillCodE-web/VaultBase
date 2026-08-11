import { invoke } from '@tauri-apps/api/core'

export const profilesApi = {
  getProfiles: (filters, page, perPage) =>
    invoke('get_profiles', { filter: filters, page, perPage }),
  getProfile: id => invoke('get_profile', { id }),
  createProfile: data => invoke('create_profile', { data }),
  updateProfile: (id, data) => invoke('update_profile', { id, data }),
  deleteProfile: id => invoke('delete_profile', { id }),
  bulkDeleteProfiles: ids => invoke('bulk_delete_profiles', { ids }),
  assignCard: (profileId, cardId) => invoke('assign_card_to_profile', { profileId, cardId }),
  autoAssignCard: profileId => invoke('auto_assign_card', { profileId }),
  autoAssignEmail: profileId => invoke('auto_assign_email', { profileId }),
  importDrops: text => invoke('import_drops', { text }),
}
