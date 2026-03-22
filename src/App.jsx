import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LangProvider, useLang } from "./hooks/useLang";
import { ToastProvider, useToast } from "./hooks/useToast";
import { ConfirmProvider } from "./hooks/useConfirm";

// Auth screens — loaded immediately (shown before app)
import Login    from "./pages/Login";
import Activate from "./pages/Activate";

// App pages — lazy loaded to improve startup time
const Dashboard   = lazy(() => import("./pages/Dashboard"));
const Cards       = lazy(() => import("./pages/Cards"));
const Profiles    = lazy(() => import("./pages/Profiles"));
const Drops       = lazy(() => import("./pages/Drops"));
const Orders      = lazy(() => import("./pages/Orders"));
const Catalog     = lazy(() => import("./pages/Catalog"));
const Shops       = lazy(() => import("./pages/Shops"));
const ProxyList   = lazy(() => import("./pages/Proxies"));
const Imap        = lazy(() => import("./pages/Imap"));
const ActivityLog = lazy(() => import("./pages/ActivityLog"));
const Settings    = lazy(() => import("./pages/Settings"));
const Updates     = lazy(() => import("./pages/Updates"));
const Onboarding  = lazy(() => import("./pages/Onboarding"));

import {
  LayoutDashboard, CreditCard, Users, ShoppingCart,
  Store, Shield, Inbox, ClipboardList, Settings as SettingsIcon,
  Lock, Globe, AlertTriangle, BookOpen,
  Search, X, Keyboard, Bell, ChevronLeft, ChevronRight,
  Sun, Moon,
} from "lucide-react";

// ─── Safe JSON parse ──────────────────────────────────────────
const safeParseJSON = (str, fallback) => {
  try { return str ? JSON.parse(str) : fallback; }
  catch { return fallback; }
};

// ─────────────────────────────────────────────────────────────
// View states:
// "checking" → spinner
// "activate" → no license → Activate.jsx
// "revoked"  → license revoked
// "auth"     → password required → Login.jsx
// "app"      → fully unlocked
// ─────────────────────────────────────────────────────────────



const PAGE_MAP = {
  dashboard:    Dashboard,
  cards:        Cards,
  profiles:     Profiles,
  drops:        Drops,
  orders:       Orders,
  catalog:      Catalog,
  shops:        Shops,
  proxies:      ProxyList,
  imap:         Imap,
  activity_log: ActivityLog,
  updates:      Updates,
  settings:     Settings,
  onboarding:   Onboarding,
};

// ─── Global Search ────────────────────────────────────────────

const TYPE_PAGE = { card: "cards", order: "orders", profile: "profiles", shop: "shops", email: "imap", proxy: "proxies" };

