import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ShoppingCart, Plus, Search, RefreshCw, X, ChevronDown, ChevronRight,
  Trash2, AlertTriangle, CheckCircle2, ShieldAlert, Clock, CreditCard,
  Truck, Package, Sparkles, Save, FolderOpen, Info, ArrowRight,
  Edit2, ExternalLink, AlertCircle, Wifi
} from "lucide-react";
import { useLang } from "../hooks/useLang";
import { useToast } from "../hooks/useToast";
import { useConfirm } from "../hooks/useConfirm";
import { useSmartSuggestions, SuggestionBadge } from "./Shops";
import { SkeletonRows } from "../components/SkeletonRow.jsx";

// ─── CopyNumberBtn ───────────────────────────────────────────
function CopyNumberBtn({ value }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (!value) return;
    navigator.clipboard.writeText(value).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };
  return (
    <button
      onClick={e => { e.stopPropagation(); handleCopy(); }}
      title="Copy order number"
      style={{
        marginLeft: 4, padding: "1px 4px", borderRadius: 4,
        background: copied ? "rgba(34,197,94,0.15)" : "transparent",
        color: copied ? "#22c55e" : "#4b5563",
        border: "none", cursor: "pointer", fontSize: 10, lineHeight: 1,
        transition: "color 0.15s",
      }}
    >
      {copied ? "✓" : "⧉"}
    </button>
  );
}

// ─── OrderTimeline ────────────────────────────────────────────
const STATUS_STEPS = ["pending", "processing", "shipped", "delivered"];

