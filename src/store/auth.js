import { create } from 'zustand'

export const useAuthStore = create((_set, _get) => ({
  user: null,
  isAuthenticated: false,
  loading: false,

  login: async _credentials => {},
  logout: async () => {},
  checkAuth: async () => {},
}))
