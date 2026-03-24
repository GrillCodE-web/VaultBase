import { create } from 'zustand'

export const useUIStore = create(set => ({
  // Modals
  showImport: false,
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

  // Flash animations
  flashedIds: [], // Use array instead of Set for localStorage compatibility

  // Enrich progress
  enrichProgress: null,

  // Actions
  setShowImport: show => set({ showImport: show }),
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

  addFlashedId: id =>
    set(state => ({
      flashedIds: [...state.flashedIds, id],
    })),

  removeFlashedId: id =>
    set(state => ({
      flashedIds: state.flashedIds.filter(fid => fid !== id),
    })),

  setEnrichProgress: progress => set({ enrichProgress: progress }),
}))
