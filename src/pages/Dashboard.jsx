import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from "recharts";
import {
  CreditCard, Users, ShoppingCart, TrendingUp, TrendingDown,
  Minus, AlertTriangle, AlertCircle, ChevronDown, ChevronRight,
  Download, RefreshCw, Plus, Clock, DollarSign,
} from "lucide-react";
import { useLang } from "../hooks/useLang";
import { useToast } from "../hooks/useToast";

// ─── Helpers ────────────────────────────────────────────────

const fmt$ = (n) =>
  n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(2)}`;

const fmtN = (n) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);

function TrendBadge({ value }) {
  if (value === null || value === undefined || isNaN(value)) return null;
  const up = value > 0;
  const zero = Math.abs(value) < 0.5;
  if (zero) return (
    <span className="text-xs flex items-center gap-0.5" style={{ color: "#6b7280" }}>
      <Minus size={10} /> 0%
    </span>
  );
  const color = up ? "#22c55e" : "#ef4444";
  const Icon = up ? TrendingUp : TrendingDown;
  return (
    <span className="text-xs flex items-center gap-0.5 font-medium" style={{ color }}>
      <Icon size={10} />
      {up ? "+" : ""}{value.toFixed(1)}%
    </span>
  );
}

function StatCard({ label, value, sub, color = "#6b7280", trend, onClick, icon: Icon }) {
  return (
    <div
      onClick={onClick}
      className="rounded-xl p-4 flex flex-col gap-2 transition-all"
      style={{
        backgroundColor: "#1a1d27",
        border: `1px solid #2a2d3a`,
        borderLeft: `3px solid ${color}`,
        cursor: onClick ? "pointer" : "default",
        minWidth: 0,
      }}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs truncate" style={{ color: "#6b7280" }}>{label}</span>
        {Icon && <Icon size={13} style={{ color, flexShrink: 0 }} />}
      </div>
      <div className="flex items-end justify-between gap-1">
        <span className="text-2xl font-bold text-white leading-none">{value}</span>
        {trend !== undefined && <TrendBadge value={trend} />}
      </div>
      {sub && <span className="text-xs" style={{ color: "#6b7280" }}>{sub}</span>}
    </div>
  );
}

// ─── Period Selector ─────────────────────────────────────────

const PERIODS = [
  { key: "today", label: "Today" },
  { key: "7d",    label: "7d" },
  { key: "30d",   label: "30d" },
  { key: "all",   label: "All time" },
  { key: "custom",label: "Custom" },
];

function PeriodSelector({ period, setPeriod, from, setFrom, to, setTo }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {PERIODS.map((p) => (
        <button
          key={p.key}
          onClick={() => setPeriod(p.key)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
          style={{
            backgroundColor: period === p.key ? "#3b82f6" : "#1a1d27",
            color: period === p.key ? "#fff" : "#9ca3af",
            border: `1px solid ${period === p.key ? "#3b82f6" : "#2a2d3a"}`,
          }}
        >
          {p.label}
        </button>
      ))}
      {period === "custom" && (
        <div className="flex items-center gap-2">
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="px-2 py-1 rounded-lg text-xs outline-none"
            style={{ backgroundColor: "#1a1d27", border: "1px solid #2a2d3a", color: "#fff" }}
          />
          <span className="text-xs" style={{ color: "#6b7280" }}>→</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="px-2 py-1 rounded-lg text-xs outline-none"
            style={{ backgroundColor: "#1a1d27", border: "1px solid #2a2d3a", color: "#fff" }}
          />
        </div>
      )}
    </div>
  );
}

// ─── Alerts Panel ────────────────────────────────────────────

