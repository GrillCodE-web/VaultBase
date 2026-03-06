import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { LangProvider, useLang } from "./hooks/useLang.jsx";
import { ToastProvider } from "./hooks/useToast.js";
import { ConfirmProvider } from "./hooks/useConfirm.js";

// Pages
import Login      from "./pages/Login.jsx";
import Dashboard  from "./pages/Dashboard.jsx";
import Cards      from "./pages/Cards.jsx";
import Profiles   from "./pages/Profiles.jsx";
import Drops      from "./pages/Drops.jsx";
import Orders     from "./pages/Orders.jsx";
import Shops      from "./pages/Shops.jsx";
import Emails     from "./pages/Emails.jsx";
import Proxies    from "./pages/Proxies.jsx";
import Imap       from "./pages/Imap.jsx";
import ActivityLog from "./pages/ActivityLog.jsx";
import Settings   from "./pages/Settings.jsx";

// Icons
import {
  LayoutDashboard, CreditCard, Users, Package, ShoppingCart,
  Store, Mail, Shield, Inbox, Activity, Settings as SettingsIcon,
  Lock, ChevronLeft, Globe,
} from "lucide-react";

// ─── Route config ─────────────────────────────────────────────────────────

const ROUTES = [
  { id: "dashboard", label: "nav_dashboard", icon: LayoutDashboard, page: Dashboard  },
  { id: "cards",     label: "nav_cards",     icon: CreditCard,      page: Cards      },
  { id: "profiles",  label: "nav_profiles",  icon: Users,           page: Profiles   },
  { id: "drops",     label: "nav_drops",     icon: Package,         page: Drops      },
  { id: "orders",    label: "nav_orders",    icon: ShoppingCart,    page: Orders     },
  { id: "shops",     label: "nav_shops",     icon: Store,           page: Shops      },
  { id: "emails",    label: "nav_emails",    icon: Mail,            page: Emails     },
  { id: "proxies",   label: "nav_proxies",   icon: Shield,          page: Proxies    },
  { id: "imap",      label: "nav_imap",      icon: Inbox,           page: Imap       },
  { id: "activity",  label: "nav_activity",  icon: Activity,        page: ActivityLog },
  { id: "settings",  label: "nav_settings",  icon: SettingsIcon,    page: Settings   },
];

// ─── Sidebar ──────────────────────────────────────────────────────────────

