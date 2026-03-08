import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Activity, Package, Truck, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { useToast } from "../hooks/useToast.jsx";

const UPDATE_TYPE_META = {
  track:     { icon: "📦", uiCls: "ui-trk", label: "Новый трек",     color: "#4ade80" },
  delivered: { icon: "✅", uiCls: "ui-del", label: "Доставлено",      color: "#22d3ee" },
  confirmed: { icon: "🧾", uiCls: "ui-con", label: "Подтверждение",   color: "#fb923c" },
  cancelled: { icon: "❌", uiCls: "ui-can", label: "Кенсел",           color: "#f87171" },
  attention: { icon: "⚠️", uiCls: "ui-wrn", label: "Нужно внимание",  color: "#facc15" },
};

const TABS = [
  { key: "all",       label: "Все" },
  { key: "track",     label: "📦 Треки" },
  { key: "delivered", label: "✅ Доставлено" },
  { key: "cancelled", label: "❌ Кенселы" },
  { key: "attention", label: "⚠️ Внимание" },
];

function relativeTime(isoStr) {
  if (!isoStr) return "—";
  const diff = Date.now() - new Date(isoStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "только что";
  if (m < 60) return `${m}м назад`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}ч назад`;
  return `${Math.floor(h / 24)}д назад`;
}

// Map activity log event_type → update tab key
function getUpdateType(item) {
  const ev = item.event_type ?? item.entity_type ?? "";
  if (ev.includes("track")) return "track";
  if (ev.includes("deliver")) return "delivered";
  if (ev.includes("confirm")) return "confirmed";
  if (ev.includes("cancel")) return "cancelled";
  if (ev.includes("warn") || ev.includes("attention") || ev.includes("alert")) return "attention";
  // fallback by entity_type
  return item.entity_type ?? "attention";
}

function countByType(items) {
  const counts = { track: 0, delivered: 0, confirmed: 0, cancelled: 0, attention: 0 };
  for (const item of items) {
    const t = getUpdateType(item);
    if (t in counts) counts[t]++;
  }
  return counts;
}

function UpdateCard({ item, onApplyTrack, onIgnore }) {
  const typeKey = getUpdateType(item);
  const meta = UPDATE_TYPE_META[typeKey] ?? { icon: "📌", uiCls: "ui-wrn", label: item.event_type ?? typeKey, color: "#9ca3af" };
  const isTrack = typeKey === "track";

  return (
    <div className="upd-card">
      <div className="upd-head">
        <div className={`upd-icon ${meta.uiCls}`}>{meta.icon}</div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {item.description ?? item.event_type ?? "(no description)"}
          </div>
          <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>
            {meta.label}{item.entity_type ? ` · ${item.entity_type}` : ""}{item.entity_id ? ` #${item.entity_id}` : ""}
          </div>
        </div>
        <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "var(--dim)", flexShrink: 0 }}>
          {relativeTime(item.created_at)}
        </div>
      </div>

      {isTrack && item.tracking_number && (
        <div className="trk-box">
          <div>
            <div className="trk-num">{item.tracking_number}</div>
            <div className="trk-sub">{item.carrier ?? "Carrier"}</div>
          </div>
          <div className="trk-acts">
            <button className="btn btn-g btn-sm" onClick={() => onApplyTrack?.(item)}>✓ Применить трек</button>
            <button className="btn btn-ghost btn-sm" onClick={() => onIgnore?.(item)}>Игнор</button>
          </div>
        </div>
      )}

      {typeKey === "cancelled" && (
        <div className="cancel-box">
          <div style={{ fontSize: 12, color: "#f87171", marginBottom: 8 }}>
            Магазин отменил заказ. Карта жива — кенсел ≠ dead.
          </div>
          <div style={{ display: "flex", gap: 7 }}>
            <button className="btn btn-o btn-sm">↻ Перебить</button>
            <button className="btn btn-r btn-sm">💀 Пометить dead</button>
            <button className="btn btn-ghost btn-sm">Оставить</button>
          </div>
        </div>
      )}

      {typeKey === "delivered" && (
        <div className="status-row">
          <span className="st st-delivered">Delivered</span>
          <span style={{ fontSize: 11, color: "var(--muted)" }}>→ статус обновлён автоматически</span>
          <button className="btn btn-o btn-sm" style={{ marginLeft: "auto" }}>↻ Перебить</button>
        </div>
      )}
    </div>
  );
}