function GlobalSearch({ onClose, onNavigate }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);
  const timerRef = useRef(null);
  const { t } = useLang();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query.trim()) { setResults(null); return; }
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const r = await invoke("global_search", { query });
        setResults(r);
      } catch {
        // Ignore search errors - user can retry by typing
      }
      finally { setLoading(false); }
    }, 300);
    return () => clearTimeout(timerRef.current);
  }, [query]);

  const handleKey = (e) => {
    if (e.key === "Escape") onClose();
  };

  const sections = results
    ? [
        { key: "cards",    label: t("nav_cards"),    items: results.cards    ?? [] },
        { key: "orders",   label: t("nav_orders"),   items: results.orders   ?? [] },
        { key: "profiles", label: t("nav_profiles"), items: results.profiles ?? [] },
        { key: "shops",    label: t("nav_shops"),    items: results.shops    ?? [] },
        { key: "emails",   label: t("nav_imap"),     items: results.emails   ?? [] },
        { key: "proxies",  label: t("nav_proxies"),  items: results.proxies  ?? [] },
      ].filter((s) => s.items.length > 0)
    : [];

  const total = sections.reduce((acc, s) => acc + s.items.length, 0);

  return (
    <div className="search-overlay" onClick={onClose}>
      <div className="search-box-wrap" onClick={(e) => e.stopPropagation()}>
        {/* Input */}
        <div className="search-input-row">
          <Search size={16} style={{ color: "var(--muted)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKey}
            placeholder={t("app_search_placeholder")}
            className="search-main-input"
          />
          {loading && (
            <div style={{ width: 14, height: 14, borderRadius: "50%", border: "2px solid var(--accent)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite", flexShrink: 0 }} />
          )}
          <button onClick={onClose} className="bg-transparent border-none cursor-pointer p-0">
            <X size={15} className="text-muted" />
          </button>
        </div>

        {/* Results */}
        {sections.length > 0 ? (
          <div className="search-results">
            {sections.map((sec) => (
              <div key={sec.key}>
                <div className="search-section-label">{sec.label}</div>
                {sec.items.map((item, i) => (
                  <button
                    key={i}
                    onClick={() => { onNavigate(TYPE_PAGE[item._type] ?? sec.key); onClose(); }}
                    className="search-result-row"
                  >
                    <span className="search-result-type">{item._type}</span>
                    <span className="search-result-text">
                      {item.last4 ? `••••${item.last4}` : ""}
                      {item.order_number ?? ""}
                      {item.name ?? ""}
                      {item.city ? ` · ${item.city}` : ""}
                      {item.country ? `, ${item.country}` : ""}
                      {item.label ?? ""}
                      {item.host ?? ""}
                      {item.domain ?? ""}
                    </span>
                    {item.status && (
                      <span className="search-result-status">{item.status}</span>
                    )}
                  </button>
                ))}
              </div>
            ))}
          </div>
        ) : query.trim() && !loading ? (
          <div className="search-empty">{t("search_no_results").replace("{q}", query)}</div>
        ) : !query.trim() ? (
          <div className="search-empty text-[11px]" >{t("app_type_to_search")}</div>
        ) : null}

        {/* Footer */}
        <div className="search-footer">
          <span style={{ color: "var(--muted)", fontSize: 10 }}>{total > 0 ? t("search_result_count").replace("{n}", total) : ""}</span>
          <span style={{ color: "var(--muted)", fontSize: 10, marginLeft: "auto" }}>{t("shortcut_close")}</span>
        </div>
      </div>
    </div>
  );
}

// ─── Spinner ─────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 16 }}>
        <div style={{ width: 40, height: 40, borderRadius: "50%", border: "2px solid var(--accent)", borderTopColor: "transparent", animation: "spin 0.8s linear infinite" }} />
        <span style={{ fontSize: 13, color: "var(--muted)" }}>Loading…</span>
      </div>
    </div>
  );
}

// ─── Revoked Screen ───────────────────────────────────────────

function RevokedScreen() {
  const { t } = useLang();
  return (
    <div className="min-h-screen flex items-center justify-center bg-bg">
      <div style={{ width: "100%", maxWidth: 360, backgroundColor: "var(--card)", border: "1px solid #3a1c1c", borderRadius: 14, padding: 32, textAlign: "center" }}>
        <div style={{ width: 56, height: 56, borderRadius: 12, backgroundColor: "rgba(239,68,68,0.12)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 20px" }}>
          <AlertTriangle size={28} style={{ color: "#ef4444" }} />
        </div>
        <h1 style={{ fontSize: 16, fontWeight: 600, color: "#fff", marginBottom: 8 }}>
          {t("license_revoked_title") || "License Revoked"}
        </h1>
        <p style={{ fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 }}>
          {t("license_revoked_body") || "Your license has been revoked. Please contact your administrator."}
        </p>
      </div>
    </div>
  );
}

// ─── Keyboard Shortcuts Popup ─────────────────────────────────