function OrderTimeline({ status }) {
  const isTerminal = status === "cancelled" || status === "declined";
  const steps = isTerminal ? [...STATUS_STEPS.slice(0, 2), status] : STATUS_STEPS;
  const currentIdx = steps.indexOf(status);

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
      {steps.map((step, i) => {
        const isPast = i < currentIdx;
        const isCurrent = i === currentIdx;
        const isFuture = i > currentIdx;
        const color = isCurrent
          ? (status === "delivered" ? "#22c55e" : status === "declined" || status === "cancelled" ? "#ef4444" : "#3b82f6")
          : isPast ? "#22c55e" : "#1e2338";
        return (
          <div key={step} style={{ display: "flex", alignItems: "center", flex: i < steps.length - 1 ? 1 : 0 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
              <div style={{
                width: 10, height: 10, borderRadius: "50%",
                background: color,
                boxShadow: isCurrent ? `0 0 0 3px ${color}30` : "none",
                flexShrink: 0,
              }} />
              <span style={{ fontSize: 10, color: isFuture ? "#4b5563" : "#9ca3af", whiteSpace: "nowrap" }}>
                {step}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{
                flex: 1, height: 1.5, background: isPast ? "#22c55e" : "#1e2338",
                margin: "0 6px", marginBottom: 16, minWidth: 40,
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Constants ───────────────────────────────────────────────
const STATUSES = ["pending", "processing", "shipped", "in_transit", "delivered", "declined", "cancelled"];
const STATUS_CSS = {
  pending:    "st-pending",
  processing: "st-processing",
  shipped:    "st-shipped",
  in_transit: "st-transit",
  delivered:  "st-delivered",
  declined:   "st-decline",
  cancelled:  "st-cancelled",
};

const STATUS_DOT_COLOR = {
  pending:    "#fde047",
  processing: "#60a5fa",
  shipped:    "#a78bfa",
  in_transit: "#22d3ee",
  delivered:  "#4ade80",
  declined:   "#f87171",
  cancelled:  "#9ca3af",
};

// ─── Risk Check display ───────────────────────────────────────
function RiskBlock({ result, loading }) {
  const [open, setOpen] = useState(false);

  if (loading) {
    return (
      <div style={{
        display: "flex", alignItems: "center", gap: 8,
        padding: "8px 12px", borderRadius: 12,
        background: "#0b0d14", border: "1px solid #1e2338",
        fontSize: 12, color: "#6b7280",
      }}>
        <div style={{
          width: 12, height: 12, borderRadius: "50%",
          border: "1.5px solid #4b5563", borderTopColor: "#9ca3af",
          animation: "spin 0.7s linear infinite",
          flexShrink: 0,
        }} />
        Checking risk…
      </div>
    );
  }
  if (!result) return null;

  const config = {
    safe:      { borderColor: "rgba(34,197,94,0.2)",   bg: "rgba(34,197,94,0.05)",   iconColor: "#4ade80", label: "Safe",                                                              textColor: "#4ade80" },
    warning:   { borderColor: "rgba(234,179,8,0.2)",   bg: "rgba(234,179,8,0.05)",   iconColor: "#facc15", label: `Warning: ${result.score} issue${result.score !== 1 ? "s" : ""}`,   textColor: "#facc15" },
    high_risk: { borderColor: "rgba(239,68,68,0.2)",   bg: "rgba(239,68,68,0.05)",   iconColor: "#f87171", label: `High Risk: ${result.score} issue${result.score !== 1 ? "s" : ""}`, textColor: "#f87171" },
  };
  const c = config[result.level] || config.safe;

  const IconComponent = result.level === "safe" ? CheckCircle2 : result.level === "high_risk" ? ShieldAlert : AlertTriangle;

  return (
    <div style={{ borderRadius: 12, border: `1px solid ${c.borderColor}`, background: c.bg, overflow: "hidden" }}>
      <button
        onClick={() => result.warnings?.length && setOpen((o) => !o)}
        style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          width: "100%", padding: "8px 12px", fontSize: 12,
          background: "transparent", border: "none", cursor: result.warnings?.length ? "pointer" : "default",
          color: "var(--text)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <IconComponent size={14} style={{ color: c.iconColor }} />
          <span style={{ fontWeight: 500, color: c.textColor }}>{c.label}</span>
          {result.offline && (
            <span style={{ display: "flex", alignItems: "center", gap: 4, color: "rgba(234,179,8,0.7)", fontSize: 11 }}>
              <Wifi size={11} /> Offline
            </span>
          )}
        </div>
        {result.warnings?.length > 0 && (
          <ChevronDown size={13} style={{ color: "#6b7280", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s" }} />
        )}
      </button>
      {open && result.warnings?.length > 0 && (
        <div style={{ borderTop: "1px solid #1e2338" }}>
          {result.warnings.map((w, i) => (
            <div key={i} style={{
              padding: "8px 12px", display: "flex", alignItems: "flex-start", gap: 8,
              fontSize: 12, borderBottom: i < result.warnings.length - 1 ? "1px solid #1e2338" : "none",
            }}>
              {w.severity === "high"
                ? <AlertTriangle size={11} style={{ color: "#f87171", marginTop: 2, flexShrink: 0 }} />
                : <AlertCircle size={11} style={{ color: "#facc15", marginTop: 2, flexShrink: 0 }} />
              }
              <span style={{ color: "#d1d5db" }}>{w.message}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ShippedModal ─────────────────────────────────────────────
function ShippedModal({ onConfirm, onClose }) {
  const [track, setTrack] = useState("");
  const [carrier, setCarrier] = useState("");
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 360 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 20 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Truck size={16} style={{ color: "#a78bfa" }} />
            <span className="modal-title" style={{ margin: 0 }}>Mark as Shipped</span>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div className="form-group">
          <label className="form-label">Tracking Number</label>
          <input
            value={track}
            onChange={(e) => setTrack(e.target.value)}
            placeholder="1Z999AA10123456784"
            className="form-input"
            style={{ fontFamily: "'JetBrains Mono',monospace" }}
          />
        </div>
        <div className="form-group">
          <label className="form-label">Carrier</label>
          <input
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
            placeholder="UPS, FedEx, USPS…"
            className="form-input"
          />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button onClick={onClose} className="btn btn-ghost btn-sm" style={{ flex: 1 }}>Cancel</button>
          <button
            onClick={() => onConfirm({ tracking_number: track || null, carrier: carrier || null })}
            className="btn btn-b btn-sm"
            style={{ flex: 1 }}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── StatusMenu ───────────────────────────────────────────────
function StatusMenu({ order, onUpdate, onClose }) {
  const [showShippedModal, setShowShippedModal] = useState(false);
  const { toast } = useToast();
  const { confirm } = useConfirm();

  const handleStatus = async (status) => {
    if (status === "shipped") { setShowShippedModal(true); return; }
    if (status === "declined") {
      const markDead = await confirm("Mark card as dead?", { confirmLabel: "Mark Dead", cancelLabel: "Keep Active" });
      try {
        await invoke("update_order_status", { id: order.id, status, meta: null });
        if (markDead && order.card_id != null) await invoke("update_card_status", { id: order.card_id, status: "dead" });
        toast("Status updated", "success");
        onUpdate();
        onClose();
      } catch (e) { toast(String(e), "error"); }
      return;
    }
    try {
      await invoke("update_order_status", { id: order.id, status, meta: null });
      toast("Status updated", "success");
      onUpdate();
      onClose();
    } catch (e) { toast(String(e), "error"); }
  };

  const handleShipped = async (meta) => {
    try {
      await invoke("update_order_status", { id: order.id, status: "shipped", meta });
      toast("Marked as shipped", "success");
      onUpdate();
      onClose();
    } catch (e) { toast(String(e), "error"); }
  };

  return (
    <>
      <div style={{
        position: "absolute", right: 0, top: 32, zIndex: 30,
        background: "#171b28", border: "1px solid #1e2338",
        borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        overflow: "hidden", width: 160,
      }}>
        {STATUSES.filter((s) => s !== order.status).map((s) => (
          <button
            key={s}
            onClick={() => handleStatus(s)}
            style={{
              width: "100%", textAlign: "left", padding: "8px 12px",
              fontSize: 12, color: "#d1d5db", background: "transparent",
              border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
            }}
            onMouseEnter={e => e.currentTarget.style.background = "#1e2338"}
            onMouseLeave={e => e.currentTarget.style.background = "transparent"}
          >
            <span style={{
              width: 6, height: 6, borderRadius: "50%", flexShrink: 0,
              backgroundColor: STATUS_DOT_COLOR[s] ?? "#9ca3af",
            }} />
            {s.charAt(0).toUpperCase() + s.slice(1).replace("_", " ")}
          </button>
        ))}
      </div>
      {showShippedModal && (
        <ShippedModal onConfirm={handleShipped} onClose={() => setShowShippedModal(false)} />
      )}
    </>
  );
}

// ─── CreateOrder modal ────────────────────────────────────────
const EMPTY_ITEM = { name: "", sku: "", qty: 1, price: "" };

function CreateOrderModal({ onCreated, onClose }) {
  // Step state
  const [profileId, setProfileId] = useState("");
  const [profileDetail, setProfileDetail] = useState(null);
  const [shopId, setShopId] = useState(null);
  const [shopObj, setShopObj] = useState(null);
  const [shopSearch, setShopSearch] = useState("");
  const [shopResults, setShopResults] = useState([]);
  const [dropId, setDropId] = useState(null);
  const [emailId, setEmailId] = useState(null);
  const [emails, setEmails] = useState([]);
  const [proxyId, setProxyId] = useState(null);
  const [proxies, setProxies] = useState([]);
  const [orderNumber, setOrderNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [items, setItems] = useState([{ ...EMPTY_ITEM }]);
  const [riskResult, setRiskResult] = useState(null);
  const [riskLoading, setRiskLoading] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [showSaveTemplate, setShowSaveTemplate] = useState(false);
  const [templateName, setTemplateName] = useState("");
  const [loading, setLoading] = useState(false);
  const [profileSearch, setProfileSearch] = useState("");
  const [profileResults, setProfileResults] = useState([]);

  const { toast } = useToast();
  const { suggestions: smartSuggs } = useSmartSuggestions(shopId, profileDetail?.card?.id);

  // ── Profile search ──
  const searchProfiles = useCallback(async (q) => {
    try {
      const r = await invoke("get_profiles", { filter: { search: q || null, has_drop: true }, page: 1, perPage: 20 });
      setProfileResults(r.items || []);
    } catch { setProfileResults([]); }
  }, []);

  useEffect(() => { searchProfiles(profileSearch); }, [profileSearch]);

  const selectProfile = async (p) => {
    setProfileId(p.id);
    setProfileSearch(`${p.holder_masked || "—"} ···${p.last4 || "????"}`);
    setProfileResults([]);
    try {
      const d = await invoke("get_profile_detail", { id: p.id });
      setProfileDetail(d);
      // Default to primary drop
      const primary = d.drops?.find((dd) => dd.is_primary) || d.drops?.[0];
      if (primary) setDropId(primary.id);
    } catch { setProfileDetail(null); }
  };

  // ── Shop search ──
  const searchShops = useCallback(async (q) => {
    if (!q.trim()) { setShopResults([]); return; }
    try {
      const r = await invoke("get_shops", { page: 1, perPage: 10, search: q });
      setShopResults(r.items || []);
    } catch { setShopResults([]); }
  }, []);

  useEffect(() => { searchShops(shopSearch); }, [shopSearch]);

  const selectShop = async (s) => {
    setShopId(s.id);
    setShopObj(s);
    setShopSearch(s.name);
    setShopResults([]);
    // Load emails + proxies for this shop
    try {
      const [em, px, tmpl] = await Promise.all([
        invoke("get_emails", { filter: {}, page: 1, perPage: 100 }),
        invoke("get_proxies", { filter: {}, page: 1, perPage: 100 }),
        invoke("get_order_templates", { shopTag: s.domain }),
      ]);
      setEmails(em.items || []);
      setProxies(px.items || []);
      setTemplates(tmpl || []);
    } catch { /* non-fatal */ }
  };

  // ── Risk check ──
  useEffect(() => {
    if (!profileId || !shopId || !dropId) { setRiskResult(null); return; }
    const timer = setTimeout(async () => {
      setRiskLoading(true);
      try {
        const r = await invoke("run_risk_check", {
          profileId, shopId, dropId,
          emailPoolId: emailId || null,
          proxyId: proxyId || null,
        });
        setRiskResult(r);
      } catch {
        setRiskResult({ level: "safe", score: 0, warnings: [], offline: true });
      } finally {
        setRiskLoading(false);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [profileId, shopId, dropId, emailId, proxyId]);

  // ── Items ──
  const total = items.reduce((s, i) => s + (parseInt(i.qty) || 0) * (parseFloat(i.price) || 0), 0);
  const setItem = (idx, key, val) => setItems((prev) => prev.map((it, i) => i === idx ? { ...it, [key]: val } : it));
  const addItem = () => setItems((prev) => [...prev, { ...EMPTY_ITEM }]);
  const removeItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx));

  // ── Template ──
  const loadTemplate = (tmpl) => {
    try {
      const parsed = JSON.parse(tmpl.items_json);
      setItems(parsed.map((it) => ({ ...it, price: String(it.price) })));
    } catch { toast("Invalid template", "error"); }
  };

  const handleSaveTemplate = async () => {
    if (!templateName.trim()) return;
    try {
      await invoke("save_order_template", {
        input: { name: templateName, shop_tag: shopObj?.domain || null, items_json: JSON.stringify(items) }
      });
      toast("Template saved", "success");
      setShowSaveTemplate(false);
      setTemplateName("");
    } catch (e) { toast(String(e), "error"); }
  };

  // ── Submit ──
  const handleCreate = async () => {
    if (!profileId || !shopId || !dropId) {
      toast("Profile, shop and drop are required", "warn");
      return;
    }
    setLoading(true);
    try {
      const itemsPayload = items
        .filter((i) => i.name.trim())
        .map((i) => ({ name: i.name, sku: i.sku, qty: parseInt(i.qty) || 1, price: parseFloat(i.price) || 0 }));

      await invoke("create_order", {
        input: {
          profile_id: profileId,
          shop_id: shopId,
          drop_id: dropId,
          email_pool_id: emailId || null,
          proxy_id: proxyId || null,
          order_number: orderNumber || null,
          notes: notes || null,
          items: itemsPayload,
        }
      });
      toast("Order created", "success");
      onCreated();
      onClose();
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  };

  const FLAGS = [
    { key: "requires_cvv_match", label: "CVV Match",    color: { color: "#60a5fa", background: "rgba(96,165,250,0.1)" } },
    { key: "blocks_vpn",         label: "Blocks VPN",   color: { color: "#f87171", background: "rgba(248,113,113,0.1)" } },
    { key: "phone_must_match",   label: "Phone Match",  color: { color: "#fbbf24", background: "rgba(251,191,36,0.1)" } },
    { key: "requires_avs",       label: "AVS",          color: { color: "#c084fc", background: "rgba(192,132,252,0.1)" } },
    { key: "high_cancel_risk",   label: "Cancel Risk",  color: { color: "#fb923c", background: "rgba(251,146,60,0.1)" } },
  ];

  const drops = profileDetail?.drops || [];
  const primaryDrop = drops.find((d) => d.is_primary) || drops[0];

  const inputStyle = {
    width: "100%", boxSizing: "border-box",
    background: "#0b0d14", border: "1px solid #1e2338",
    borderRadius: 12, padding: "10px 16px",
    fontSize: 13, color: "#e5e7eb",
    outline: "none", transition: "border-color 0.15s",
  };
  const smallInputStyle = {
    ...inputStyle, borderRadius: 8, padding: "7px 12px", fontSize: 12,
  };
  const dropdownStyle = {
    position: "absolute", left: 0, right: 0, top: "calc(100% + 4px)",
    zIndex: 20, background: "#171b28", border: "1px solid #1e2338",
    borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
    overflow: "hidden", maxHeight: 208, overflowY: "auto",
  };
  const dropdownBtnStyle = {
    width: "100%", textAlign: "left", padding: "10px 16px",
    background: "transparent", border: "none", borderBottom: "1px solid #1e2338",
    cursor: "pointer", color: "var(--text)",
  };

  return (
    <div className="modal-overlay" style={{ alignItems: "flex-start", overflowY: "auto", padding: "24px 0" }}>
      <div className="modal" style={{ width: 720, margin: "auto" }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 24px", borderBottom: "1px solid #1e2338",
          position: "sticky", top: 0, background: "#171b28", zIndex: 10,
          borderRadius: "12px 12px 0 0",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <ShoppingCart size={16} style={{ color: "#60a5fa" }} />
            <span style={{ fontWeight: 600, color: "#f3f4f6" }}>Create Order</span>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 20 }}>
          {/* ── 1. Profile ── */}
          <div>
            <label className="form-label">1. Profile *</label>
            <div style={{ position: "relative" }}>
              <input
                value={profileSearch}
                onChange={(e) => { setProfileSearch(e.target.value); setProfileId(""); setProfileDetail(null); }}
                placeholder="Search holder name, last4…"
                style={inputStyle}
              />
              {profileResults.length > 0 && (
                <div style={dropdownStyle}>
                  {profileResults.map((p) => (
                    <button key={p.id} onClick={() => selectProfile(p)} style={dropdownBtnStyle}
                      onMouseEnter={e => e.currentTarget.style.background = "#1e2338"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 13, color: "#e5e7eb" }}>{p.holder_masked || "—"}</span>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "#6b7280" }}>
                          <span style={{ fontFamily: "'JetBrains Mono',monospace" }}>···{p.last4}</span>
                          <span>{p.bank_name || ""}</span>
                          <span style={{ color: p.drop_count > 0 ? "#4ade80" : "#facc15" }}>
                            {p.drop_count} drop{p.drop_count !== 1 ? "s" : ""}
                          </span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Profile card */}
            {profileDetail && (
              <div style={{
                marginTop: 8, background: "#0b0d14", borderRadius: 12,
                border: "1px solid #1e2338", padding: "12px 16px",
                display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, fontSize: 12,
              }}>
                <div>
                  <div style={{ color: "#6b7280", marginBottom: 2 }}>Card</div>
                  <div style={{ color: "#e5e7eb", fontFamily: "'JetBrains Mono',monospace" }}>···{profileDetail.profile.last4 || profileDetail.card?.last4}</div>
                </div>
                <div>
                  <div style={{ color: "#6b7280", marginBottom: 2 }}>Bank</div>
                  <div style={{ color: "#e5e7eb" }}>{profileDetail.card?.bank_name || "—"}</div>
                </div>
                <div>
                  <div style={{ color: "#6b7280", marginBottom: 2 }}>Primary Drop</div>
                  <div style={{ color: "#e5e7eb", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {primaryDrop ? `${primaryDrop.city}, ${primaryDrop.country}` : "No drop"}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── 2. Shop ── */}
          <div>
            <label className="form-label">2. Shop *</label>
            <div style={{ position: "relative" }}>
              <input
                value={shopSearch}
                onChange={(e) => { setShopSearch(e.target.value); setShopId(null); setShopObj(null); }}
                placeholder="Search shops… or type new domain"
                style={inputStyle}
              />
              {shopResults.length > 0 && (
                <div style={dropdownStyle}>
                  {shopResults.map((s) => (
                    <button key={s.id} onClick={() => selectShop(s)} style={dropdownBtnStyle}
                      onMouseEnter={e => e.currentTarget.style.background = "#1e2338"}
                      onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                    >
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: 13, color: "#e5e7eb" }}>{s.name}</span>
                        <span style={{ fontSize: 12, color: "#6b7280", fontFamily: "'JetBrains Mono',monospace" }}>{s.domain}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Shop flags + smart suggestions */}
            {shopObj && (
              <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {FLAGS.filter((f) => shopObj[f.key]).map((f) => (
                    <span key={f.key} style={{
                      fontSize: 10, padding: "2px 8px", borderRadius: 999,
                      ...f.color,
                    }}>{f.label}</span>
                  ))}
                </div>
                {smartSuggs?.length > 0 && (
                  <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "#6b7280" }}>
                      <Sparkles size={11} /> Smart Suggestions
                    </div>
                    {smartSuggs.map((s, i) => <SuggestionBadge key={i} s={s} />)}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── 3. Drop ── */}
          {drops.length > 0 && (
            <div>
              <label className="form-label">3. Shipping Address</label>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {drops.map((d) => (
                  <label
                    key={d.id}
                    onClick={() => setDropId(d.id)}
                    style={{
                      display: "flex", alignItems: "center", gap: 12,
                      padding: "10px 12px", borderRadius: 12, cursor: "pointer",
                      border: dropId === d.id ? "1px solid rgba(96,165,250,0.4)" : "1px solid #1e2338",
                      background: dropId === d.id ? "rgba(96,165,250,0.1)" : "transparent",
                      transition: "border-color 0.15s, background 0.15s",
                    }}
                  >
                    <div style={{
                      width: 16, height: 16, borderRadius: "50%", flexShrink: 0,
                      border: dropId === d.id ? "none" : "1px solid #252a3d",
                      background: dropId === d.id ? "#2563eb" : "transparent",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      transition: "background 0.15s",
                    }}>
                      {dropId === d.id && <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#fff" }} />}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                        <span style={{ color: "#e5e7eb", fontWeight: 500 }}>{d.recipient_name}</span>
                        {d.is_primary && (
                          <span style={{ fontSize: 9, color: "#4ade80", background: "rgba(74,222,128,0.1)", padding: "1px 6px", borderRadius: 999 }}>primary</span>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "#6b7280" }}>
                        {d.address}, {d.city}{d.state ? `, ${d.state}` : ""} {d.zip}, {d.country}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* ── 4+5. Email + Proxy ── */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
            <div>
              <label className="form-label">4. Email (optional)</label>
              <select
                value={emailId || ""}
                onChange={(e) => setEmailId(e.target.value ? parseInt(e.target.value) : null)}
                style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, padding: "5px 10px", fontSize: 12, outline: "none", width: "100%" }}
              >
                <option value="">— None —</option>
                {emails.map((em) => {
                  const usedHere = em.shops_used?.some((s) => s.id === shopId);
                  return (
                    <option key={em.id} value={em.id} disabled={em.is_blocked}>
                      {em.is_blocked ? "🔴" : usedHere ? "⚠️" : "✓"} {em.email} {em.label ? `(${em.label})` : ""}
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="form-label">5. Proxy (optional)</label>
              <select
                value={proxyId || ""}
                onChange={(e) => setProxyId(e.target.value ? parseInt(e.target.value) : null)}
                style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, padding: "5px 10px", fontSize: 12, outline: "none", width: "100%" }}
              >
                <option value="">— None —</option>
                {proxies.map((px) => {
                  const usedHere = px.shops_used?.some((s) => s.id === shopId);
                  return (
                    <option key={px.id} value={px.id} disabled={px.is_blocked}>
                      {px.is_blocked ? "🔴" : usedHere ? "⚠️" : "✓"} {px.label || `${px.host}:${px.port}`} ({px.proxy_type.toUpperCase()})
                    </option>
                  );
                })}
              </select>
            </div>
          </div>

          {/* ── 6. Risk Check ── */}
          <div>
            <label className="form-label">6. Risk Check</label>
            <RiskBlock result={riskResult} loading={riskLoading} />
          </div>

          {/* ── 7. Order number ── */}
          <div>
            <label className="form-label">7. Order Number (optional)</label>
            <input
              value={orderNumber}
              onChange={(e) => setOrderNumber(e.target.value)}
              placeholder="ORD-12345"
              style={{ ...inputStyle, fontFamily: "'JetBrains Mono',monospace" }}
            />
          </div>

          {/* ── 8. Items ── */}
          <div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <label className="form-label" style={{ marginBottom: 0 }}>8. Items</label>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {/* Load template */}
                {templates.length > 0 && (
                  <div style={{ position: "relative" }} className="template-group">
                    <button
                      style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#6b7280", background: "none", border: "none", cursor: "pointer" }}
                      onMouseEnter={e => {
                        e.currentTarget.style.color = "#d1d5db";
                        e.currentTarget.nextSibling.style.display = "block";
                      }}
                      onMouseLeave={e => {
                        e.currentTarget.style.color = "#6b7280";
                      }}
                    >
                      <FolderOpen size={12} /> Templates
                    </button>
                    <div style={{
                      position: "absolute", right: 0, top: "100%", marginTop: 4,
                      display: "none", zIndex: 20,
                      background: "#171b28", border: "1px solid #1e2338",
                      borderRadius: 12, boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
                      minWidth: 180, overflow: "hidden",
                    }}
                      onMouseEnter={e => e.currentTarget.style.display = "block"}
                      onMouseLeave={e => e.currentTarget.style.display = "none"}
                    >
                      {templates.map((t) => (
                        <button key={t.id} onClick={() => loadTemplate(t)}
                          style={{ width: "100%", textAlign: "left", padding: "8px 12px", fontSize: 12, color: "#d1d5db", background: "transparent", border: "none", borderBottom: "1px solid #1e2338", cursor: "pointer" }}
                          onMouseEnter={e => e.currentTarget.style.background = "#1e2338"}
                          onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                        >
                          {t.name}{t.shop_tag && <span style={{ color: "#4b5563", marginLeft: 4 }}>({t.shop_tag})</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <button
                  onClick={() => setShowSaveTemplate(true)}
                  style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#6b7280", background: "none", border: "none", cursor: "pointer" }}
                  onMouseEnter={e => e.currentTarget.style.color = "#d1d5db"}
                  onMouseLeave={e => e.currentTarget.style.color = "#6b7280"}
                >
                  <Save size={12} /> Save Template
                </button>
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {items.map((item, idx) => (
                <div key={idx} style={{ display: "grid", gridTemplateColumns: "4fr 3fr 2fr 2fr 1fr", gap: 8, alignItems: "center" }}>
                  <input value={item.name} onChange={(e) => setItem(idx, "name", e.target.value)} placeholder="Product name" style={smallInputStyle} />
                  <input value={item.sku} onChange={(e) => setItem(idx, "sku", e.target.value)} placeholder="SKU" style={{ ...smallInputStyle, fontFamily: "'JetBrains Mono',monospace" }} />
                  <input type="number" min="1" value={item.qty} onChange={(e) => setItem(idx, "qty", e.target.value)} placeholder="Qty" style={{ ...smallInputStyle, fontFamily: "'JetBrains Mono',monospace" }} />
                  <input type="number" step="0.01" value={item.price} onChange={(e) => setItem(idx, "price", e.target.value)} placeholder="$0.00" style={{ ...smallInputStyle, fontFamily: "'JetBrains Mono',monospace" }} />
                  <button
                    onClick={() => removeItem(idx)}
                    disabled={items.length === 1}
                    style={{ padding: 8, color: "#4b5563", background: "none", border: "none", cursor: items.length === 1 ? "not-allowed" : "pointer", opacity: items.length === 1 ? 0.3 : 1 }}
                    onMouseEnter={e => { if (items.length > 1) e.currentTarget.style.color = "#f87171"; }}
                    onMouseLeave={e => e.currentTarget.style.color = "#4b5563"}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 8 }}>
              <button
                onClick={addItem}
                style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12, color: "#60a5fa", background: "none", border: "none", cursor: "pointer" }}
                onMouseEnter={e => e.currentTarget.style.color = "#93c5fd"}
                onMouseLeave={e => e.currentTarget.style.color = "#60a5fa"}
              >
                <Plus size={12} /> Add Item
              </button>
              {total > 0 && (
                <div style={{ fontSize: 12, color: "#9ca3af" }}>
                  Total: <span style={{ color: "#f3f4f6", fontWeight: 500, fontFamily: "'JetBrains Mono',monospace" }}>${total.toFixed(2)}</span>
                </div>
              )}
            </div>

            {/* Save template inline dialog */}
            {showSaveTemplate && (
              <div style={{
                marginTop: 12, background: "#0b0d14", borderRadius: 12,
                border: "1px solid #1e2338", padding: 12,
                display: "flex", alignItems: "center", gap: 8,
              }}>
                <input
                  value={templateName}
                  onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Template name…"
                  style={{ ...smallInputStyle, flex: 1, width: "auto", background: "transparent" }}
                />
                <button
                  onClick={handleSaveTemplate}
                  disabled={!templateName.trim()}
                  className="btn btn-b btn-sm"
                  style={{ opacity: !templateName.trim() ? 0.4 : 1 }}
                >
                  Save
                </button>
                <button
                  onClick={() => setShowSaveTemplate(false)}
                  style={{ color: "#6b7280", background: "none", border: "none", cursor: "pointer" }}
                  onMouseEnter={e => e.currentTarget.style.color = "#d1d5db"}
                  onMouseLeave={e => e.currentTarget.style.color = "#6b7280"}
                >
                  <X size={14} />
                </button>
              </div>
            )}
          </div>

          {/* ── 9. Notes ── */}
          <div>
            <label className="form-label">9. Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={2}
              style={{ ...inputStyle, resize: "none" }}
            />
          </div>

          {/* ── Submit ── */}
          <button
            onClick={handleCreate}
            disabled={loading || !profileId || !shopId || !dropId}
            className="btn btn-b"
            style={{
              width: "100%", padding: "12px 0", fontSize: 14,
              opacity: (loading || !profileId || !shopId || !dropId) ? 0.4 : 1,
              cursor: (loading || !profileId || !shopId || !dropId) ? "not-allowed" : "pointer",
            }}
          >
            {loading ? "Creating…" : "Create Order →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Pagination helper ────────────────────────────────────────
function buildPageNumbers(current, total) {
  if (total <= 7) return Array.from({length: total}, (_, i) => i+1);
  const pages = [1];
  if (current > 3) pages.push("…");
  for (let p = Math.max(2, current-1); p <= Math.min(total-1, current+1); p++) pages.push(p);
  if (current < total - 2) pages.push("…");
  pages.push(total);
  return pages;
}

// ─── Main OrderList ───────────────────────────────────────────
export default function OrderList({ onNavigate, activeTab = "list", openCreate = false }) {
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState({ status: "", shop_id: null, date_from: "", date_to: "", search: "" });
  const [showCreate, setShowCreate] = useState(false);
  const [statusMenuId, setStatusMenuId] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [shopOptions, setShopOptions] = useState([]);
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const PER_PAGE = 50;

  const load = useCallback(async (p = page, f = filter) => {
    setLoading(true);
    try {
      const r = await invoke("get_orders", {
        filter: {
          status: f.status || null,
          shop_id: f.shop_id || null,
          date_from: f.date_from || null,
          date_to: f.date_to || null,
          search: f.search || null,
        },
        page: p,
        perPage: PER_PAGE,
      });
      setOrders(r.items);
      setTotal(r.total);
      if (r.items.length === 0 && r.total > 0 && p > 1) {
        setPage((prev) => Math.max(1, prev - 1));
      }
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => {
    load();
    invoke("get_shops", { page: 1, perPage: 200, search: "" })
      .then((r) => setShopOptions(r.items ?? []))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (activeTab === "pending") setFilter(f => ({ ...f, status: "pending" }));
    else if (activeTab === "delivered") setFilter(f => ({ ...f, status: "delivered" }));
    else setFilter(f => ({ ...f, status: "" }));
    setPage(1);
  }, [activeTab]);

  useEffect(() => {
    if (openCreate) setShowCreate(true);
  }, [openCreate]);

  const handleDelete = async (o) => {
    const ok = await confirm(`Delete order #${o.order_number || o.id}?`, { danger: true });
    if (!ok) return;
    try {
      await invoke("delete_order", { id: o.id });
      toast("Order deleted", "success");
      load();
    } catch (e) { toast(String(e), "error"); }
  };

  const setFilterVal = (key, val) => setFilter((f) => ({ ...f, [key]: val }));
  const totalPages = Math.ceil(total / PER_PAGE);

  // Close status menu on outside click
  useEffect(() => {
    if (!statusMenuId) return;
    const handler = () => setStatusMenuId(null);
    document.addEventListener("click", handler, true);
    return () => document.removeEventListener("click", handler, true);
  }, [statusMenuId]);

  return (
    <div className="content">
      {/* Header */}
      <div className="ph">
        <div><div className="ph-title">📦 Orders</div></div>
        <div className="ph-actions">
          <button className="btn btn-g" onClick={() => setShowCreate(true)}>+ New Order</button>
          <button className="btn btn-ghost btn-sm">Export</button>
        </div>
      </div>

      {/* Filters */}
      <div className="filters">
        <button className={`flt${!filter.status ? " active" : ""}`} onClick={() => { const f = { ...filter, status: "" }; setFilter(f); load(1, f); }}>All</button>
        <button className={`flt${filter.status === "pending" ? " active" : ""}`} onClick={() => { const f = { ...filter, status: "pending" }; setFilter(f); load(1, f); }}>Pending</button>
        <button className={`flt${filter.status === "processing" ? " active" : ""}`} onClick={() => { const f = { ...filter, status: "processing" }; setFilter(f); load(1, f); }}>Processing</button>
        <button className={`flt${filter.status === "shipped" ? " active" : ""}`} onClick={() => { const f = { ...filter, status: "shipped" }; setFilter(f); load(1, f); }}>Shipped</button>
        <button className={`flt${filter.status === "in_transit" ? " active" : ""}`} onClick={() => { const f = { ...filter, status: "in_transit" }; setFilter(f); load(1, f); }}>In Transit</button>
        <button className={`flt${filter.status === "delivered" ? " active" : ""}`} onClick={() => { const f = { ...filter, status: "delivered" }; setFilter(f); load(1, f); }}>Delivered</button>
        <button className={`flt${filter.status === "declined" ? " active" : ""}`} onClick={() => { const f = { ...filter, status: "declined" }; setFilter(f); load(1, f); }}>Declined</button>
        <button className={`flt${filter.status === "cancelled" ? " active" : ""}`} onClick={() => { const f = { ...filter, status: "cancelled" }; setFilter(f); load(1, f); }}>Cancelled</button>
        <select
          value={filter.shop_id || ""}
          onChange={(e) => { const v = e.target.value ? parseInt(e.target.value) : null; const f = { ...filter, shop_id: v }; setFilter(f); load(1, f); }}
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, padding: "5px 10px", fontSize: 12, outline: "none" }}
        >
          <option value="">All Shops</option>
          {shopOptions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <input
          className="search-box"
          placeholder="🔍  order number, profile..."
          value={filter.search}
          onChange={(e) => setFilterVal("search", e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load(1, filter)}
        />
        {(filter.status || filter.search || filter.date_from || filter.date_to || filter.shop_id) && (
          <button className="btn btn-ghost btn-sm" onClick={() => { const f = { status: "", shop_id: null, date_from: "", date_to: "", search: "" }; setFilter(f); load(1, f); }}>
            Reset
          </button>
        )}
      </div>

      {/* Table */}
      <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th><input type="checkbox" /></th>
              <th>Order #</th>
              <th>Holder / Card</th>
              <th>Shop</th>
              <th>Status</th>
              <th>Amount</th>
              <th>Tracking</th>
              <th>Carrier</th>
              <th>Proxy</th>
              <th>Email</th>
              <th>Notes</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {loading && orders.length === 0 && (
              <SkeletonRows count={6} cols={13} />
            )}
            {orders.length === 0 && !loading && (
              <tr>
                <td colSpan={11} style={{ textAlign: "center", padding: "48px 0", color: "var(--muted)" }}>
                  No orders found
                </td>
              </tr>
            )}
            {orders.map((o) => (
              <>
                <tr key={o.id} onClick={() => setExpandedId(expandedId === o.id ? null : o.id)} style={{ cursor: "pointer" }}>
                  <td onClick={(e) => e.stopPropagation()}><input type="checkbox" /></td>
                  <td>
                    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>
                      {o.order_number || `#${o.id}`}
                      {o.order_number && <CopyNumberBtn value={o.order_number} />}
                    </span>
                  </td>
                  <td>
                    <div style={{ fontSize: 12 }}>{o.holder_masked || "—"}</div>
                    <div style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "var(--muted)" }}>···{o.last4 || "????"}</div>
                  </td>
                  <td>{o.shop_name || "—"}</td>
                  <td><span className={`st st-${o.status}`}>{o.status}</span></td>
                  <td style={{ color: "#c084fc", fontFamily: "'JetBrains Mono',monospace" }}>
                    {o.total_amount != null ? `$${o.total_amount.toFixed(2)}` : "—"}
                  </td>
                  <td style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10, color: "var(--muted)" }}>{o.tracking_number ?? "—"}</td>
                  <td style={{ fontSize: 11, color: "var(--muted)" }}>{o.carrier ?? "—"}</td>
                  <td style={{ fontSize: 11, color: "var(--muted)" }}>{o.proxy_label ?? "—"}</td>
                  <td style={{ fontSize: 11, color: "var(--muted)" }}>{o.email_addr ?? "—"}</td>
                  <td style={{ fontSize: 11, color: "var(--muted)", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={o.notes ?? ""}>{o.notes ?? "—"}</td>
                  <td style={{ fontSize: 11, color: "var(--muted)" }}>{o.created_at?.slice(0, 10)}</td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="tbl-actions">
                      <div style={{ position: "relative" }}>
                        <button
                          className="btn btn-ghost btn-sm"
                          onClick={(e) => { e.stopPropagation(); setStatusMenuId(statusMenuId === o.id ? null : o.id); }}
                          title="Change status"
                        >
                          Status
                        </button>
                        {statusMenuId === o.id && (
                          <StatusMenu order={o} onUpdate={() => load()} onClose={() => setStatusMenuId(null)} />
                        )}
                      </div>
                      <button className="btn btn-r btn-sm" onClick={(e) => { e.stopPropagation(); handleDelete(o); }}>Del</button>
                    </div>
                  </td>
                </tr>
                {expandedId === o.id && (
                  <tr key={`${o.id}-timeline`}>
                    <td colSpan={11} style={{ padding: "12px 16px 16px", background: "#12151f", borderBottom: "1px solid var(--border)" }}>
                      <OrderTimeline status={o.status} />
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{total} orders</span>
          <div style={{ display: "flex", gap: 4 }}>
            {buildPageNumbers(page, totalPages).map((p, i) =>
              p === "…" ? (
                <span key={`ellipsis-${i}`} style={{ padding: "4px 8px", fontSize: 12, color: "var(--muted)" }}>…</span>
              ) : (
                <button key={p} onClick={() => { setPage(p); load(p, filter); }}
                  className={`btn btn-ghost btn-sm${page === p ? " active" : ""}`}
                  style={page === p ? { background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" } : {}}>
                  {p}
                </button>
              )
            )}
          </div>
        </div>
      )}

      {showCreate && (
        <CreateOrderModal onCreated={() => load()} onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}
