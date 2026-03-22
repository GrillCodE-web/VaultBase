import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import { AlertTriangle, ChevronRight, RefreshCw, Download, FileDown } from "lucide-react";
import { useLang } from "../hooks/useLang";
import { SkeletonRows } from "../components/SkeletonRow.jsx";
import { useToast } from "../hooks/useToast";
import { formatCurrency, formatNumber } from "../utils/formatting";
import {
  CHART_COLORS,
  HEATMAP_COLORS,
  getHeatmapColor,
  getDeliveryRateColor,
  getExpiryColor,
} from "../constants/colors";

// ─── Period config ───────────────────────────────────────────

const PERIODS = [
  { key: "today",  labelKey: "period_today" },
  { key: "7d",     labelKey: "period_7d" },
  { key: "30d",    labelKey: "period_30d" },
  { key: "all",    labelKey: "period_all" },
  { key: "custom", labelKey: "period_custom" },
];

// ─── Revenue Chart tooltip ───────────────────────────────────

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ backgroundColor: "var(--card)", border: "1px solid var(--border-hi)", borderRadius: 8, padding: "8px 12px", fontSize: 11 }}>
      <div style={{ fontWeight: 600, color: "var(--text)", marginBottom: 4 }}>{label}</div>
      <div className="text-blue-t">Revenue: {formatCurrency(payload[0]?.value ?? 0)}</div>
      <div className="text-green-t">Profit: {formatCurrency(payload[1]?.value ?? 0)}</div>
    </div>
  );
}

function RevenueChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 240, gap: 8, color: "var(--muted)" }}>
        <AlertTriangle size={20} style={{ color: "var(--border-hi)", opacity: 0.7 }} />
        <span style={{ fontSize: 12 }}>No orders in this period</span>
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="gradRevenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={CHART_COLORS.revenue} stopOpacity={0.25} />
            <stop offset="95%" stopColor={CHART_COLORS.revenue} stopOpacity={0} />
          </linearGradient>
          <linearGradient id="gradProfit" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%"  stopColor={CHART_COLORS.profit} stopOpacity={0.2} />
            <stop offset="95%" stopColor={CHART_COLORS.profit} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
        <XAxis dataKey="date" tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} axisLine={false} />
        <YAxis tick={{ fill: "var(--muted)", fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `$${v}`} width={40} />
        <Tooltip content={<CustomTooltip />} />
        <Area type="monotone" dataKey="revenue" stroke={CHART_COLORS.revenue} strokeWidth={2} fill="url(#gradRevenue)" dot={false} activeDot={{ r: 4, fill: CHART_COLORS.revenue }} />
        <Area type="monotone" dataKey="profit"  stroke={CHART_COLORS.profit} strokeWidth={2} fill="url(#gradProfit)"  dot={false} activeDot={{ r: 4, fill: CHART_COLORS.profit }} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

// ─── Heatmap ─────────────────────────────────────────────────

function Heatmap({ data, onCellClick }) {
  if (!data || data.length === 0) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: 80, color: "var(--muted)", fontSize: 12 }}>
        Not enough data (need ≥3 orders per combination)
      </div>
    );
  }

  const banks = [...new Set(data.map((d) => d.bank))].slice(0, 8);
  const shops = [...new Set(data.map((d) => d.shop))].slice(0, 8);
  const cellMap = {};
  data.forEach((d) => { cellMap[`${d.bank}|${d.shop}`] = d; });

  return (
    <div className="overflow-x-auto">
      <table className="tbl" style={{ borderSpacing: 2, borderCollapse: "separate" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left", paddingRight: 8, paddingBottom: 4, color: "var(--muted)", fontWeight: 500, fontSize: 10 }}>Bank ↓ / Shop →</th>
            {shops.map((s) => (
              <th key={s} style={{ paddingBottom: 4, paddingLeft: 4, paddingRight: 4, color: "var(--text-2)", fontSize: 10, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s}>
                {s.length > 14 ? s.slice(0, 14) + "…" : s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {banks.map((bank) => (
            <tr key={bank}>
              <td style={{ paddingRight: 12, paddingTop: 2, paddingBottom: 2, color: "var(--text-2)", fontSize: 10, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={bank}>
                {bank.length > 18 ? bank.slice(0, 18) + "…" : bank}
              </td>
              {shops.map((shop) => {
                const cell = cellMap[`${bank}|${shop}`];
                const rate = cell ? cell.success_rate : -1;
                const label = cell ? `${cell.success_rate.toFixed(0)}%` : "—";
                return (
                  <td
                    key={shop}
                    onClick={() => cell && onCellClick && onCellClick(bank, shop)}
                    style={{
                      backgroundColor: getHeatmapColor(rate),
                      color: rate < 0 ? "var(--muted)" : "var(--text)",
                      padding: "4px 8px",
                      cursor: cell ? "pointer" : "default",
                      minWidth: 72,
                      fontWeight: cell ? 500 : 400,
                      fontSize: 10,
                      textAlign: "center",
                      borderRadius: 4,
                    }}
                    title={cell ? `${bank} × ${shop}: ${cell.total} orders, ${cell.success_rate.toFixed(1)}% success` : undefined}
                  >
                    {label}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Analytics tables ─────────────────────────────────────────

function RateBadge({ rate }) {
  return <span style={{ color: getDeliveryRateColor(rate), fontWeight: 600 }}>{rate.toFixed(1)}%</span>;
}

function BanksTable({ data }) {
  const { t } = useLang();
  if (!data?.length) return <p className="text-[11px] text-muted py-2">{t("msg_no_data")}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="tbl w-full">
        <thead>
          <tr>
            {[t("bank"),t("cards"),t("free"),t("dead"),t("col_orders_count"),t("shipped"),t("declined"),t("revenue"),t("success_rate")].map((h) => (
              <th key={h}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.map((b) => (
            <tr key={b.bank_name}>
              <td>{b.bank_name || t("msg_no_data")}</td>
              <td className="text-right">{formatNumber(b.total_cards)}</td>
              <td className="text-right text-green-t">{formatNumber(b.free_cards)}</td>
              <td className="text-right text-red-t">{formatNumber(b.dead_cards)}</td>
              <td className="text-right">{formatNumber(b.total_orders)}</td>
              <td className="text-right">{formatNumber(b.shipped)}</td>
              <td className="text-right">{formatNumber(b.declined)}</td>
              <td className="text-right">{formatCurrency(b.revenue)}</td>
              <td className="text-right"><RateBadge rate={b.success_rate} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CountryTable({ data }) {
  const { t } = useLang();
  if (!data?.length) return <p className="text-[11px] text-muted py-2">{t("msg_no_data")}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="tbl w-full">
        <thead>
          <tr>
            {[t("cc_col_country"),t("nav_cards"),t("status_free"),t("nav_orders"),t("chart_revenue"),t("col_success_rate")].map((h) => <th key={h}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.map((c) => (
            <tr key={c.country}>
              <td>{c.country}</td>
              <td className="text-right">{formatNumber(c.total_cards)}</td>
              <td className="text-right text-green-t">{formatNumber(c.free_cards)}</td>
              <td className="text-right">{formatNumber(c.total_orders)}</td>
              <td className="text-right">{formatCurrency(c.revenue)}</td>
              <td className="text-right"><RateBadge rate={c.success_rate} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SourceTable({ data }) {
  const { t } = useLang();
  if (!data?.length) return <p className="text-[11px] text-muted py-2">{t("msg_no_data")}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="tbl w-full">
        <thead>
          <tr>
            {[t("cc_col_source"),t("nav_cards"),t("status_free"),t("status_dead"),t("nav_orders"),t("chart_revenue"),t("col_success_rate")].map((h) => <th key={h}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {data.map((s) => (
            <tr key={s.source}>
              <td>{s.source || "—"}</td>
              <td className="text-right">{formatNumber(s.total_cards)}</td>
              <td className="text-right text-green-t">{formatNumber(s.free_cards)}</td>
              <td className="text-right text-red-t">{formatNumber(s.dead_cards)}</td>
              <td className="text-right">{formatNumber(s.total_orders)}</td>
              <td className="text-right">{formatCurrency(s.revenue)}</td>
              <td className="text-right"><RateBadge rate={s.success_rate} /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BinPerfTable({ data }) {
  if (!data?.length)
    return <p className="text-[11px] text-muted py-2">Not enough data yet</p>;
  return (
    <div className="overflow-x-auto">
      <table className="tbl w-full">
        <thead>
          <tr>
            <th>BIN</th>
            <th>Bank</th>
            <th className="text-right">Orders</th>
            <th className="text-right">Delivered</th>
            <th className="text-right">Declined</th>
            <th className="text-right">Revenue ($)</th>
            <th className="text-right">Delivery Rate %</th>
          </tr>
        </thead>
        <tbody>
          {data.map((b) => (
            <tr key={b.bin}>
              <td style={{ fontFamily: "JetBrains Mono,monospace", fontSize: 12 }}>{b.bin}</td>
              <td style={{ color: "var(--text-2)" }}>{b.bank_name || "—"}</td>
              <td className="text-right">{b.total_orders}</td>
              <td className="text-right text-green-t">{b.delivered}</td>
              <td className="text-right text-red-t">{b.declined}</td>
              <td className="text-right" style={{ fontFamily: "JetBrains Mono,monospace" }}>${b.total_revenue.toFixed(2)}</td>
              <td className="text-right">
                <span style={{ color: getDeliveryRateColor(b.delivery_rate), fontWeight: 600 }}>{b.delivery_rate.toFixed(1)}%</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ExpiringTable({ data, onNavigate }) {
  const { t } = useLang();
  if (!data?.length)
    return <p className="text-[11px] text-muted py-2">{t("dashboard_no_expiring")}</p>;
  return (
    <div>
      <div className="overflow-x-auto">
        <table className="tbl w-full">
          <thead>
            <tr>
              {[t("nav_cards"),t("cc_col_holder"),t("card_label_expiry"),t("col_days_left"),t("nav_profiles")].map((h) => <th key={h}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {data.map((c) => (
              <tr key={c.id} className="cursor-pointer" onClick={() => onNavigate && onNavigate("cards")}>
                <td style={{ fontFamily: "JetBrains Mono,monospace" }}>****-{c.last4}</td>
                <td>{c.holder_name}</td>
                <td>{c.expiry_date}</td>
                <td style={{ textAlign: "right", color: getExpiryColor(c.days_left), fontWeight: 600 }}>{c.days_left}d</td>
                <td>
                  {c.has_profile ? (
                    <span
                      style={{ backgroundColor: "var(--accent-dim)", color: "var(--accent-text)", fontSize: 10, padding: "2px 8px", borderRadius: 999, cursor: "pointer" }}
                      onClick={(e) => { e.stopPropagation(); onNavigate && onNavigate("profiles"); }}
                    >
                      Yes
                    </span>
                  ) : (
                    <span className="text-muted">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ textAlign: "right", marginTop: 8 }}>
        <button
          onClick={() => onNavigate && onNavigate("cards")}
          className="btn btn-ghost btn-sm"
        >
          View all expiring →
        </button>
      </div>
    </div>
  );
}

// ─── Collapsible panel ───────────────────────────────────────

function CollapsePanel({ title, id, collapsed, onToggle, children }) {
  return (
    <div className="panel p-0 overflow-hidden">
      <button
        onClick={() => onToggle(id)}
        style={{ width: "100%", display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", background: "none", border: "none", cursor: "pointer" }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--text-2)" }}>{title}</span>
        <ChevronRight size={14} style={{ color: "var(--muted)", transform: collapsed ? "rotate(0deg)" : "rotate(90deg)", transition: "transform 180ms ease", flexShrink: 0 }} />
      </button>
      {!collapsed && (
        <div style={{ padding: "0 18px 16px" }}>{children}</div>
      )}
    </div>
  );
}

// ─── Main Dashboard ──────────────────────────────────────────

export default function Dashboard({ onNavigate }) {
  const { t } = useLang();
  const { success: toastSuccess, error: toastError } = useToast();

  const [period, setPeriod] = useState("7d");
  const [from, setFrom]     = useState("");
  const [to, setTo]         = useState("");

  const [stats, setStats]               = useState(null);
  const [chart, setChart]               = useState([]);
  const [heatmap, setHeatmap]           = useState([]);
  const [banks, setBanks]               = useState([]);
  const [countries, setCountries]       = useState([]);
  const [sources, setSources]           = useState([]);
  const [expiring, setExpiring]         = useState([]);
  const [recentOrders, setRecentOrders] = useState([]);
  const [binPerf, setBinPerf]           = useState([]);

  const [loading, setLoading]       = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting]   = useState(false);

  const [collapsed, setCollapsed] = useState({
    banks:     false,
    countries: true,
    sources:   true,
    expiring:  false,
    bin_perf:  true,
  });

  const toggleSection = useCallback((id) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      invoke("set_config", { key: `dash_collapsed_${id}`, value: String(next[id]) }).catch(() => {});
      return next;
    });
  }, []);

  const loadAll = useCallback(
    async (isRefresh = false) => {
      if (isRefresh) setRefreshing(true);
      const p = { period, from: from || undefined, to: to || undefined };
      try {
        const [s, c, hm, b, co, so, ex, ro, bp] = await Promise.allSettled([
          invoke("get_dashboard_stats", p),
          invoke("get_revenue_chart", p),
          invoke("get_heatmap_data", p),
          invoke("get_top_banks", p),
          invoke("get_by_country", p),
          invoke("get_by_source", p),
          invoke("get_expiring_cards_dashboard", { days: 30 }),
          invoke("get_orders", { filter: {}, page: 1, perPage: 10 }),
          invoke("get_bin_performance"),
        ]);

        if (s.status  === "fulfilled") setStats(s.value);
        if (c.status  === "fulfilled") setChart(c.value);
        if (hm.status === "fulfilled") setHeatmap(hm.value);
        if (b.status  === "fulfilled") setBanks(b.value);
        if (co.status === "fulfilled") setCountries(co.value);
        if (so.status === "fulfilled") setSources(so.value);
        if (ex.status === "fulfilled") setExpiring(ex.value);
        if (ro.status === "fulfilled") setRecentOrders(ro.value?.items ?? []);
        if (bp.status === "fulfilled") setBinPerf(bp.value);
        [s, c, hm, b, co, so, ex, ro, bp].forEach((r, i) => {
          if (r.status === "rejected") console.warn("Dashboard load error [" + i + "]:", r.reason);
        });
      } catch {
        // Dashboard load failed
      }
      setLoading(false);
      setRefreshing(false);
    },
    [period, from, to]
  );

  // Initial load + period change
  useEffect(() => {
    setLoading(true);
    loadAll();
  }, [loadAll]);

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(() => {
      if (!document.hidden) loadAll(true);
    }, 30_000);
    return () => clearInterval(id);
  }, [loadAll]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const csv = await invoke("export_dashboard_csv", {
        period,
        from: from || undefined,
        to:   to   || undefined,
      });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href     = url;
      a.download = `dashboard_${period}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toastSuccess(t("export_success"));
    } catch (e) {
      toastError(`Export failed: ${e}`);
    } finally {
      setExporting(false);
    }
  };

  const handleExportPDF = () => {
    window.print();
    toastSuccess("Opening print dialog...");
  };

  const handleHeatmapClick = (bank, shop) => {
    onNavigate && onNavigate("orders", { bank, shop });
  };

  if (loading) {
    return (
      <div className="content">
        <div className="panel">
          <table className="tbl"><tbody><SkeletonRows count={8} cols={6} /></tbody></table>
        </div>
      </div>
    );
  }

  const s       = stats || {};
  const isEmpty = !stats;
  const hasNoActivity = !stats || (s.total_cards === 0 && s.total_orders === 0 && (s.total_profiles ?? 0) === 0);

  return (
    <div className="content">
      <style>{`
        @media print {
          .sidebar, .ph-actions, .period-bar, .filters { display: none !important; }
          .dashboard-grid, .content { width: 100% !important; max-width: 100% !important; }
          .panel { break-inside: avoid; page-break-inside: avoid; }
        }
      `}</style>

      {/* ── Page Header ── */}
      <div className="ph">
        <div>
          <div className="ph-title"><span className="live-dot" />Dashboard</div>
          <div className="ph-sub">{t("dashboard_auto_refresh")}</div>
        </div>
        <div className="ph-actions">
          <button className="btn btn-b" onClick={() => onNavigate?.("cards", { openImport: true })}>+ {t("quick_import_cc")}</button>
          <button className="btn btn-g" onClick={() => onNavigate?.("profiles")}>+ {t("quick_create_profile")}</button>
          <button className="btn btn-b" onClick={() => onNavigate?.("orders")}>+ {t("quick_new_order")}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => loadAll(true)} disabled={refreshing}>
            <RefreshCw size={13} style={{ animation: refreshing ? "spin 1s linear infinite" : "none" }} /> {refreshing ? "…" : t("btn_refresh")}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleExport} disabled={exporting}>
            <Download size={13} /> {exporting ? t("exporting") : t("export_csv")}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={handleExportPDF}>
            <FileDown size={13} /> Export PDF
          </button>
        </div>
      </div>

      {/* ── Empty state ── */}
      {isEmpty && (
        <div className="panel" style={{ textAlign: "center", padding: "48px 24px", border: "1px dashed var(--border)" }}>
          <div style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(255,255,255,0.04)", border: "1px solid var(--border)", display: "flex", alignItems: "center", justifyContent: "center", margin: "0 auto 16px" }}>
            <Download size={20} style={{ color: "var(--muted)" }} />
          </div>
          <p style={{ fontSize: 13, fontWeight: 600, color: "var(--text)", marginBottom: 6 }}>{t("msg_no_data")}</p>
          <p style={{ fontSize: 11, color: "var(--muted)", marginBottom: 16 }}>{t("dashboard_empty_hint")}</p>
          <button className="btn btn-b" onClick={() => onNavigate?.("cards", { openImport: true })}>+ {t("quick_import_cc")}</button>
        </div>
      )}

      {/* ── Period selector ── */}
      <div className="period-bar">
        {PERIODS.map((p) => (
          <button key={p.key} className={`pb${period === p.key ? " active" : ""}`} onClick={() => setPeriod(p.key)}>
            {t(p.labelKey)}
          </button>
        ))}
        {period === "custom" && (
          <>
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="inline-select-sm"
            />
            <span className="text-[11px] text-muted">→</span>
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="inline-select-sm"
            />
          </>
        )}
      </div>

      {/* ── Alerts ── */}
      {s.alerts && s.alerts.length > 0 && (
        <div className="flex flex-col gap-1.5">
          {s.alerts.map((a, i) => {
            const cls = a.level === "error" ? "alert-r" : a.level === "info" ? "alert-b" : "alert-y";
            return (
              <div key={i} className={`alert-row ${cls} cursor-pointer`} onClick={() => onNavigate && onNavigate(a.action)}>
                {a.message}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Base stats strip ── */}
      {!isEmpty && (
        <>
          <div className="slabel mt-2">{t("dashboard_base_total")}</div>
          <div className="base-strip" style={{ opacity: hasNoActivity ? 0.5 : 1 }}>
            <div className="bsi"><div className="bsi-lbl">{t("total_cc")}</div><div className="bsi-val" style={{ color: "var(--gray-t)" }}>{formatNumber(s.total_cards ?? 0)}</div></div>
            <div className="bsi"><div className="bsi-lbl">{t("status_free")}</div><div className="bsi-val text-green-t">{formatNumber(s.free_cards ?? 0)}</div></div>
            <div className="bsi"><div className="bsi-lbl">{t("in_use")}</div><div className="bsi-val text-blue-t">{formatNumber(s.inuse_cards ?? 0)}</div></div>
            <div className="bsi"><div className="bsi-lbl">{t("status_dead")}</div><div className="bsi-val text-red-t">{formatNumber(s.dead_cards ?? 0)}</div></div>
            <div className="bsi"><div className="bsi-lbl">{t("nav_profiles")}</div><div className="bsi-val text-blue-t">{formatNumber(s.total_profiles ?? 0)}</div></div>
            <div className="bsi"><div className="bsi-lbl" style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 3 }}>{t("dashboard_no_drop")} <AlertTriangle size={10} style={{ color: "var(--yellow-t)" }} /></div><div className="bsi-val text-yellow-t">{formatNumber(s.no_drop_profiles ?? 0)}</div></div>
          </div>
        </>
      )}

      {/* ── Period stat cards ── */}
      {!isEmpty && !hasNoActivity && (
        <>
          <div className="slabel">{t("dashboard_activity_period")}</div>
          <div className="cards-grid">
            <div className="sc cgr cursor-pointer" onClick={() => onNavigate?.("orders")}>
              <div className="sc-lbl">{t("nav_orders")}</div>
              <div className="sc-val">{formatNumber(s.total_orders ?? 0)}</div>
              <div className="sc-sub">{t("dashboard_for_period")}</div>
            </div>
            <div className="sc cy">
              <div className="sc-lbl">{t("status_pending")}</div>
              <div className="sc-val">{formatNumber(s.pending_orders ?? s.pending ?? 0)}</div>
              <div className="sc-sub">{t("dashboard_awaiting")}</div>
            </div>
            <div className="sc cb2">
              <div className="sc-lbl">{t("status_shipped")}</div>
              <div className="sc-val">{formatNumber(s.shipped_orders ?? s.shipped ?? 0)}</div>
            </div>
            <div className="sc cg">
              <div className="sc-lbl">{t("status_delivered")}</div>
              <div className="sc-val">{formatNumber(s.delivered_orders ?? s.delivered ?? 0)}</div>
            </div>
            <div className="sc cr">
              <div className="sc-lbl">{t("status_declined")}</div>
              <div className="sc-val">{formatNumber(s.declined_orders ?? s.declined ?? 0)}</div>
            </div>
            <div className="sc cb2 wide">
              <div className="sc-lbl">{t("chart_revenue")}</div>
              <div className="sc-val">{formatCurrency(s.revenue ?? 0)}</div>
            </div>
            <div className="sc cg wide">
              <div className="sc-lbl">{t("net_profit")}</div>
              <div className="sc-val">{formatCurrency(s.profit ?? s.net_profit ?? 0)}</div>
            </div>
          </div>
        </>
      )}

      {/* ── Charts row ── */}
      <div className="grid2">

        {/* Revenue chart */}
        <div className="panel">
          <div className="ptitle">
            {t("chart_title")}
            <div style={{ display: "flex", gap: 16, fontSize: 11 }}>
              <span className="flex items-center gap-1">
                <span style={{ width: 12, height: 2, backgroundColor: CHART_COLORS.revenue, display: "inline-block", borderRadius: 1 }} />
                <span className="text-muted">{t("chart_revenue")}</span>
              </span>
              <span className="flex items-center gap-1">
                <span style={{ width: 12, height: 2, backgroundColor: CHART_COLORS.profit, display: "inline-block", borderRadius: 1 }} />
                <span className="text-muted">{t("chart_profit")}</span>
              </span>
            </div>
          </div>
          <RevenueChart data={chart} />
        </div>

        {/* Heatmap */}
        <div className="panel">
          <div className="ptitle">
            {t("heatmap_title")}
            <div style={{ display: "flex", gap: 10, fontSize: 10 }}>
              {[
                { color: HEATMAP_COLORS.high, label: "≥50%" },
                { color: HEATMAP_COLORS.medium, label: "20–50%" },
                { color: HEATMAP_COLORS.low, label: "<20%" },
                { color: HEATMAP_COLORS.noData, label: "<3 orders" },
              ].map(({ color, label }) => (
                <span key={label} className="flex items-center gap-1">
                  <span style={{ width: 10, height: 10, borderRadius: 2, backgroundColor: color, display: "inline-block" }} />
                  <span className="text-muted">{label}</span>
                </span>
              ))}
            </div>
          </div>
          <Heatmap data={heatmap} onCellClick={handleHeatmapClick} />
        </div>

      </div>

      {/* ── Recent Orders ── */}
      {recentOrders.length > 0 && (
        <div className="panel">
          <div className="ptitle">
            {t("dashboard_recent_orders")}
            <button
              onClick={() => onNavigate?.("orders")}
              className="btn btn-ghost btn-sm"
            >
              {t("dashboard_view_all")} →
            </button>
          </div>
          <div>
            {recentOrders.map((o) => (
              <div
                key={o.id}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--border)", cursor: "pointer" }}
                onClick={() => onNavigate?.("orders")}
              >
                <div className="flex-1">
                  <div style={{ fontSize: 12, display: "flex", gap: 7, alignItems: "center" }}>
                    {o.order_number} <span className={`st st-${o.status}`}>{o.status}</span>
                  </div>
                  <div style={{ fontSize: 10, color: "var(--muted)", marginTop: 2 }}>
                    {o.shop_name} · {o.created_at?.slice(0, 10)}
                  </div>
                </div>
                <div style={{ fontFamily: "JetBrains Mono,monospace", fontSize: 11, color: "var(--blue-t)" }}>
                  ${o.amount ?? o.total_amount ?? 0}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Collapsible analytics sections ── */}
      <CollapsePanel title={t("section_top_banks")} id="banks" collapsed={collapsed.banks} onToggle={toggleSection}>
        <BanksTable data={banks} />
      </CollapsePanel>

      <CollapsePanel title={t("section_by_country")} id="countries" collapsed={collapsed.countries} onToggle={toggleSection}>
        <CountryTable data={countries} />
      </CollapsePanel>

      <CollapsePanel title={t("section_by_source")} id="sources" collapsed={collapsed.sources} onToggle={toggleSection}>
        <SourceTable data={sources} />
      </CollapsePanel>

      <CollapsePanel title={t("section_expiring")} id="expiring" collapsed={collapsed.expiring} onToggle={toggleSection}>
        <ExpiringTable data={expiring} onNavigate={onNavigate} />
      </CollapsePanel>

      <CollapsePanel title="BIN Performance" id="bin_perf" collapsed={collapsed.bin_perf} onToggle={toggleSection}>
        <BinPerfTable data={binPerf} />
      </CollapsePanel>

    </div>
  );
}