function ShortcutsPopup({ onClose }) {
  const { t } = useLang();
  const SHORTCUTS = [
    { keys: "Alt+1 … Alt+9", desc: t("shortcut_nav_pages") },
    { keys: "Alt+0",          desc: t("nav_settings") },
    { keys: "⌘K / Ctrl+K",   desc: t("shortcut_global_search") },
    { keys: "Esc",            desc: t("shortcut_close") },
  ];
  return (
    <div style={{ position: "fixed", inset: 0, zIndex: 50, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(0,0,0,.6)" }} onClick={onClose}>
      <div
        style={{ width: 320, backgroundColor: "var(--card)", border: "1px solid var(--border)", borderRadius: 14, overflow: "hidden" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderBottom: "1px solid var(--border)" }}>
          <div className="flex items-center gap-2">
            <Keyboard size={15} className="text-muted" />
            <span style={{ fontSize: 13, fontWeight: 600, color: "#fff" }}>{t("shortcuts_title")}</span>
          </div>
          <button onClick={onClose} className="bg-transparent border-none cursor-pointer p-0"><X size={15} className="text-muted" /></button>
        </div>
        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
          {SHORTCUTS.map(({ keys, desc }) => (
            <div key={keys} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 16 }}>
              <span className="text-[12px] text-gray-t">{desc}</span>
              <kbd style={{ background: "var(--border)", color: "var(--text)", borderRadius: 4, padding: "2px 7px", fontSize: 10, fontFamily: "JetBrains Mono,monospace", whiteSpace: "nowrap" }}>{keys}</kbd>
            </div>
          ))}
        </div>
        <div style={{ padding: "10px 20px", textAlign: "center", fontSize: 10, color: "var(--muted)", borderTop: "1px solid var(--border)" }}>
          {t("shortcuts_hint_prefix")} <kbd style={{ background: "var(--border)", borderRadius: 3, padding: "1px 5px" }}>?</kbd> {t("shortcuts_hint_suffix")}
        </div>
      </div>
    </div>
  );
}

// ─── Main Shell ───────────────────────────────────────────────