function AlertsPanel({ alerts, onNavigate }) {
  if (!alerts || alerts.length === 0) return null;
  return (
    <div
      className="rounded-xl p-4 flex flex-col gap-2"
      style={{ backgroundColor: "#1a1d27", border: "1px solid #3a2020" }}
    >
      <div className="flex items-center gap-2 mb-1">
        <AlertCircle size={14} style={{ color: "#ef4444" }} />
        <span className="text-xs font-semibold" style={{ color: "#ef4444" }}>
          Alerts ({alerts.length})
        </span>
      </div>
      {alerts.map((a, i) => (
        <div
          key={i}
          onClick={() => onNavigate && onNavigate(a.action)}
          className="flex items-center gap-3 px-3 py-2 rounded-lg transition-colors"
          style={{
            backgroundColor: a.level === "error" ? "rgba(239,68,68,0.08)" : "rgba(234,179,8,0.08)",
            border: `1px solid ${a.level === "error" ? "rgba(239,68,68,0.2)" : "rgba(234,179,8,0.2)"}`,
            cursor: "pointer",
          }}
        >
          <AlertTriangle
            size={13}
            style={{ color: a.level === "error" ? "#ef4444" : "#eab308", flexShrink: 0 }}
          />
          <span className="text-xs flex-1" style={{ color: "#d1d5db" }}>
            {a.message}
          </span>
          <span
            className="text-xs px-2 py-0.5 rounded-full font-medium"
            style={{
              backgroundColor: a.level === "error" ? "rgba(239,68,68,0.15)" : "rgba(234,179,8,0.15)",
              color: a.level === "error" ? "#ef4444" : "#eab308",
            }}
          >
            {a.count}
          </span>
          <ChevronRight size={11} style={{ color: "#6b7280" }} />
        </div>
      ))}
    </div>
  );
}

// ─── Revenue Chart ────────────────────────────────────────────

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div
      className="px-3 py-2 rounded-lg text-xs"
      style={{ backgroundColor: "#1a1d27", border: "1px solid #2a2d3a" }}
    >
      <div className="font-medium text-white mb-1">{label}</div>
      <div style={{ color: "#a855f7" }}>Revenue: {fmt$(payload[0]?.value ?? 0)}</div>
      <div style={{ color: "#22c55e" }}>Profit: {fmt$(payload[1]?.value ?? 0)}</div>
    </div>
  );
}

function RevenueChart({ data }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-40" style={{ color: "#6b7280" }}>
        <span className="text-sm">No orders in this period</span>
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2a2d3a" />
        <XAxis
          dataKey="date"
          tick={{ fill: "#6b7280", fontSize: 10 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fill: "#6b7280", fontSize: 10 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `$${v}`}
          width={40}
        />
        <Tooltip content={<CustomTooltip />} />
        <Line
          type="monotone"
          dataKey="revenue"
          stroke="#a855f7"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: "#a855f7" }}
        />
        <Line
          type="monotone"
          dataKey="profit"
          stroke="#22c55e"
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4, fill: "#22c55e" }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}

// ─── Heatmap ─────────────────────────────────────────────────

