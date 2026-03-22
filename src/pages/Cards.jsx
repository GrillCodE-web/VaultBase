import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Store, Clock, X, Copy, CheckCircle, XCircle, User, Trash2, Zap, AlertTriangle, Archive, Upload, RefreshCw, Landmark, CreditCard } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ActionsMenu } from "../components/ActionsMenu.jsx";
import { useLang } from "../hooks/useLang.jsx";
import { useToast } from "../hooks/useToast.jsx";
import { useConfirm } from "../hooks/useConfirm.jsx";
import { useDebounce } from "../hooks/useDebounce.js";
import { EmptyState } from "../components/EmptyState.jsx";
import { SkeletonRows } from "../components/SkeletonRow.jsx";
import {
  countryFlag,
  buildPipeString,
  formatCardNumber,
  formatBinMasked
} from "../utils/formatting.js";
import { getBinBadge } from "../constants/cardTypes.js";
import { copyToClipboard } from "../utils/clipboard.js";
import { getCardHealth } from "../utils/cardHealth.js";
import { buildPageNumbers } from "../utils/pagination.js";
import { ImportModal } from "./Cards/ImportModal.jsx";
import { CardFilters } from "./Cards/CardFilters.jsx";
import { CardRow } from "./Cards/CardRow.jsx";
import { ColumnPicker } from "./Cards/ColumnPicker.jsx";
import { CardSidePanel } from "./Cards/CardSidePanel.jsx";
import { CardShopUsagePanel } from "./Cards/CardShopUsagePanel.jsx";
import { CardTimelinePanel } from "./Cards/CardTimelinePanel.jsx";

// ─── Constants ────────────────────────────────────────────────────────────

const STATUS_CSS = {
  free:    "st-free",
  in_use:  "st-inuse",
  dead:    "st-dead",
  archive: "st-archive",
};

function getAllColumns(t) {
  return [
  { id: "card_number", label: "cc_col_number"  },
  { id: "expiry",      label: t("card_label_expiry") },
  { id: "cvv",         label: t("card_label_cvv") },
  { id: "holder",      label: "cc_col_holder"  },
  { id: "billing",     label: t("copy_billing") },
  { id: "zip",         label: t("drop_field_zip").replace(" *","") },
  { id: "city",        label: t("drop_field_city").replace(" *","") },
  { id: "state",       label: t("drop_field_state") },
  { id: "country",     label: "cc_col_country" },
  { id: "phone",       label: t("drop_field_phone") },
  { id: "bin_bank",    label: "cc_col_bin"     },
  { id: "type",        label: "cc_col_type"    },
  { id: "source",      label: "cc_col_source"  },
  { id: "status",      label: "cc_col_status"  },
  { id: "health",      label: "Health"         },
  { id: "notes",       label: "cc_col_notes"   },
  { id: "created",     label: "cc_col_created" },
  { id: "email_cc",    label: t("col_email") },
  { id: "ip",          label: "IP"             },
  { id: "actions",     label: "cc_col_actions" },
];
}

// #default order — Number | Exp | CVV | Holder | Address | ZIP | City | State | Country | Phone | Status | Actions
const DEFAULT_COLS = [
  "card_number","expiry","cvv","holder","billing","zip","city","state","country","phone","status","actions",
];

// ─── Main Cards page ──────────────────────────────────────────────────────