function MainShell({ offlineMode, setOfflineMode }) {
  const { t, lang, setLang } = useLang();
  const { toast, info: toastInfo } = useToast();

  const TOPBAR_TABS = {
    cards:        [{ key: "list", label: t("nav_cards") }, { key: "expiring", label: t("section_expiring") }],
    orders:       [{ key: "list", label: t("orders") }, { key: "pending", label: t("pending") }, { key: "delivered", label: t("delivered") }],
    profiles:     [{ key: "list", label: t("profiles") }, { key: "nodrop", label: t("filter_no_drop") }],
    catalog:      [{ key: "items", label: "Items" }, { key: "shops", label: "Shops" }],
    shops:        [{ key: "list", label: t("shops") }],
    proxies:      [{ key: "list", label: t("proxy_manager") }],
    imap:         [{ key: "accounts", label: t("nav_imap") }, { key: "messages", label: t("nav_imap") }],
    activity_log: [{ key: "list", label: t("log_title") }],
    updates:      [{ key: "list", label: t("updates_title") }],
    dashboard:    [],
    settings:     [],
    drops:        [],
  };
  const [theme, setTheme] = useState(() => localStorage.getItem('cc_theme') || 'dark');
  const [page, setPage] = useState("dashboard");
  const [pageProps, setPageProps] = useState({});
  const [activeTab, setActiveTab] = useState("list");
  const [badges, setBadges] = useState({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(() => {
    try { return localStorage.getItem("cc_sidebar_expanded") === "1"; } catch { return false; }
  });
  const [showOnboarding, setShowOnboarding] = useState(false);
  // #27 — drag-to-reorder sidebar
  const [navOrder, setNavOrder] = useState(() =>
    safeParseJSON(localStorage.getItem("cc_nav_order"), null)
  );
  const dragNavRef = useRef(null);
  const prevImapRef = useRef(0);

  // Navigate from Dashboard quick actions / heatmap click
  const handleNavigate = useCallback((targetPage, props = {}) => {
    setPage(targetPage);
    setPageProps(props);
    setActiveTab("list");
  }, []);

  // Navigate from sidebar / keyboard shortcuts
  const handlePageChange = useCallback((p) => {
    setPage(p);
    setPageProps({});
    setActiveTab("list");
  }, []);

  const loadBadges = useCallback(async () => {
    try {
      const b = await invoke("get_sidebar_badges");
      setBadges(b);
    } catch {
      // Silently fail - badges will retry on next interval
    }
  }, []);

  useEffect(() => {
    loadBadges();
    const id = setInterval(loadBadges, 30_000);
    return () => clearInterval(id);
  }, [loadBadges]);

  useEffect(() => {
    const done = localStorage.getItem('onboarding_done');
    if (!done) {
      invoke("get_cards", { page: 1, perPage: 1 }).then(r => {
        if (r.total === 0) setShowOnboarding(true);
      }).catch(() => {});
    }
  }, []);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('cc_theme', theme);
  }, [theme]);

  // L: IMAP toast when new messages arrive
  useEffect(() => {
    const unlisten = listen("badge_update", (e) => {
      const b = e.payload;
      if (b) {
        const prev = prevImapRef.current;
        const next = b.unread_imap ?? 0;
        if (next > prev) {
          toastInfo(`${next - prev} new IMAP message${next - prev > 1 ? "s" : ""}`);
        }
        prevImapRef.current = next;
        setBadges(b);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // J: Server online/offline events
  useEffect(() => {
    const unlisten = Promise.all([
      listen("server_online",  () => { setOfflineMode(false); toast("Connection restored", "success"); }),
      listen("server_offline", () => { setOfflineMode(true);  toast("Connection lost — Sync, Risk check, BIN lookup unavailable", "error"); }),
    ]);
    return () => { unlisten.then((fns) => fns.forEach((fn) => fn())); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setOfflineMode]);

  // Global hotkeys
  useEffect(() => {
    const ALT_PAGES = ["dashboard","cards","profiles","orders","shops","proxies","imap","activity_log","updates","settings"];
    const handleKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
        return;
      }
      if (e.key === "Escape") { setSearchOpen(false); setShowShortcuts(false); return; }
      if (e.key === "?" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = document.activeElement?.tagName;
        if (tag !== "INPUT" && tag !== "TEXTAREA") {
          setShowShortcuts((v) => !v);
          return;
        }
      }
      if (e.altKey && !e.metaKey && !e.ctrlKey) {
        const idx = parseInt(e.key, 10);
        if (!isNaN(idx) && idx >= 0 && idx <= 9) {
          e.preventDefault();
          const target = ALT_PAGES[idx === 0 ? 9 : idx - 1];
          if (target) handlePageChange(target);
        }
      }
      const isInInput = () => {
        const el = document.activeElement;
        return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.contentEditable === 'true');
      };
      if (!isInInput() && !e.altKey && !e.ctrlKey && !e.metaKey) {
        if (e.key === 'f' || e.key === '/') {
          e.preventDefault();
          document.querySelector('input[type="search"], input[placeholder*="earch"], input[placeholder*="EARCH"]')?.focus();
        } else if (e.key === 'r') {
          e.preventDefault();
          document.querySelector('[data-shortcut="refresh"]')?.click();
        } else if (e.key === 'n') {
          e.preventDefault();
          document.querySelector('[data-shortcut="new"]')?.click();
        }
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLock = async () => {
    try {
      await invoke("lock");
    } catch {
      // Lock command failed - user can retry manually
    }
  };

  const PageComponent = PAGE_MAP[page] || Dashboard;

  const NAV_DEFS = [
    { key: "dashboard",    icon: LayoutDashboard, page: "dashboard",    label: t("nav_dashboard"),    badgeKey: null },
    { key: "updates",      icon: Bell,            page: "updates",      label: t("nav_updates"),      badgeKey: null },
    { key: "cards",        icon: CreditCard,      page: "cards",        label: "CC",           badgeKey: "expiring_cards",     badgeColor: "y" },
    { key: "profiles",     icon: Users,           page: "profiles",     label: t("nav_profiles"),     badgeKey: "no_drop_profiles",   badgeColor: "y" },
    { key: "orders",       icon: ShoppingCart,    page: "orders",       label: t("nav_orders"),       badgeKey: "pending_orders",     badgeColor: "y" },
    { key: "catalog",      icon: BookOpen,        page: "catalog",      label: "Catalog",             badgeKey: null },
    { key: "shops",        icon: Store,           page: "shops",        label: t("nav_shops"),        badgeKey: null },
    { key: "proxies",      icon: Shield,          page: "proxies",      label: t("nav_proxies"),        badgeKey: null },
    { key: "imap",         icon: Inbox,           page: "imap",         label: t("nav_imap"),         badgeKey: "unread_imap" },
    { key: "activity_log", icon: ClipboardList,   page: "activity_log", label: t("nav_activity_log"), badgeKey: null },
  ];

  return (
    <div style={{ display: "flex", width: "100%", height: "100vh", overflow: "hidden", background: "var(--bg)" }}>
      <a
        href="#main-content"
        style={{
          position: "absolute",
          left: "-9999px",
          zIndex: 999,
          padding: "8px 16px",
          background: "var(--accent)",
          color: "white",
          textDecoration: "none",
          borderRadius: "4px",
          fontSize: "14px",
          fontWeight: 500,
        }}
        onFocus={(e) => {
          e.target.style.left = "16px";
          e.target.style.top = "16px";
        }}
        onBlur={(e) => {
          e.target.style.left = "-9999px";
        }}
      >
        Skip to main content
      </a>
      {showOnboarding && (
        <div style={{ position: "fixed", inset: 0, zIndex: 200, background: "var(--bg)", overflowY: "auto" }}>
          <Suspense fallback={<div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh" }}><div style={{ width: 20, height: 20, borderRadius: "50%", border: "2px solid var(--border)", borderTopColor: "var(--accent)", animation: "spin 0.8s linear infinite" }} /></div>}>
            <Onboarding
              onComplete={() => {
                setShowOnboarding(false);
                localStorage.setItem('onboarding_done', '1');
              }}
              onNavigate={(p) => {
                setShowOnboarding(false);
                localStorage.setItem('onboarding_done', '1');
                handlePageChange(p);
              }}
            />
          </Suspense>
        </div>
      )}
      {searchOpen && (
        <GlobalSearch
          onClose={() => setSearchOpen(false)}
          onNavigate={(p) => handlePageChange(p)}
        />
      )}
      {showShortcuts && <ShortcutsPopup onClose={() => setShowShortcuts(false)} />}

      {/* ── Sidebar ── */}
      <div className={`sidebar${sidebarExpanded ? " expanded" : ""}`}>
        <div className="sidebar-logo">
          CC
          {sidebarExpanded && <span style={{ fontFamily: "DM Sans", fontWeight: 600, fontSize: 13 }}>Manager</span>}
        </div>

        {/* #27 — sorted nav with drag-to-reorder */}
        {(navOrder
          ? [...NAV_DEFS].sort((a, b) => {
              const ia = navOrder.indexOf(a.key);
              const ib = navOrder.indexOf(b.key);
              if (ia === -1 && ib === -1) return 0;
              if (ia === -1) return 1;
              if (ib === -1) return -1;
              return ia - ib;
            })
          : NAV_DEFS
        ).map(({ key, icon: Icon, page: p, label, badgeKey, badgeColor }) => {
          const active = page === p;
          const count = badgeKey ? (badges[badgeKey] ?? 0) : 0;
          const DIVIDERS_AFTER = new Set(["updates", "orders", "imap"]);
          return (
            <React.Fragment key={key}>
            <button
              className={`sbi${active ? " active" : ""}`}
              onClick={() => handlePageChange(p)}
              draggable
              onDragStart={() => { dragNavRef.current = key; }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => {
                const src = dragNavRef.current;
                dragNavRef.current = null;
                if (!src || src === key) return;
                const base = navOrder || NAV_DEFS.map(n => n.key);
                const order = [...base];
                const si = order.indexOf(src);
                const ti = order.indexOf(key);
                if (si === -1 || ti === -1) return;
                order.splice(si, 1);
                order.splice(ti, 0, src);
                setNavOrder(order);
                try { localStorage.setItem("cc_nav_order", JSON.stringify(order)); } catch {
                  // localStorage may be unavailable - order will reset on reload
                }
              }}
            >
              <Icon size={16} />
              <span className="sbi-tip">{label}</span>
              <span className="sbi-label">{label}</span>
              {count > 0 && (
                <span className={`sbi-badge${badgeColor ? ` ${badgeColor}` : ""}`}>
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </button>
            {DIVIDERS_AFTER.has(key) && <div className="sidebar-divider" />}
            </React.Fragment>
          );
        })}

        <div className="sidebar-spacer" />

        {/* Search */}
        <button className="sbi" onClick={() => setSearchOpen(true)}>
          <Search size={16} />
          <span className="sbi-tip">Search ⌘K</span>
          <span className="sbi-label">Search</span>
        </button>

        {/* Settings */}
        <button className={`sbi${page === "settings" ? " active" : ""}`} onClick={() => handlePageChange("settings")}>
          <SettingsIcon size={16} />
          <span className="sbi-tip">{t("nav_settings")}</span>
          <span className="sbi-label">{t("nav_settings")}</span>
        </button>

        {/* Lock */}
        <button className="sbi" onClick={handleLock}>
          <Lock size={16} />
          <span className="sbi-tip">{t("sidebar_lock") || "Lock"}</span>
          <span className="sbi-label">{t("sidebar_lock") || "Lock"}</span>
        </button>

        {/* Lang */}
        <button className="sbi" onClick={() => setLang(lang === "en" ? "ru" : "en")}>
          <Globe size={16} />
          <span className="sbi-tip">Language: {lang.toUpperCase()}</span>
          <span className="sbi-label">Lang: {lang.toUpperCase()}</span>
        </button>

        {/* Theme toggle */}
        <button
          className="sbi"
          onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
          title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          <span className="sbi-tip">{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
          <span className="sbi-label">{theme === 'dark' ? 'Light' : 'Dark'}</span>
        </button>

        {/* Expand/Collapse toggle */}
        <button
          className="sbi"
          onClick={() => {
            const next = !sidebarExpanded;
            setSidebarExpanded(next);
            try { localStorage.setItem("cc_sidebar_expanded", next ? "1" : "0"); } catch {
              // localStorage may be unavailable
            }
          }}
          title={sidebarExpanded ? t("sidebar_collapse") : t("sidebar_expand")}
        >
          {sidebarExpanded ? <ChevronLeft size={14} /> : <ChevronRight size={14} />}
          <span className="sbi-tip">{sidebarExpanded ? t("sidebar_collapse") : t("sidebar_expand")}</span>
          <span className="sbi-label">{sidebarExpanded ? t("sidebar_collapse") : ""}</span>
        </button>

        {/* Offline */}
        {offlineMode && <div className="offline-pill" title="Risk check, Sync, BIN lookup unavailable">⚠ Off</div>}
      </div>

      {/* ── Main ── */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
        {/* Topbar tabs */}
        {TOPBAR_TABS[page]?.length > 0 && (
          <div className="topbar">
            {TOPBAR_TABS[page].map(tab => {
              const active = activeTab === tab.key;
              const badgeNum =
                page === "orders"   && tab.key === "pending"   ? badges.pending_orders :
                page === "cards"    && tab.key === "expiring"  ? badges.expiring_cards :
                page === "profiles" && tab.key === "nodrop"    ? badges.no_drop_profiles :
                page === "imap"     && tab.key === "messages"  ? badges.unread_imap :
                0;
              const isYellow = page === "cards" || page === "profiles";
              return (
                <button
                  key={tab.key}
                  className={`tab${active ? " active" : ""}`}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                  {badgeNum > 0 && (
                    <span className={`tab-badge${isYellow ? " y" : ""}`}>
                      {badgeNum > 99 ? "99+" : badgeNum}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        <main id="main-content" style={{ flex: 1, overflowY: "auto" }}>
          <Suspense fallback={
            <div className="flex items-center justify-center flex-1">
              <div style={{ width:20, height:20, borderRadius:"50%", border:"2px solid var(--border)", borderTopColor:"var(--accent)", animation:"spin 0.8s linear infinite" }} />
            </div>
          }>
            <PageComponent key={page} onNavigate={handleNavigate} activeTab={activeTab} {...pageProps} />
          </Suspense>
        </main>
      </div>
    </div>
  );
}

// ─── App inner (auth state machine) ─────────────────────────

function AppInner() {
  const [view, setView] = useState("checking");
  const [offlineMode, setOfflineMode] = useState(false);

  useEffect(() => {
    const unlisten = Promise.all([
      listen("show_activate",   () => setView("activate")),
      listen("show_auth",       (e) => {
        if (e?.payload?.offline) setOfflineMode(true);
        setView("auth");
      }),
      listen("license_revoked", () => setView("revoked")),
      listen("app_locked",      () => setView("auth")),
    ]);

    // Fallback if no event arrives within 3s
    const timer = setTimeout(() => {
      setView((cur) => {
        if (cur !== "checking") return cur;
        invoke("get_license_status")
          .then((status) => {
            if (status === "not_activated") { setView("activate"); return; }
            if (status === "revoked")       { setView("revoked");  return; }
            if (status === "offline") { setOfflineMode(true); }
            setView("auth");
          })
          .catch(() => {
            // Failed to get license status - default to auth screen
            setView("auth");
          });
        return "checking";
      });
    }, 3000);

    return () => {
      unlisten.then((fns) => fns.forEach((fn) => fn()));
      clearTimeout(timer);
    };
  }, []);

  const handleUnlocked = async () => {
    // C: apply always_on_top from saved config
    try {
      const aot = await invoke("get_config", { key: "always_on_top" });
      if (aot === "1") await getCurrentWindow().setAlwaysOnTop(true);
    } catch {
      // Config read failed - continue without always_on_top
    }
    setView("app");
    // Auto-seed catalog on first run (background, silent)
    seedCatalogIfEmpty();
  };

  // Seeds built-in catalog data if tables are empty (runs once after unlock)
  const seedCatalogIfEmpty = async () => {
    try {
      const stats = await invoke("get_catalog_stats");
      if (stats.items > 0 || stats.shops > 0) return; // already seeded
      // Import items
      const itemsRes = await fetch("/catalog_items.json");
      if (itemsRes.ok) {
        const items = await itemsRes.json();
        const BATCH = 300;
        for (let i = 0; i < items.length; i += BATCH) {
          await invoke("import_catalog_items", { items: items.slice(i, i + BATCH) });
        }
      }
      // Import shops
      const shopsRes = await fetch("/catalog_shops.json");
      if (shopsRes.ok) {
        const shops = await shopsRes.json();
        const BATCH = 300;
        for (let i = 0; i < shops.length; i += BATCH) {
          await invoke("import_catalog_shops", { shops: shops.slice(i, i + BATCH) });
        }
      }
    } catch {
      // Silent — catalog is optional
    }
  };

  if (view === "checking") return <Spinner />;
  if (view === "activate") return <Activate onActivated={() => setView("auth")} />;
  if (view === "revoked")  return <RevokedScreen />;
  if (view === "auth")     return <Login onUnlocked={handleUnlocked} />;

  return <MainShell offlineMode={offlineMode} setOfflineMode={setOfflineMode} />;
}

export default function App() {
  return (
    <LangProvider>
      <ToastProvider>
        <ConfirmProvider>
          <AppInner />
        </ConfirmProvider>
      </ToastProvider>
    </LangProvider>
  );
}
