import { create } from 'zustand'

export const useProfilesStore = create((_set, _get) => ({
  profiles: [],
  total: 0,
  loading: false,
  filters: {},
  page: 1,

  fetchProfiles: async () => {},
  updateProfile: async (_id, _updates) => {},
}))
