import { create } from 'zustand'

// Placeholder for Auth store - to be implemented in Phase 2
export const useAuthStore = create((_set, _get) => ({
  user: null,
  isAuthenticated: false,
  loading: false,

  // Actions to be implemented
  login: async _credentials => {
    // TODO: Implement
  },

  logout: async () => {
    // TODO: Implement
  },

  checkAuth: async () => {
    // TODO: Implement
  },
}))