export default function Updates() {
  const toast = useToast();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState("all");
  const [refreshing, setRefreshing] = useState(false);
  const [currentVersion, setCurrentVersion] = useState("0.1.0");
  const [serverVersion, setServerVersion] = useState(null); // { version, notes } | null

  const loadData = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const [logResult, versionResult, appVerResult] = await Promise.allSettled([
        invoke("get_activity_log", {
          filter: { event_type: null, entity_type: null, from_date: null, to_date: null },
          page: 1,
        }),
        invoke("get_server_version"),
        invoke("get_app_version"),
      ]);
      if (logResult.status === "fulfilled") setItems(logResult.value.items ?? []);
      if (versionResult.status === "fulfilled" && versionResult.value) setServerVersion(versionResult.value);
      if (appVerResult.status === "fulfilled") setCurrentVersion(appVerResult.value);
    } catch (err) {
      const msg = err?.toString?.() ?? "Unknown error";
      setError(msg);
      if (!silent) toast.error("Failed to load updates");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [toast]);

  useEffect(() => { loadData(); }, [loadData]);

  const handleRefresh = () => { setRefreshing(true); loadData(true); };
  const handleApplyTrack = (item) => toast.success(`Track applied for item ${item.id}`);
  const handleIgnore = (item) => setItems((prev) => prev.filter((i) => i.id !== item.id));

  const filteredItems = activeTab === "all"
    ? items
    : items.filter((item) => getUpdateType(item) === activeTab);

  const counts = countByType(items);

  return (
    <div className="content">
      <div className="ph">
        <div>
          <div className="ph-title">📬 Updates <span style={{ color: "var(--dim)", fontSize: 14, fontWeight: 400 }}>/ Пока ты спал</span></div>
          <div className="ph-sub">IMAP автоматически мониторит почту</div>
        </div>
        <div className="ph-actions">
          <button className="btn btn-ghost btn-sm" onClick={handleRefresh} disabled={loading || refreshing}>
            {refreshing ? "…" : "↻ Обновить"}
          </button>
          <button className="btn btn-g btn-sm">✓ Применить все треки</button>
        </div>
      </div>

      {/* Version banner */}
      {serverVersion && serverVersion.version !== currentVersion && (
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "10px 14px", marginBottom: 12, borderRadius: 8,
          background: "rgba(59,130,246,0.08)", border: "1px solid rgba(59,130,246,0.2)",
        }}>
          <div>
            <span style={{ color: "#60a5fa", fontWeight: 600, fontSize: 13 }}>
              🆕 Новая версия: v{serverVersion.version}
            </span>
            {serverVersion.notes && (
              <span style={{ color: "var(--muted)", fontSize: 11, marginLeft: 10 }}>{serverVersion.notes}</span>
            )}
          </div>
          <a
            href={`https://api.eulivehub.com/releases/CC.Manager_${serverVersion.version}_aarch64.dmg`}
            target="_blank" rel="noreferrer"
            className="btn btn-b btn-sm"
          >
            ↓ Скачать
          </a>
        </div>
      )}
      {serverVersion && serverVersion.version === currentVersion && (
        <div style={{
          fontSize: 11, color: "var(--muted)", marginBottom: 12,
          padding: "6px 14px", background: "rgba(34,197,94,0.05)",
          border: "1px solid rgba(34,197,94,0.1)", borderRadius: 6,
        }}>
          ✓ Актуальная версия v{currentVersion}
        </div>
      )}

      {!loading && !error && (
        <div className="sum-bar" style={{ marginBottom: 16 }}>
          <div className="sum-item"><div className="sum-num" style={{ color: "#4ade80" }}>{counts.track}</div><div className="sum-lbl">📦 Новых трека</div></div>
          <div className="sum-item"><div className="sum-num" style={{ color: "#22d3ee" }}>{counts.delivered}</div><div className="sum-lbl">✅ Доставлено</div></div>
          <div className="sum-item"><div className="sum-num" style={{ color: "#fb923c" }}>{counts.confirmed}</div><div className="sum-lbl">🧾 Подтверждение</div></div>
          <div className="sum-item"><div className="sum-num" style={{ color: "#f87171" }}>{counts.cancelled}</div><div className="sum-lbl">❌ Кенсел</div></div>
          <div className="sum-item"><div className="sum-num" style={{ color: "#facc15" }}>{counts.attention}</div><div className="sum-lbl">⚠️ Нужно внимание</div></div>
        </div>
      )}

      <div className="filters">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            className={`flt${activeTab === tab.key ? " active" : ""}`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label} {tab.key !== "all" ? `(${counts[tab.key] ?? 0})` : `(${items.length})`}
          </button>
        ))}
      </div>

      {loading ? (
        <div style={{ color: "var(--muted)", padding: "40px 0", textAlign: "center" }}>Загрузка…</div>
      ) : error ? (
        <div style={{ color: "#f87171", padding: "40px 0", textAlign: "center", fontSize: 13 }}>
          {error}
          <br />
          <button className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={handleRefresh}>↻ Повторить</button>
        </div>
      ) : filteredItems.length === 0 ? (
        <div style={{ color: "var(--muted)", padding: "40px 0", textAlign: "center", fontSize: 13 }}>
          Нет событий для отображения
        </div>
      ) : (
        filteredItems.map((item) => (
          <UpdateCard key={item.id} item={item} onApplyTrack={handleApplyTrack} onIgnore={handleIgnore} />
        ))
      )}
    </div>
  );
}
