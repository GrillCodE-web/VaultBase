import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LangProvider, useLang } from "./hooks/useLang";
import { ToastProvider } from "./hooks/useToast";
import { ConfirmProvider } from "./hooks/useConfirm";

import Login    from "./pages/Login";
import Activate from "./pages/Activate";

import Dashboard   from "./pages/Dashboard";
import Cards       from "./pages/Cards";
import Profiles    from "./pages/Profiles";
import Drops       from "./pages/Drops";
import Orders      from "./pages/Orders";
import Shops       from "./pages/Shops";
import EmailPool   from "./pages/EmailPool";
import ProxyList   from "./pages/ProxyList";
import Imap        from "./pages/Imap";
import ActivityLog from "./pages/ActivityLog";
import Settings    from "./pages/Settings";

import {
  LayoutDashboard, CreditCard, Users, MapPin, ShoppingCart,
  Store, Mail, Shield, Inbox, ClipboardList, Settings as SettingsIcon,
  ChevronLeft, ChevronRight, Lock, Globe, AlertTriangle, Wifi, WifiOff,
} from "lucide-react";

// ─────────────────────────────────────────────────────────────
// View states:
// "checking" → spinner
// "activate" → no license → Activate.jsx
// "revoked"  → license revoked
// "auth"     → password required → Login.jsx
// "app"      → fully unlocked
// ─────────────────────────────────────────────────────────────

const NAV_ITEMS = [
  { key: "dashboard",    icon: LayoutDashboard, page: "dashboard",    badgeKey: null },
  { key: "cards",        icon: CreditCard,      page: "cards",        badgeKey: "expiring_cards" },
  { key: "profiles",     icon: Users,           page: "profiles",     badgeKey: "no_drop_profiles" },
  { key: "drops",        icon: MapPin,          page: "drops",        badgeKey: null },
  { key: "orders",       icon: ShoppingCart,    page: "orders",       badgeKey: "pending_orders" },
  { key: "shops",        icon: Store,           page: "shops",        badgeKey: null },
  { key: "emails",       icon: Mail,            page: "emails",       badgeKey: "clean_emails" },
  { key: "proxies",      icon: Shield,          page: "proxies",      badgeKey: null },
  { key: "imap",         icon: Inbox,           page: "imap",         badgeKey: "unread_imap" },
  { key: "activity_log", icon: ClipboardList,   page: "activity_log", badgeKey: null },
  { key: "settings",     icon: SettingsIcon,    page: "settings",     badgeKey: null },
];

const PAGE_MAP = {
  dashboard:    Dashboard,
  cards:        Cards,
  profiles:     Profiles,
  drops:        Drops,
  orders:       Orders,
  shops:        Shops,
  emails:       EmailPool,
  proxies:      ProxyList,
  imap:         Imap,
  activity_log: ActivityLog,
  settings:     Settings,
};

// ─── Badge ────────────────────────────────────────────────────

function Badge({ count, warn }) {
  if (!count) return null;
  return (
    <span
      className="text-xs font-bold rounded-full px-1.5 py-0.5 leading-none min-w-[18px] text-center inline-block"
      style={{
        backgroundColor: warn ? "rgba(234,179,8,0.2)" : "rgba(59,130,246,0.2)",
        color: warn ? "#eab308" : "#3b82f6",
        fontSize: 10,
      }}
    >
      {count > 99 ? "99+" : count}
    </span>
  );
}

// ─── Spinner ─────────────────────────────────────────────────

function Spinner() {
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#0f1117" }}>
      <div className="flex flex-col items-center gap-4">
        <div
          className="w-10 h-10 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: "#3b82f6", borderTopColor: "transparent" }}
        />
        <span className="text-sm" style={{ color: "#6b7280" }}>Loading…</span>
      </div>
    </div>
  );
}

// ─── Revoked Screen ───────────────────────────────────────────

function RevokedScreen() {
  const { t } = useLang();
  return (
    <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "#0f1117" }}>
      <div
        className="w-full max-w-sm rounded-2xl p-8 text-center shadow-2xl"
        style={{ backgroundColor: "#1a1d27", border: "1px solid #3a1c1c" }}
      >
        <div
          className="w-14 h-14 rounded-xl flex items-center justify-center mx-auto mb-5"
          style={{ backgroundColor: "rgba(239,68,68,0.12)" }}
        >
          <AlertTriangle size={28} style={{ color: "#ef4444" }} />
        </div>
        <h1 className="text-lg font-semibold text-white mb-2">
          {t("license_revoked_title") || "License Revoked"}
        </h1>
        <p className="text-sm leading-relaxed" style={{ color: "#9ca3af" }}>
          {t("license_revoked_body") || "Your license has been revoked. Please contact your administrator."}
        </p>
      </div>
    </div>
  );
}

// ─── Main Shell ───────────────────────────────────────────────

