import { create } from 'zustand'

export const useUIStore = create(set => ({
  // Modals
  showColPicker: false,

  // View options
  compact: false,
  groupByBank: false,

  // Side panels
  sideCard: null,
  sideCardIdx: null,
  shopUsageCardId: null,
  timelineCardId: null,

  // Status menu
  statusMenuId: null,

  // Enrich progress
  enrichProgress: null,

  // Actions
  setShowColPicker: show => set({ showColPicker: show }),
  setCompact: compact => set({ compact }),
  setGroupByBank: groupByBank => set({ groupByBank }),
  toggleCompact: () => set(state => ({ compact: !state.compact })),
  toggleGroupByBank: () => set(state => ({ groupByBank: !state.groupByBank })),

  setSideCard: (card, idx = null) => set({ sideCard: card, sideCardIdx: idx }),
  closeSideCard: () => set({ sideCard: null, sideCardIdx: null }),

  setShopUsageCardId: id => set({ shopUsageCardId: id }),
  setTimelineCardId: id => set({ timelineCardId: id }),

  setStatusMenuId: id => set({ statusMenuId: id }),

  setEnrichProgress: progress => set({ enrichProgress: progress }),

  // SEC-014: Reset all UI state on lock/logout
  clearSensitiveData: () =>
    set({
      showColPicker: false,
      sideCard: null,
      sideCardIdx: null,
      shopUsageCardId: null,
      timelineCardId: null,
      statusMenuId: null,
      enrichProgress: null,
    }),
}))