function Sidebar({ activeId, onNavigate, collapsed, onToggleCollapse, onLock }) {
  const { t, lang, setLang } = useLang();

  return (
    <aside className={`flex flex-col h-screen bg-[#1a1d27] border-r border-[#2d3148]
                       transition-all duration-200 shrink-0
                       ${collapsed ? "w-[56px]" : "w-[220px]"}`}>

      {/* Logo */}
      <div className={`flex items-center gap-3 px-3 py-4 border-b border-[#2d3148]
                       ${collapsed ? "justify-center" : ""}`}>
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-[#a855f7] to-[#7c3aed]
                        flex items-center justify-center shrink-0">
          <CreditCard size={15} className="text-white" />
        </div>
        {!collapsed && (
          <span className="text-[#e2e8f0] font-bold text-sm tracking-wide">CC Manager</span>
        )}
      </div>

      {/* Nav */}
      <nav className="flex-1 py-2 overflow-y-auto overflow-x-hidden">
        {ROUTES.map(({ id, label, icon: Icon }) => {
          const active = activeId === id;
          return (
            <button
              key={id}
              onClick={() => onNavigate(id)}
              title={collapsed ? t(label) : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm
                          transition-colors duration-150 relative
                          ${collapsed ? "justify-center" : ""}
                          ${active
                            ? "text-[#e2e8f0] bg-[#21253a]"
                            : "text-[#94a3b8] hover:text-[#e2e8f0] hover:bg-[#21253a]"}`}
            >
              {active && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2
                                 w-0.5 h-5 bg-[#a855f7] rounded-r" />
              )}
              <Icon size={16} className={active ? "text-[#a855f7]" : ""} />
              {!collapsed && <span className="truncate">{t(label)}</span>}
            </button>
          );
        })}
      </nav>

      {/* Bottom controls */}
      <div className="border-t border-[#2d3148] p-2 flex flex-col gap-0.5">
        <button
          onClick={() => setLang(lang === "en" ? "ru" : "en")}
          title="Toggle language"
          className={`flex items-center gap-2 px-2 py-2 rounded-lg text-xs
                      text-[#94a3b8] hover:text-[#e2e8f0] hover:bg-[#21253a]
                      transition-colors ${collapsed ? "justify-center" : ""}`}
        >
          <Globe size={14} />
          {!collapsed && <span>{lang.toUpperCase()}</span>}
        </button>

        <button
          onClick={onToggleCollapse}
          title={collapsed ? "Expand" : t("sidebar_collapse")}
          className={`flex items-center gap-2 px-2 py-2 rounded-lg text-xs
                      text-[#94a3b8] hover:text-[#e2e8f0] hover:bg-[#21253a]
                      transition-colors ${collapsed ? "justify-center" : ""}`}
        >
          <ChevronLeft size={14} className={`transition-transform ${collapsed ? "rotate-180" : ""}`} />
          {!collapsed && <span>{t("sidebar_collapse")}</span>}
        </button>

        <button
          onClick={onLock}
          title={t("sidebar_lock")}
          className={`flex items-center gap-2 px-2 py-2 rounded-lg text-xs
                      text-[#94a3b8] hover:text-[#ef4444] hover:bg-[#21253a]
                      transition-colors ${collapsed ? "justify-center" : ""}`}
        >
          <Lock size={14} />
          {!collapsed && <span>{t("sidebar_lock")}</span>}
        </button>
      </div>
    </aside>
  );
}

// ─── Main App shell ───────────────────────────────────────────────────────

function AppShell({ onLock }) {
  const [activeId, setActiveId] = useState("dashboard");
  const [collapsed, setCollapsed] = useState(false);
  const ActivePage = ROUTES.find(r => r.id === activeId)?.page ?? Dashboard;

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-[#0f1117]">
      <Sidebar
        activeId={activeId}
        onNavigate={setActiveId}
        collapsed={collapsed}
        onToggleCollapse={() => setCollapsed(v => !v)}
        onLock={onLock}
      />
      <main className="flex-1 overflow-y-auto">
        <ActivePage />
      </main>
    </div>
  );
}

// ─── Root with auth gating ─────────────────────────────────────────────────

function Inner() {
  // "checking" | "locked" | "unlocked"
  const [authState, setAuthState] = useState("checking");

  useEffect(() => {
    // Check lock state on mount
    invoke("is_locked")
      .then(locked => setAuthState(locked ? "locked" : "unlocked"))
      .catch(() => setAuthState("locked"));

    // Listen for Tauri "app_locked" event (e.g. autolock timer)
    let unlisten;
    listen("app_locked", () => setAuthState("locked"))
      .then(fn => { unlisten = fn; })
      .catch(() => {});

    return () => { if (unlisten) unlisten(); };
  }, []);

  const handleUnlocked = () => setAuthState("unlocked");

  const handleLock = () => {
    invoke("lock").catch(() => {});
    setAuthState("locked");
  };

  if (authState === "checking") {
    return (
      <div className="w-screen h-screen bg-[#0f1117] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#a855f7] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (authState === "locked") {
    return <Login onUnlocked={handleUnlocked} />;
  }

  return <AppShell onLock={handleLock} />;
}

// ─── Export ───────────────────────────────────────────────────────────────

export default function App() {
  return (
    <LangProvider>
      <ToastProvider>
        <ConfirmProvider>
          <Inner />
        </ConfirmProvider>
      </ToastProvider>
    </LangProvider>
  );
}