function Heatmap({ data, onCellClick }) {
  if (!data || data.length === 0) {
    return (
      <div className="flex items-center justify-center h-20" style={{ color: "#6b7280" }}>
        <span className="text-sm">Not enough data (need ≥3 orders per combination)</span>
      </div>
    );
  }

  const banks = [...new Set(data.map((d) => d.bank))].slice(0, 8);
  const shops = [...new Set(data.map((d) => d.shop))].slice(0, 8);

  const cellMap = {};
  data.forEach((d) => { cellMap[`${d.bank}|${d.shop}`] = d; });

  const rateColor = (rate) => {
    if (rate < 0) return "#2a2d3a"; // no data
    if (rate < 20) return "rgba(239,68,68,0.5)";
    if (rate < 50) return "rgba(234,179,8,0.4)";
    return "rgba(34,197,94,0.4)";
  };

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-separate" style={{ borderSpacing: 2 }}>
        <thead>
          <tr>
            <th className="text-left pr-2 pb-1" style={{ color: "#6b7280", fontWeight: 500 }}>
              Bank ↓ / Shop →
            </th>
            {shops.map((s) => (
              <th
                key={s}
                className="pb-1 px-1 font-medium truncate max-w-24"
                style={{ color: "#9ca3af" }}
                title={s}
              >
                {s.length > 12 ? s.slice(0, 12) + "…" : s}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {banks.map((bank) => (
            <tr key={bank}>
              <td
                className="pr-3 py-0.5 font-medium truncate max-w-32"
                style={{ color: "#9ca3af" }}
                title={bank}
              >
                {bank.length > 16 ? bank.slice(0, 16) + "…" : bank}
              </td>
              {shops.map((shop) => {
                const cell = cellMap[`${bank}|${shop}`];
                const rate = cell ? cell.success_rate : -1;
                const label = cell ? `${cell.success_rate.toFixed(0)}%` : "—";
                return (
                  <td
                    key={shop}
                    onClick={() => cell && onCellClick && onCellClick(bank, shop)}
                    className="text-center rounded"
                    style={{
                      backgroundColor: rateColor(rate),
                      color: rate < 0 ? "#4b5563" : "#fff",
                      padding: "4px 8px",
                      cursor: cell ? "pointer" : "default",
                      minWidth: 48,
                      fontWeight: cell ? 500 : 400,
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

// ─── Collapsible Section ─────────────────────────────────────

function Section({ title, id, collapsed, onToggle, children }) {
  return (
    <div
      className="rounded-xl overflow-hidden"
      style={{ backgroundColor: "#1a1d27", border: "1px solid #2a2d3a" }}
    >
      <button
        onClick={() => onToggle(id)}
        className="w-full flex items-center justify-between px-5 py-3 transition-colors hover:bg-white/5"
      >
        <span className="text-sm font-semibold text-white">{title}</span>
        {collapsed ? (
          <ChevronRight size={14} style={{ color: "#6b7280" }} />
        ) : (
          <ChevronDown size={14} style={{ color: "#6b7280" }} />
        )}
      </button>
      {!collapsed && (
        <div className="px-5 pb-4 overflow-x-auto">{children}</div>
      )}
    </div>
  );
}

// ─── Analytics Tables ─────────────────────────────────────────

const TH = ({ children }) => (
  <th className="text-left pb-2 pr-4 whitespace-nowrap text-xs font-medium" style={{ color: "#6b7280" }}>
    {children}
  </th>
);
const TD = ({ children, right }) => (
  <td
    className="py-1.5 pr-4 text-xs whitespace-nowrap"
    style={{ color: "#d1d5db", textAlign: right ? "right" : "left" }}
  >
    {children}
  </td>
);

function RateBadge({ rate }) {
  const color = rate >= 70 ? "#22c55e" : rate >= 40 ? "#eab308" : "#ef4444";
  return <span style={{ color, fontWeight: 600 }}>{rate.toFixed(1)}%</span>;
}

function BanksTable({ data }) {
  if (!data?.length) return <p className="text-xs py-2" style={{ color: "#6b7280" }}>No data</p>;
  return (
    <table className="w-full">
      <thead>
        <tr>
          {["Bank","Cards","Free","Dead","Orders","Shipped","Declined","Revenue","Success"].map((h) => (
            <TH key={h}>{h}</TH>
          ))}
        </tr>
      </thead>
      <tbody>
        {data.map((b) => (
          <tr key={b.bank_name} className="border-t" style={{ borderColor: "#1e2130" }}>
            <TD>{b.bank_name || "Unknown"}</TD>
            <TD right>{fmtN(b.total_cards)}</TD>
            <TD right><span style={{ color: "#22c55e" }}>{fmtN(b.free_cards)}</span></TD>
            <TD right><span style={{ color: "#ef4444" }}>{fmtN(b.dead_cards)}</span></TD>
            <TD right>{fmtN(b.total_orders)}</TD>
            <TD right>{fmtN(b.shipped)}</TD>
            <TD right>{fmtN(b.declined)}</TD>
            <TD right>{fmt$(b.revenue)}</TD>
            <TD right><RateBadge rate={b.success_rate} /></TD>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function CountryTable({ data }) {
  if (!data?.length) return <p className="text-xs py-2" style={{ color: "#6b7280" }}>No data</p>;
  return (
    <table className="w-full">
      <thead>
        <tr>
          {["Country","Cards","Free","Orders","Revenue","Success"].map((h) => <TH key={h}>{h}</TH>)}
        </tr>
      </thead>
      <tbody>
        {data.map((c) => (
          <tr key={c.country} className="border-t" style={{ borderColor: "#1e2130" }}>
            <TD>{c.country}</TD>
            <TD right>{fmtN(c.total_cards)}</TD>
            <TD right><span style={{ color: "#22c55e" }}>{fmtN(c.free_cards)}</span></TD>
            <TD right>{fmtN(c.total_orders)}</TD>
            <TD right>{fmt$(c.revenue)}</TD>
            <TD right><RateBadge rate={c.success_rate} /></TD>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SourceTable({ data }) {
  if (!data?.length) return <p className="text-xs py-2" style={{ color: "#6b7280" }}>No data</p>;
  return (
    <table className="w-full">
      <thead>
        <tr>
          {["Source","Cards","Free","Dead","Orders","Revenue","Success"].map((h) => <TH key={h}>{h}</TH>)}
        </tr>
      </thead>
      <tbody>
        {data.map((s) => (
          <tr key={s.source} className="border-t" style={{ borderColor: "#1e2130" }}>
            <TD>{s.source || "—"}</TD>
            <TD right>{fmtN(s.total_cards)}</TD>
            <TD right><span style={{ color: "#22c55e" }}>{fmtN(s.free_cards)}</span></TD>
            <TD right><span style={{ color: "#ef4444" }}>{fmtN(s.dead_cards)}</span></TD>
            <TD right>{fmtN(s.total_orders)}</TD>
            <TD right>{fmt$(s.revenue)}</TD>
            <TD right><RateBadge rate={s.success_rate} /></TD>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ExpiringTable({ data, onNavigate }) {
  if (!data?.length)
    return <p className="text-xs py-2" style={{ color: "#6b7280" }}>No expiring cards</p>;
  return (
    <table className="w-full">
      <thead>
        <tr>
          {["Card","Holder","Expiry","Days Left","Profile"].map((h) => <TH key={h}>{h}</TH>)}
        </tr>
      </thead>
      <tbody>
        {data.map((c) => {
          const urgent = c.days_left <= 14;
          const warn = c.days_left <= 30;
          const dayColor = urgent ? "#ef4444" : warn ? "#eab308" : "#22c55e";
          return (
            <tr key={c.id} className="border-t" style={{ borderColor: "#1e2130" }}>
              <TD>****-{c.last4}</TD>
              <TD>{c.holder_name}</TD>
              <TD>{c.expiry_date}</TD>
              <TD right><span style={{ color: dayColor, fontWeight: 600 }}>{c.days_left}d</span></TD>
              <TD>
                {c.has_profile ? (
                  <span
                    className="text-xs px-2 py-0.5 rounded-full cursor-pointer"
                    style={{ backgroundColor: "rgba(59,130,246,0.15)", color: "#3b82f6" }}
                    onClick={() => onNavigate && onNavigate("profiles")}
                  >
                    Yes
                  </span>
                ) : (
                  <span style={{ color: "#6b7280" }}>—</span>
                )}
              </TD>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

// ─── Main Dashboard ─────────────────────────────────────────

export default function Dashboard({ onNavigate }) {
  const { t } = useLang();
  const { showToast } = useToast();

  const [period, setPeriod] = useState("7d");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const [stats, setStats] = useState(null);
  const [chart, setChart] = useState([]);
  const [heatmap, setHeatmap] = useState([]);
  const [banks, setBanks] = useState([]);
  const [countries, setCountries] = useState([]);
  const [sources, setSources] = useState([]);
  const [expiring, setExpiring] = useState([]);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [collapsed, setCollapsed] = useState({
    banks: false,
    countries: true,
    sources: true,
    expiring: false,
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
        const [s, c, hm, b, co, so, ex] = await Promise.allSettled([
          invoke("get_dashboard_stats", p),
          invoke("get_revenue_chart", p),
          invoke("get_heatmap_data", p),
          invoke("get_top_banks", p),
          invoke("get_by_country", p),
          invoke("get_by_source", p),
          invoke("get_expiring_cards_dashboard", { days: 30 }),
        ]);

        if (s.status === "fulfilled") setStats(s.value);
        if (c.status === "fulfilled") setChart(c.value);
        if (hm.status === "fulfilled") setHeatmap(hm.value);
        if (b.status === "fulfilled") setBanks(b.value);
        if (co.status === "fulfilled") setCountries(co.value);
        if (so.status === "fulfilled") setSources(so.value);
        if (ex.status === "fulfilled") setExpiring(ex.value);
      } catch (_) {}
      setLoading(false);
      setRefreshing(false);
    },
    [period, from, to]
  );

  // Initial load + period change
  useEffect(() => {
    setLoading(true);
    loadAll();
  }, [period, from, to]);

  // Auto-refresh every 30s
  useEffect(() => {
    const id = setInterval(() => loadAll(true), 30_000);
    return () => clearInterval(id);
  }, [loadAll]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const csv = await invoke("export_dashboard_csv", {
        period,
        from: from || undefined,
        to: to || undefined,
      });
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `dashboard_${period}_${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      showToast("Exported successfully", "success");
    } catch (e) {
      showToast(`Export failed: ${e}`, "error");
    } finally {
      setExporting(false);
    }
  };

  const handleHeatmapClick = (bank, shop) => {
    onNavigate && onNavigate("orders", { bank, shop });
  };

  const handleStatCardClick = (page, filter) => {
    onNavigate && onNavigate(page, filter);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div
          className="w-8 h-8 rounded-full border-2 border-t-transparent animate-spin"
          style={{ borderColor: "#3b82f6", borderTopColor: "transparent" }}
        />
      </div>
    );
  }

  const s = stats || {};

  return (
    <div className="p-5 flex flex-col gap-5 max-w-screen-xl">

      {/* ── Top bar ── */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <h1 className="text-base font-semibold text-white">Dashboard</h1>
          {refreshing && (
            <RefreshCw size={13} className="animate-spin" style={{ color: "#6b7280" }} />
          )}
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Quick Actions */}
          <button
            onClick={() => onNavigate && onNavigate("cards", { openImport: true })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: "rgba(59,130,246,0.12)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.25)" }}
          >
            <Plus size={12} /> Import CC
          </button>
          <button
            onClick={() => onNavigate && onNavigate("profiles", { openCreate: true })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: "rgba(34,197,94,0.1)", color: "#22c55e", border: "1px solid rgba(34,197,94,0.2)" }}
          >
            <Plus size={12} /> Create Profile
          </button>
          <button
            onClick={() => onNavigate && onNavigate("orders", { openCreate: true })}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: "rgba(168,85,247,0.1)", color: "#a855f7", border: "1px solid rgba(168,85,247,0.2)" }}
          >
            <Plus size={12} /> New Order
          </button>

          {/* Export */}
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{ backgroundColor: "#1a1d27", color: "#9ca3af", border: "1px solid #2a2d3a", opacity: exporting ? 0.6 : 1 }}
          >
            <Download size={12} />
            {exporting ? "Exporting…" : "Export CSV"}
          </button>

          {/* Refresh */}
          <button
            onClick={() => loadAll(true)}
            className="p-1.5 rounded-lg transition-colors"
            style={{ backgroundColor: "#1a1d27", color: "#6b7280", border: "1px solid #2a2d3a" }}
          >
            <RefreshCw size={13} className={refreshing ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* ── Period Selector ── */}
      <PeriodSelector
        period={period} setPeriod={setPeriod}
        from={from} setFrom={setFrom}
        to={to} setTo={setTo}
      />

      {/* ── Alerts ── */}
      <AlertsPanel alerts={s.alerts} onNavigate={(a) => onNavigate && onNavigate(a)} />

      {/* ── Row 1: Static Counters ── */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))" }}>
        <StatCard
          label="Total CC" value={fmtN(s.total_cc ?? 0)} color="#3b82f6" icon={CreditCard}
          onClick={() => handleStatCardClick("cards", {})}
        />
        <StatCard
          label="Free CC" value={fmtN(s.free_cc ?? 0)} color="#22c55e" icon={CreditCard}
          onClick={() => handleStatCardClick("cards", { status: "free" })}
        />
        <StatCard
          label="In Use" value={fmtN(s.in_use_cc ?? 0)} color="#eab308" icon={CreditCard}
          onClick={() => handleStatCardClick("cards", { status: "in_use" })}
        />
        <StatCard
          label="Dead CC" value={fmtN(s.dead_cc ?? 0)} color="#ef4444" icon={CreditCard}
          onClick={() => handleStatCardClick("cards", { status: "dead" })}
        />
        <StatCard
          label="Profiles" value={fmtN(s.total_profiles ?? 0)} color="#a855f7" icon={Users}
          onClick={() => handleStatCardClick("profiles", {})}
        />
        <StatCard
          label="No Drop" value={fmtN(s.no_drop_profiles ?? 0)} color="#f97316" icon={Users}
          sub="Need drop"
          onClick={() => handleStatCardClick("profiles", { has_drop: false })}
        />
      </div>

      {/* ── Row 2: Period Stats ── */}
      <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))" }}>
        <StatCard
          label="Orders" value={fmtN(s.total_orders ?? 0)} color="#3b82f6" icon={ShoppingCart}
          trend={s.orders_trend}
          onClick={() => handleStatCardClick("orders", {})}
        />
        <StatCard
          label="Pending" value={fmtN(s.pending ?? 0)} color="#eab308" icon={Clock}
          onClick={() => handleStatCardClick("orders", { status: "pending" })}
        />
        <StatCard
          label="Shipped" value={fmtN(s.shipped ?? 0)} color="#3b82f6"
          onClick={() => handleStatCardClick("orders", { status: "shipped" })}
        />
        <StatCard
          label="Delivered" value={fmtN(s.delivered ?? 0)} color="#22c55e"
          trend={s.delivered_trend}
          onClick={() => handleStatCardClick("orders", { status: "delivered" })}
        />
        <StatCard
          label="Declined" value={fmtN(s.declined ?? 0)} color="#ef4444"
          onClick={() => handleStatCardClick("orders", { status: "declined" })}
        />
        <StatCard
          label="Revenue" value={fmt$(s.revenue ?? 0)} color="#a855f7" icon={DollarSign}
          trend={s.revenue_trend}
        />
        <StatCard
          label="Net Profit" value={fmt$(s.net_profit ?? 0)} color="#22c55e" icon={DollarSign}
          sub="Delivered only"
        />
      </div>

      {/* ── Revenue Chart ── */}
      <div
        className="rounded-xl p-5"
        style={{ backgroundColor: "#1a1d27", border: "1px solid #2a2d3a" }}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-semibold text-white">Revenue & Profit</span>
          <div className="flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 rounded inline-block" style={{ backgroundColor: "#a855f7" }} />
              <span style={{ color: "#9ca3af" }}>Revenue</span>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-0.5 rounded inline-block" style={{ backgroundColor: "#22c55e" }} />
              <span style={{ color: "#9ca3af" }}>Net Profit</span>
            </span>
          </div>
        </div>
        <RevenueChart data={chart} />
      </div>

      {/* ── Heatmap ── */}
      <div
        className="rounded-xl p-5"
        style={{ backgroundColor: "#1a1d27", border: "1px solid #2a2d3a" }}
      >
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-semibold text-white">Bank × Shop Success Rate</span>
          <div className="flex items-center gap-3 text-xs">
            {[
              { color: "rgba(34,197,94,0.4)", label: "≥50%" },
              { color: "rgba(234,179,8,0.4)",  label: "20–50%" },
              { color: "rgba(239,68,68,0.5)",  label: "<20%" },
              { color: "#2a2d3a",              label: "<3 orders" },
            ].map(({ color, label }) => (
              <span key={label} className="flex items-center gap-1">
                <span className="w-3 h-3 rounded inline-block" style={{ backgroundColor: color }} />
                <span style={{ color: "#6b7280" }}>{label}</span>
              </span>
            ))}
          </div>
        </div>
        <Heatmap data={heatmap} onCellClick={handleHeatmapClick} />
      </div>

      {/* ── Collapsible analytics sections ── */}
      <Section title="Top Banks" id="banks" collapsed={collapsed.banks} onToggle={toggleSection}>
        <BanksTable data={banks} />
      </Section>

      <Section title="By Country" id="countries" collapsed={collapsed.countries} onToggle={toggleSection}>
        <CountryTable data={countries} />
      </Section>

      <Section title="By Source" id="sources" collapsed={collapsed.sources} onToggle={toggleSection}>
        <SourceTable data={sources} />
      </Section>

      <Section title="Expiring Cards (30d)" id="expiring" collapsed={collapsed.expiring} onToggle={toggleSection}>
        <ExpiringTable data={expiring} onNavigate={onNavigate} />
      </Section>
    </div>
  );
}