function MainShell({ offlineMode }) {
  const { t, lang, setLang } = useLang();
  const [page, setPage] = useState("dashboard");
  const [pageProps, setPageProps] = useState({});
  const [collapsed, setCollapsed] = useState(false);
  const [badges, setBadges] = useState({});

  // Navigate from Dashboard quick actions / heatmap click
  const handleNavigate = useCallback((targetPage, props = {}) => {
    setPage(targetPage);
    setPageProps(props);
  }, []);

  const loadBadges = useCallback(async () => {
    try {
      const b = await invoke("get_sidebar_badges");
      setBadges(b);
    } catch (_) {}
  }, []);

  useEffect(() => {
    loadBadges();
    const id = setInterval(loadBadges, 30_000);
    return () => clearInterval(id);
  }, [loadBadges]);

  const handleLock = async () => {
    try { await invoke("lock"); } catch (_) {}
  };

  const PageComponent = PAGE_MAP[page] || Dashboard;

  return (
    <div className="flex min-h-screen" style={{ backgroundColor: "#0f1117" }}>
      {/* ── Sidebar ── */}
      <aside
        className="flex flex-col transition-all duration-200 flex-shrink-0"
        style={{
          width: collapsed ? 56 : 220,
          backgroundColor: "#1a1d27",
          borderRight: "1px solid #2a2d3a",
        }}
      >
        {/* Logo */}
        <div
          className="flex items-center gap-2 px-3 py-4"
          style={{ borderBottom: "1px solid #2a2d3a", minHeight: 56 }}
        >
          <div
            className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ backgroundColor: "#3b82f6" }}
          >
            <CreditCard size={14} color="#fff" />
          </div>
          {!collapsed && (
            <span className="font-semibold text-sm text-white truncate">CC Manager</span>
          )}
        </div>

        {/* Nav */}
        <nav className="flex-1 py-2 overflow-y-auto">
          {NAV_ITEMS.map(({ key, icon: Icon, page: p, badgeKey }) => {
            const active = page === p;
            const badgeCount = badgeKey ? (badges[badgeKey] ?? 0) : 0;
            const warnBadge = ["expiring_cards", "no_drop_profiles"].includes(badgeKey);

            return (
              <button
                key={key}
                onClick={() => { setPage(p); setPageProps({}); }}
                className="w-full flex items-center gap-3 px-3 py-2 my-0.5 rounded-lg transition-colors text-left"
                style={{
                  color: active ? "#ffffff" : "#9ca3af",
                  backgroundColor: active ? "rgba(59,130,246,0.15)" : "transparent",
                }}
                title={collapsed ? (t(key) || key) : undefined}
              >
                <Icon size={17} className="flex-shrink-0" />
                {!collapsed && (
                  <>
                    <span className="text-sm truncate flex-1">{t(key) || key}</span>
                    {badgeCount > 0 && <Badge count={badgeCount} warn={warnBadge} />}
                  </>
                )}
                {collapsed && badgeCount > 0 && (
                  <span
                    className="absolute -top-1 -right-1 w-2 h-2 rounded-full"
                    style={{ backgroundColor: warnBadge ? "#eab308" : "#3b82f6" }}
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Bottom controls */}
        <div style={{ borderTop: "1px solid #2a2d3a" }} className="p-2 flex flex-col gap-1">
          {/* Sync badge */}
          {(badges.unsynced_footprints ?? 0) > 0 && (
            <div
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
              style={{ backgroundColor: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.15)" }}
            >
              <Wifi size={12} style={{ color: "#3b82f6", flexShrink: 0 }} />
              {!collapsed && (
                <span className="text-xs" style={{ color: "#3b82f6" }}>
                  {badges.unsynced_footprints} unsynced
                </span>
              )}
            </div>
          )}

          {/* Offline badge */}
          {offlineMode && (
            <div
              className="flex items-center gap-2 px-2 py-1.5 rounded-lg"
              style={{ backgroundColor: "rgba(234,179,8,0.1)" }}
            >
              <WifiOff size={13} style={{ color: "#eab308", flexShrink: 0 }} />
              {!collapsed && (
                <span className="text-xs" style={{ color: "#eab308" }}>
                  {t("offline_mode") || "Offline"}
                </span>
              )}
            </div>
          )}

          {/* Lang toggle */}
          <button
            onClick={() => setLang(lang === "en" ? "ru" : "en")}
            className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg transition-colors"
            style={{ color: "#6b7280" }}
            title={collapsed ? "Language" : undefined}
          >
            <Globe size={15} className="flex-shrink-0" />
            {!collapsed && <span className="text-xs">{lang === "en" ? "EN" : "RU"}</span>}
          </button>

          {/* Lock */}
          <button
            onClick={handleLock}
            className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg transition-colors"
            style={{ color: "#6b7280" }}
            title={collapsed ? (t("lock") || "Lock") : undefined}
          >
            <Lock size={15} className="flex-shrink-0" />
            {!collapsed && <span className="text-xs">{t("lock") || "Lock"}</span>}
          </button>

          {/* Collapse toggle */}
          <button
            onClick={() => setCollapsed((c) => !c)}
            className="w-full flex items-center gap-3 px-2 py-1.5 rounded-lg transition-colors"
            style={{ color: "#6b7280" }}
          >
            {collapsed ? (
              <ChevronRight size={15} />
            ) : (
              <>
                <ChevronLeft size={15} />
                <span className="text-xs">{t("collapse") || "Collapse"}</span>
              </>
            )}
          </button>
        </div>
      </aside>

      {/* ── Main content ── */}
      <main className="flex-1 overflow-auto">
        <PageComponent onNavigate={handleNavigate} {...pageProps} />
      </main>
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
          .catch(() => setView("auth"));
        return "checking";
      });
    }, 3000);

    return () => {
      unlisten.then((fns) => fns.forEach((fn) => fn()));
      clearTimeout(timer);
    };
  }, []);

  if (view === "checking") return <Spinner />;
  if (view === "activate") return <Activate onActivated={() => setView("auth")} />;
  if (view === "revoked")  return <RevokedScreen />;
  if (view === "auth")     return <Login onUnlocked={() => setView("app")} />;

  return <MainShell offlineMode={offlineMode} />;
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