export default function Cards({ onNavigate, activeTab = "list", openImport = false }) {
  const { t } = useLang();
  const ALL_COLUMNS = getAllColumns(t);
  const { toast }   = useToast();
  const { confirm } = useConfirm();

  // ── State ──────────────────────────────────────────────────────────────

  const [cards, setCards]           = useState([]);
  const [total, setTotal]           = useState(0);
  const [freeTotal, setFreeTotal]   = useState(0);
  const [page, setPage]             = useState(1);
  const [loading, setLoading]       = useState(false);
  const [showImport, setShowImport] = useState(openImport);
  const [showColPicker, setShowColPicker] = useState(false);
  const [compact, setCompact]       = useState(false);
  const [groupByBank, setGroupByBank] = useState(false);

  const [selected, setSelected]     = useState(new Set());
  const [deletingIds, setDeletingIds] = useState(new Set());

  // #36 — revealed is still needed (auto-populated in background, no manual buttons)
  const [revealed, setRevealed]     = useState({});
  const revealedRef = useRef({});
  revealedRef.current = revealed;

  // #61 — side panel
  const [sideCard, setSideCard]     = useState(null);
  const [sideCardIdx, setSideCardIdx] = useState(null);

  // Shop usage + timeline panels
  const [shopUsageCardId, setShopUsageCardId] = useState(null);
  const [timelineCardId, setTimelineCardId] = useState(null);

  // Real-time sync flash animation
  const [flashedIds, setFlashedIds] = useState(new Set());
  const flashTimers = useRef({});

  const [enrichProgress, setEnrichProgress] = useState(null); // null=idle, {done,total} when active

  // #42 — inline status menu
  const [statusMenuId, setStatusMenuId] = useState(null);

  // default column order: Number | Exp | CVV | Holder | Address | ZIP | City | State | Country | Phone
  const [visibleCols, setVisibleCols] = useState(() => {
    try {
      const saved = localStorage.getItem("cc_columns_visible");
      if (saved) {
        const parsed = JSON.parse(saved);
        const allCols = getAllColumns(k => k); if (Array.isArray(parsed) && parsed.every(c => allCols.some(a => a.id === c))) return parsed;
      }
    } catch {
      // Ignore localStorage errors
    }
    return DEFAULT_COLS;
  });

  // #46 — drag-to-reorder column order
  const [columnOrder, setColumnOrder] = useState(() => {
    try {
      const saved = localStorage.getItem("cc_columns_order");
      if (saved) return JSON.parse(saved);
    } catch {
      // Ignore localStorage errors
    }
    return null; // null = use default (ALL_COLUMNS order)
  });
  const dragColRef = useRef(null);

  const [filter, setFilter] = useState({
    status: null, country: null, bank_name: null, source: null,
    card_type: null, search: null, state: null, zip_prefix: null,
  });
  const [filterMeta, setFilterMeta] = useState({ countries: [], banks: [], sources: [] });
  const [searchInput, setSearchInput] = useState("");
  const debouncedSearch = useDebounce(searchInput, 300);

  const PER_PAGE   = 50;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  // Virtual scroll container ref
  const parentRef = useRef(null);

  // ── Load + auto-reveal ─────────────────────────────────────────────────

  // #36 — silently reveal cards in background after they load
  const autoRevealBatch = useCallback(async (cardList) => {
    for (const card of cardList) {
      if (revealedRef.current[card.id]) continue;
      try {
        const data = await invoke("reveal_card", { id: card.id });
        setRevealed(r => ({ ...r, [card.id]: data }));
      } catch {
        // Card reveal failed, skip
      }
    }
  }, []);

  const loadFilterMeta = useCallback(async () => {
    try {
      const meta = await invoke("get_card_filter_meta");
      setFilterMeta(meta);
    } catch {
      // Filter meta load failed
    }
  }, []);

  const loadCards = useCallback(async () => {
    setLoading(true);
    try {
      const res = await invoke("get_cards", { filter, page, perPage: PER_PAGE });
      setCards(res.items);
      setTotal(res.total);
      setFreeTotal(res.free_total ?? 0);
      if (res.items.length === 0 && res.total > 0 && page > 1) {
        setPage(p => Math.max(1, p - 1));
      }
      // auto-reveal in background (no await — non-blocking)
      autoRevealBatch(res.items);
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toast is stable from useToast
  }, [filter, page, autoRevealBatch]);

  useEffect(() => { loadCards(); }, [loadCards]);
  useEffect(() => { loadFilterMeta(); }, [loadFilterMeta]);

  // #20 — debounce search: update filter when user stops typing
  useEffect(() => {
    setFilter(f => ({ ...f, search: debouncedSearch || null }));
    setPage(1);
  }, [debouncedSearch]);  

  useEffect(() => {
    setFilter(f => ({ ...f, expiring_soon: activeTab === "expiring" ? true : null }));
    setPage(1);
  }, [activeTab]);

  // Real-time sync: listen for card updates from WS sync
  useEffect(() => {
    let unlistenUpdate, unlistenFull;
    listen("sync:card_update", (event) => {
      const updates = event.payload ?? [];
      // Apply status changes directly in state without full reload
      setCards(prev => prev.map(c => {
        const upd = updates.find(u => u.id === c.id);
        if (!upd) return c;
        // Flash this card
        setFlashedIds(f => { const n = new Set(f); n.add(c.id); return n; });
        if (flashTimers.current[c.id]) clearTimeout(flashTimers.current[c.id]);
        flashTimers.current[c.id] = setTimeout(() => {
          setFlashedIds(f => { const n = new Set(f); n.delete(c.id); return n; });
        }, 2000);
        return { ...c, status: upd.status ?? c.status, notes: upd.notes ?? c.notes };
      }));
    }).then(u => { unlistenUpdate = u; }).catch(() => {});

    listen("sync:full_data", () => {
      // Full sync received — reload current page
      loadCards();
    }).then(u => { unlistenFull = u; }).catch(() => {});

    return () => {
      unlistenUpdate?.();
      unlistenFull?.();
      // Capture current timers before cleanup
      const timers = flashTimers.current;
      Object.values(timers).forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- loadCards is stable
  }, []);

  // ── Close status menu on outside click ────────────────────────────────

  useEffect(() => {
    if (!statusMenuId) return;
    const handler = (e) => {
      if (!e.target.closest(".status-menu-anchor")) setStatusMenuId(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [statusMenuId]);

  // ── Selection helpers ──────────────────────────────────────────────────

  const toggleSelect = (id) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === cards.length) setSelected(new Set());
    else setSelected(new Set(cards.map(c => c.id)));
  };

  // ── Actions ────────────────────────────────────────────────────────────

  const handleStatusChange = async (id, status) => {
    if (status === "dead") {
      const ok = await confirm(t("cc_confirm_dead"), { danger: true });
      if (!ok) return;
    }
    try {
      await invoke("update_card_status", { id, status });
      toast(t("card_marked_as") + " " + status, "success");
      loadCards();
    } catch (e) { toast(String(e), "error"); }
  };

  const handleDelete = async (id) => {
    // #15 — soft delete immediately, show Undo toast (no confirm dialog)
    setDeletingIds(prev => new Set([...prev, id]));
    let undone = false;
    toast({
      message: t("msg_deleted"),
      type: "info",
      duration: 5000,
      action: {
        label: "Undo",
        onClick: () => {
          undone = true;
          setDeletingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
        },
      },
    });
    setTimeout(async () => {
      if (undone) return;
      try {
        await invoke("delete_card", { id });
        setDeletingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
        loadCards();
      } catch (e) {
        setDeletingIds(prev => { const n = new Set(prev); n.delete(id); return n; });
        const msg = String(e);
        if (msg.includes("in_use") || msg.includes("card_in_use")) {
          toast(t("card_cannot_delete_linked"), "error");
        } else {
          toast(msg, "error");
        }
      }
    }, 5000);
  };

  const handleBulkStatus = async (status) => {
    if (status === "dead") {
      const ok = await confirm(t("cards_bulk_mark_dead").replace("{n}", selected.size), t("cc_mark_dead"));
      if (!ok) return;
    }
    try {
      await invoke("bulk_update_cards", { ids: [...selected], status });
      toast(selected.size + " " + t("cards_bulk_moved") + " " + status, "success");
      setSelected(new Set());
      loadCards();
    } catch (e) { toast(String(e), "error"); }
  };

  const handleArchiveDead = async () => {
    const deadIds = cards.filter(c => c.status === "dead").map(c => c.id);
    if (deadIds.length === 0) { toast("No dead cards on this page", "warn"); return; }
    const ok = await confirm(`Archive ${deadIds.length} dead card${deadIds.length !== 1 ? "s" : ""}?`, t("status_archive"));
    if (!ok) return;
    try {
      await invoke("bulk_update_cards", { ids: deadIds, status: "archive" });
      toast(`${deadIds.length} dead cards archived`, "success");
      setSelected(new Set());
      loadCards();
    } catch (e) { toast(String(e), "error"); }
  };

  const handleBulkDelete = async () => {
    const ok = await confirm(t("cards_bulk_delete").replace("{n}", selected.size), t("btn_delete"));
    if (!ok) return;
    try {
      await invoke("bulk_delete_cards", { ids: [...selected] });
      toast(t("cards_bulk_deleted").replace("{n}", selected.size), "success");
      setSelected(new Set());
      loadCards();
    } catch (e) { toast(String(e), "error"); }
  };

  const handleBulkEnrich = async () => {
    const ids = [...selected].filter(id => {
      const card = cards.find(c => c.id === id);
      return card?.bin;
    });
    if (!ids.length) return;
    setEnrichProgress({ done: 0, total: ids.length });
    let enriched = 0;
    for (const id of ids) {
      try {
        await invoke("enrich_bin", { id });
        enriched++;
      } catch {
        // BIN enrichment failed for this card
      }
      setEnrichProgress({ done: enriched, total: ids.length });
    }
    setEnrichProgress(null);
    toast(`BIN enriched: ${enriched} / ${ids.length}`, "success");
    loadCards();
  };

  const handleExport = async (format) => {
    try {
      const content = await invoke("export_cards", { ids: [...selected], format });
      const blob = new Blob([content], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `cards_export.${format === "csv" ? "csv" : "txt"}`;
      a.click();
    } catch (e) { toast(String(e), "error"); }
  };

  const handleEditNote = async (id, notes) => {
    try { await invoke("update_card_notes", { id, notes }); }
    catch (e) { toast(String(e), "error"); }
  };

  const handleSearch = () => {
    setFilter(f => ({ ...f, search: searchInput || null }));
    setPage(1);
  };

  const handleResetFilters = () => {
    setFilter({ status: null, country: null, bank_name: null, source: null, card_type: null, search: null, state: null, zip_prefix: null });
    setSearchInput("");
    setPage(1);
  };

  const handleCopyToast = (text) => {
    copyToClipboard(text, () => toast(t("copied"), "success"), () => toast(t("copy_failed"), "error"));
  };

  // ── Render helpers ─────────────────────────────────────────────────────

  const allSelected  = cards.length > 0 && selected.size === cards.length;
  const someSelected = selected.size > 0 && selected.size < cards.length;

  const renderCard = (card) => (
    <CardRow
      key={card.id}
      card={card}
      cards={cards}
      revealed={revealed}
      selected={selected}
      deletingIds={deletingIds}
      flashedIds={flashedIds}
      statusMenuId={statusMenuId}
      visibleCols={visibleCols}
      toggleSelect={toggleSelect}
      setSideCard={setSideCard}
      setSideCardIdx={setSideCardIdx}
      setStatusMenuId={setStatusMenuId}
      handleStatusChange={handleStatusChange}
      handleCopyToast={handleCopyToast}
      handleEditNote={handleEditNote}
      setShopUsageCardId={setShopUsageCardId}
      setTimelineCardId={setTimelineCardId}
      handleDelete={handleDelete}
      setFilter={setFilter}
      setPage={setPage}
      onNavigate={onNavigate}
      t={t}
      toast={toast}
    />
  );

  // ── Grouped render ─────────────────────────────────────────────────────

  const groupedCards = useMemo(() => Object.entries(
    cards.reduce((acc, c) => {
      const k = c.bank_name || t("msg_no_data");
      (acc[k] = acc[k] || []).push(c);
      return acc;
    }, {})
  ).sort((a, b) => a[0].localeCompare(b[0])), [cards, t]);

  // Virtual scrolling setup - only for non-grouped view
  const useVirtualCards = !groupByBank && cards.length > 200;

  const rowVirtualizer = useVirtualizer({
    count: useVirtualCards ? cards.length : 0,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 38,
    overscan: 5,
    enabled: useVirtualCards,
  });

  const renderRows = () => {
    if (!groupByBank) {
      if (useVirtualCards) {
        const virtualItems = rowVirtualizer.getVirtualItems();
        return (
          <>
            {virtualItems.length > 0 && (
              <tr style={{ height: virtualItems[0].start }} />
            )}
            {virtualItems.map((virtualRow) => {
              const card = cards[virtualRow.index];
              return (
                <CardRow
                  key={card.id}
                  card={card}
                  cards={cards}
                  revealed={revealed}
                  selected={selected}
                  deletingIds={deletingIds}
                  flashedIds={flashedIds}
                  statusMenuId={statusMenuId}
                  visibleCols={visibleCols}
                  toggleSelect={toggleSelect}
                  setSideCard={setSideCard}
                  setSideCardIdx={setSideCardIdx}
                  setStatusMenuId={setStatusMenuId}
                  handleStatusChange={handleStatusChange}
                  handleCopyToast={handleCopyToast}
                  handleEditNote={handleEditNote}
                  setShopUsageCardId={setShopUsageCardId}
                  setTimelineCardId={setTimelineCardId}
                  handleDelete={handleDelete}
                  setFilter={setFilter}
                  setPage={setPage}
                  onNavigate={onNavigate}
                  t={t}
                  toast={toast}
                />
              );
            })}
            {virtualItems.length > 0 && (
              <tr style={{ height: rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end }} />
            )}
          </>
        );
      }
      return cards.map(renderCard);
    }
    return groupedCards.map(([bank, groupCards]) => (
      <tbody key={bank}>
        <tr>
          <td colSpan={99} style={{
            padding: "5px 10px", background: "var(--surface)",
            color: "var(--muted)", fontSize: 10, fontWeight: 700,
            borderBottom: "1px solid var(--border)", letterSpacing: "0.06em", textTransform: "uppercase",
          }}>
            {bank} · {groupCards.length} {t("cards")} · {groupCards.filter(c => c.status === "free").length} {t("status_free")}
          </td>
        </tr>
        {groupCards.map(renderCard)}
      </tbody>
    ));
  };

  // #46 — sorted by columnOrder if set, else default ALL_COLUMNS order
  // eslint-disable-next-line react-hooks/exhaustive-deps -- ALL_COLUMNS is constant
  const orderedColumns = useMemo(() =>
    columnOrder
      ? [...ALL_COLUMNS].sort((a, b) => {
          const ia = columnOrder.indexOf(a.id);
          const ib = columnOrder.indexOf(b.id);
          if (ia === -1 && ib === -1) return 0;
          if (ia === -1) return 1;
          if (ib === -1) return -1;
          return ia - ib;
        })
      : ALL_COLUMNS,
  [columnOrder]);

  const visibleHeaders = useMemo(() =>
    orderedColumns.filter(c => visibleCols.includes(c.id) || c.id === "actions"),
  [orderedColumns, visibleCols]);

  const handleColDragStart = (colId) => { dragColRef.current = colId; };
  const handleColDragOver  = (e) => { e.preventDefault(); };
  const handleColDrop      = (targetId) => {
    const srcId = dragColRef.current;
    dragColRef.current = null;
    if (!srcId || srcId === targetId) return;
    const base = columnOrder || ALL_COLUMNS.map(c => c.id);
    const order = base.includes(srcId) ? [...base] : ALL_COLUMNS.map(c => c.id);
    const si = order.indexOf(srcId);
    const ti = order.indexOf(targetId);
    if (si === -1 || ti === -1) return;
    order.splice(si, 1);
    order.splice(ti, 0, srcId);
    setColumnOrder(order);
    try { localStorage.setItem("cc_columns_order", JSON.stringify(order)); } catch {
      // Ignore localStorage errors
    }
  };
  const from = ((page - 1) * PER_PAGE) + 1;
  const to   = Math.min(page * PER_PAGE, total);

  return (
    <div className="content">

      {/* Page header */}
      <div className="ph">
        <div>
          <div className="ph-title">
            CC{" "}
            <span className="text-muted text-[14px] font-normal">
              {total.toLocaleString()} {t("nav_cards")}
            </span>
            {freeTotal > 0 && (
              <span style={{ marginLeft: 8, fontSize: 12, color: "#4ade80", fontWeight: 400 }}>
                · {freeTotal.toLocaleString()} {t("status_free")}
              </span>
            )}
          </div>
        </div>
        <div className="ph-actions">
          <button onClick={() => setCompact(v => !v)} className={compact ? "btn btn-b btn-sm" : "btn btn-ghost btn-sm"}>
            {compact ? t("cards_view_normal") : t("cards_view_compact")}
          </button>
          <button onClick={() => setGroupByBank(v => !v)} className={groupByBank ? "btn btn-b btn-sm" : "btn btn-ghost btn-sm"}>
            {t("cc_group_by_bank")}
          </button>
          <div className="relative">
            <button onClick={() => setShowColPicker(v => !v)} className="btn btn-ghost btn-sm">{t("cc_columns")}</button>
            {showColPicker && (
              <>
                <div className="fixed inset-0 z-10" onClick={() => setShowColPicker(false)} />
                <ColumnPicker
                  visible={visibleCols}
                  allColumns={ALL_COLUMNS}
                  t={t}
                  onChange={(cols) => {
                    setVisibleCols(cols);
                    try { localStorage.setItem("cc_columns_visible", JSON.stringify(cols)); } catch {
                      // Ignore localStorage errors
                    }
                  }}
                  onClose={() => setShowColPicker(false)}
                />
              </>
            )}
          </div>
          <div className="flex gap-1.5">
            <button
              onClick={handleArchiveDead}
              className="btn btn-ghost btn-sm"
              title="Archive all dead cards on this page"
            ><Archive size={12} /> {t("cc_archive_dead")}</button>
            <button onClick={() => setShowImport(true)} className="btn btn-b" data-shortcut="new"><Upload size={12} /> {t("btn_import")}</button>
          </div>
        </div>
      </div>

      <CardFilters
        filter={filter}
        setFilter={setFilter}
        setPage={setPage}
        filterMeta={filterMeta}
        searchInput={searchInput}
        setSearchInput={setSearchInput}
        handleSearch={handleSearch}
        handleResetFilters={handleResetFilters}
        loading={loading}
        loadCards={loadCards}
        t={t}
      />

      {/* Expiring soon banner */}
      {activeTab === "expiring" && (
        <div style={{
          padding: "8px 14px", background: "rgba(234,179,8,0.08)",
          border: "1px solid rgba(234,179,8,0.15)", borderRadius: 8, marginBottom: 10,
          color: "#eab308", fontSize: 12,
        }}>
          {t("cards_expiring_banner")}
        </div>
      )}

      {/* Bulk action bar — fixed bottom */}
      {selected.size > 0 && (
        <div style={{
          position: "fixed", bottom: 24, left: "50%", transform: "translateX(-50%)",
          padding: "10px 18px", background: "var(--card)",
          border: "1px solid var(--accent-border)", borderRadius: 12,
          boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          display: "flex", alignItems: "center", gap: 10, zIndex: 100,
        }}>
          <span style={{ color: "var(--accent)", fontWeight: 600, fontSize: 12 }}>{selected.size} {t("selected")}</span>
          <div className="flex gap-1 flex-wrap">
            <button onClick={() => handleBulkStatus("free")} className="btn btn-g btn-sm">{t("cc_mark_free")}</button>
            <button onClick={() => handleBulkStatus("archive")} className="btn btn-ghost btn-sm">Archive</button>
            <button onClick={() => handleBulkStatus("dead")} className="btn btn-r btn-sm">{t("cc_mark_dead")}</button>
            {enrichProgress ? (
              <span className="text-[12px] text-muted" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                <RefreshCw size={12} className="spin" />
                {enrichProgress.done} / {enrichProgress.total}
              </span>
            ) : (
              <button onClick={handleBulkEnrich} className="btn btn-b btn-sm btn-icon" title="Enrich BIN data for selected cards">
                <Zap size={12} /> BIN Enrich
              </button>
            )}
            <button onClick={() => handleExport("txt")} className="btn btn-b btn-sm">{t("export_txt")}</button>
            <button onClick={() => handleExport("csv")} className="btn btn-b btn-sm">{t("export_csv")}</button>
            <button onClick={handleBulkDelete} className="btn btn-r btn-sm">{t("btn_delete")}</button>
          </div>
          <button
            onClick={() => setSelected(new Set())}
            style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 14 }}
          >✕</button>
        </div>
      )}

      {/* #41 — Table with sticky header */}
      {loading && cards.length === 0 ? (
        <div className="panel p-0 overflow-x-auto">
          <table className="tbl">
            <thead className="sticky top-0 z-[3] bg-card">
              <tr>
                <th style={{ width: 36, background: "var(--card)" }}></th>
                {visibleHeaders.map(c => (
                  <th key={c.id} className="bg-card">{t(c.label)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <SkeletonRows count={8} cols={visibleHeaders.length + 1} />
            </tbody>
          </table>
        </div>
      ) : cards.length === 0 ? (
        <div className="panel p-0">
          <EmptyState
            icon={<CreditCard size={38} />}
            title={t("cc_no_cards")}
            subtitle={t("cc_import_first")}
            action={<button onClick={() => setShowImport(true)} className="btn btn-b">{t("cc_import_first")}</button>}
          />
        </div>
      ) : (
        <div className="panel p-0 overflow-x-auto relative" >
          {/* #41 — inner scroll wrapper for sticky thead; virtual scroll when >200 cards */}
          <div
            ref={parentRef}
            className="flex-1 overflow-y-auto"
            style={useVirtualCards ? { minHeight: 0, height: 760, overflowY: "scroll" } : { minHeight: 0 }}
          >
            <table className="tbl relative">
              <thead className="sticky top-0 z-[3] bg-card">
                <tr>
                  {/* #48 — frozen checkbox column */}
                  <th style={{ width: 36, background: "var(--card)", position: "sticky", left: 0, zIndex: 4 }}>
                    <input
                      type="checkbox"
                      checked={allSelected}
                      ref={el => { if (el) el.indeterminate = someSelected; }}
                      onChange={toggleSelectAll}
                      className="accent-accent cursor-pointer"
                    />
                  </th>
                  {/* #46 — draggable column headers, #48 — first data col frozen */}
                  {visibleHeaders.map((c, i) => (
                    <th
                      key={c.id}
                      draggable={c.id !== "actions"}
                      onDragStart={() => handleColDragStart(c.id)}
                      onDragOver={handleColDragOver}
                      onDrop={() => handleColDrop(c.id)}
                      style={{
                        background: "var(--card)",
                        cursor: c.id !== "actions" ? "grab" : "default",
                        userSelect: "none",
                        ...(i === 0 && c.id !== "actions" ? {
                          position: "sticky", left: 36, zIndex: 4,
                          boxShadow: "4px 0 8px rgba(0,0,0,0.25)",
                        } : {}),
                      }}
                    >
                      <span className="flex items-center gap-1">
                        {c.id !== "actions" && (
                          <span style={{ color: "var(--muted)", fontSize: 9, opacity: 0.5, lineHeight: 1 }}>⠿</span>
                        )}
                        {t(c.label)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              {groupByBank ? renderRows() : <tbody>{renderRows()}</tbody>}
            </table>
          </div>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-2.5 text-[11px] text-muted">
          <span>{t("pag_showing")} {from}–{to} {t("pag_of")} {total}</span>
          <div className="flex gap-1">
            <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>{t("pag_prev")}</button>
            {buildPageNumbers(page, totalPages).map((p, i) =>
              p === "…" ? (
                <span key={i} style={{ padding: "0 4px", color: "var(--muted)", lineHeight: "28px" }}>…</span>
              ) : (
                <button
                  key={i}
                  onClick={() => setPage(p)}
                  className="btn btn-ghost btn-sm"
                  style={p === page ? { background: "var(--accent)", color: "var(--text)", border: "none" } : undefined}
                >
                  {p}
                </button>
              )
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>{t("pag_next")}</button>
          </div>
        </div>
      )}

      {/* Modals */}
      {showImport && (
        <ImportModal onClose={() => setShowImport(false)} onImported={() => { loadCards(); }} />
      )}

      {/* #61 — Side panel */}
      {sideCard && (
        <CardSidePanel
          card={sideCard}
          cards={cards}
          idx={sideCardIdx}
          revealed={revealed}
          onClose={() => setSideCard(null)}
          onNavigate={(c, i) => { setSideCard(c); setSideCardIdx(i); }}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
          onCopy={handleCopyToast}
        />
      )}

      {shopUsageCardId !== null && (
        <CardShopUsagePanel cardId={shopUsageCardId} onClose={() => setShopUsageCardId(null)} />
      )}
      {timelineCardId !== null && (
        <CardTimelinePanel cardId={timelineCardId} onClose={() => setTimelineCardId(null)} />
      )}
    </div>
  );
}
