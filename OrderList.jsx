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
import { useSmartSuggestions, SuggestionBadge } from "./ShopList";

// ─── Constants ───────────────────────────────────────────────
const STATUSES = ["pending", "processing", "shipped", "delivered", "declined", "cancelled"];
const STATUS_COLORS = {
  pending:    "bg-yellow-500/20 text-yellow-300 border-yellow-500/20",
  processing: "bg-blue-500/20 text-blue-300 border-blue-500/20",
  shipped:    "bg-purple-500/20 text-purple-300 border-purple-500/20",
  delivered:  "bg-green-500/20 text-green-400 border-green-500/20",
  declined:   "bg-red-500/20 text-red-400 border-red-500/20",
  cancelled:  "bg-gray-500/20 text-gray-400 border-gray-500/20",
};
const STATUS_ROW = {
  delivered: "border-green-500/10",
  declined:  "border-red-500/10 bg-red-500/5",
  shipped:   "border-purple-500/10",
};

// ─── Risk Check display ───────────────────────────────────────
function RiskBlock({ result, loading }) {
  const [open, setOpen] = useState(false);

  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-[#0f1117] border border-[#2a2d3a] text-xs text-gray-500">
        <div className="w-3 h-3 border border-gray-600 border-t-gray-400 rounded-full animate-spin" />
        Checking risk…
      </div>
    );
  }
  if (!result) return null;

  const config = {
    safe:      { color: "border-green-500/20 bg-green-500/5",  icon: <CheckCircle2 size={14} className="text-green-400" />, label: "Safe",      text: "text-green-400" },
    warning:   { color: "border-yellow-500/20 bg-yellow-500/5", icon: <AlertTriangle size={14} className="text-yellow-400" />, label: `Warning: ${result.score} issue${result.score !== 1 ? "s" : ""}`, text: "text-yellow-400" },
    high_risk: { color: "border-red-500/20 bg-red-500/5",      icon: <ShieldAlert size={14} className="text-red-400" />,    label: `High Risk: ${result.score} issue${result.score !== 1 ? "s" : ""}`, text: "text-red-400" },
  };
  const c = config[result.level] || config.safe;

  return (
    <div className={`rounded-xl border ${c.color} overflow-hidden`}>
      <button
        onClick={() => result.warnings?.length && setOpen((o) => !o)}
        className="flex items-center justify-between w-full px-3 py-2.5 text-xs"
      >
        <div className="flex items-center gap-2">
          {c.icon}
          <span className={`font-medium ${c.text}`}>{c.label}</span>
          {result.offline && (
            <span className="flex items-center gap-1 text-yellow-500/70">
              <Wifi size={11} /> Offline
            </span>
          )}
        </div>
        {result.warnings?.length > 0 && (
          <ChevronDown size={13} className={`text-gray-500 transition-transform ${open ? "rotate-180" : ""}`} />
        )}
      </button>
      {open && result.warnings?.length > 0 && (
        <div className="border-t border-[#2a2d3a] divide-y divide-[#2a2d3a]">
          {result.warnings.map((w, i) => (
            <div key={i} className="px-3 py-2 flex items-start gap-2 text-xs">
              {w.severity === "high"
                ? <AlertTriangle size={11} className="text-red-400 mt-0.5 flex-shrink-0" />
                : <AlertCircle size={11} className="text-yellow-400 mt-0.5 flex-shrink-0" />
              }
              <span className="text-gray-300">{w.message}</span>
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60]">
      <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-2xl w-80 shadow-2xl p-6 space-y-4">
        <div className="flex items-center gap-2 mb-2">
          <Truck size={16} className="text-purple-400" />
          <span className="font-semibold text-gray-100">Mark as Shipped</span>
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">Tracking Number</label>
          <input value={track} onChange={(e) => setTrack(e.target.value)} placeholder="1Z999AA10123456784"
            className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 font-mono placeholder-gray-600 focus:outline-none focus:border-purple-500/50 transition-colors" />
        </div>
        <div>
          <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">Carrier</label>
          <input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="UPS, FedEx, USPS…"
            className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500/50 transition-colors" />
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-2 text-xs text-gray-400 hover:text-gray-200 transition-colors">Cancel</button>
          <button onClick={() => onConfirm({ tracking_number: track || null, carrier: carrier || null })}
            className="flex-1 py-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-medium transition-colors">
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
        if (markDead) await invoke("update_card_status", { id: order.profile_id, status: "dead" });
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
      <div className="absolute right-0 top-8 z-30 bg-[#1a1d27] border border-[#2a2d3a] rounded-xl shadow-xl overflow-hidden w-40">
        {STATUSES.filter((s) => s !== order.status).map((s) => (
          <button key={s} onClick={() => handleStatus(s)}
            className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-[#2a2d3a] transition-colors flex items-center gap-2">
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_COLORS[s]?.replace("bg-", "bg-").split(" ")[0].replace("/20", "/60") || "bg-gray-500"}`} />
            {s.charAt(0).toUpperCase() + s.slice(1)}
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
    { key: "requires_cvv_match", label: "CVV Match", color: "text-blue-400 bg-blue-500/10" },
    { key: "blocks_vpn", label: "Blocks VPN", color: "text-red-400 bg-red-500/10" },
    { key: "phone_must_match", label: "Phone Match", color: "text-yellow-400 bg-yellow-500/10" },
    { key: "requires_avs", label: "AVS", color: "text-purple-400 bg-purple-500/10" },
    { key: "high_cancel_risk", label: "Cancel Risk", color: "text-orange-400 bg-orange-500/10" },
  ];

  const drops = profileDetail?.drops || [];
  const primaryDrop = drops.find((d) => d.is_primary) || drops[0];

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-start justify-center z-50 overflow-y-auto py-6">
      <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-2xl w-[720px] shadow-2xl my-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a] sticky top-0 bg-[#1a1d27] z-10 rounded-t-2xl">
          <div className="flex items-center gap-2">
            <ShoppingCart size={16} className="text-blue-400" />
            <span className="font-semibold text-gray-100">Create Order</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors"><X size={18} /></button>
        </div>

        <div className="p-6 space-y-5">
          {/* ── 1. Profile ── */}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-2">1. Profile *</label>
            <div className="relative">
              <input
                value={profileSearch}
                onChange={(e) => { setProfileSearch(e.target.value); setProfileId(""); setProfileDetail(null); }}
                placeholder="Search holder name, last4…"
                className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
              />
              {profileResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-[#1a1d27] border border-[#2a2d3a] rounded-xl shadow-xl overflow-hidden max-h-52 overflow-y-auto">
                  {profileResults.map((p) => (
                    <button key={p.id} onClick={() => selectProfile(p)}
                      className="w-full text-left px-4 py-2.5 hover:bg-[#2a2d3a] transition-colors border-b border-[#2a2d3a] last:border-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-200">{p.holder_masked || "—"}</span>
                        <div className="flex items-center gap-2 text-xs text-gray-500">
                          <span className="font-mono">···{p.last4}</span>
                          <span>{p.bank_name || ""}</span>
                          <span className={p.drop_count > 0 ? "text-green-400" : "text-yellow-400"}>
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
              <div className="mt-2 bg-[#0f1117] rounded-xl border border-[#2a2d3a] px-4 py-3 grid grid-cols-3 gap-3 text-xs">
                <div>
                  <div className="text-gray-500 mb-0.5">Card</div>
                  <div className="text-gray-200 font-mono">···{profileDetail.profile.last4 || profileDetail.card?.last4}</div>
                </div>
                <div>
                  <div className="text-gray-500 mb-0.5">Bank</div>
                  <div className="text-gray-200">{profileDetail.card?.bank_name || "—"}</div>
                </div>
                <div>
                  <div className="text-gray-500 mb-0.5">Primary Drop</div>
                  <div className="text-gray-200 truncate">
                    {primaryDrop ? `${primaryDrop.city}, ${primaryDrop.country}` : "No drop"}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* ── 2. Shop ── */}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-2">2. Shop *</label>
            <div className="relative">
              <input
                value={shopSearch}
                onChange={(e) => { setShopSearch(e.target.value); setShopId(null); setShopObj(null); }}
                placeholder="Search shops… or type new domain"
                className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
              />
              {shopResults.length > 0 && (
                <div className="absolute left-0 right-0 top-full mt-1 z-20 bg-[#1a1d27] border border-[#2a2d3a] rounded-xl shadow-xl overflow-hidden">
                  {shopResults.map((s) => (
                    <button key={s.id} onClick={() => selectShop(s)}
                      className="w-full text-left px-4 py-2.5 hover:bg-[#2a2d3a] transition-colors border-b border-[#2a2d3a] last:border-0">
                      <div className="flex items-center justify-between">
                        <span className="text-sm text-gray-200">{s.name}</span>
                        <span className="text-xs text-gray-500 font-mono">{s.domain}</span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
            {/* Shop flags + smart suggestions */}
            {shopObj && (
              <div className="mt-2 space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {FLAGS.filter((f) => shopObj[f.key]).map((f) => (
                    <span key={f.key} className={`text-[10px] px-2 py-0.5 rounded-full ${f.color}`}>{f.label}</span>
                  ))}
                </div>
                {smartSuggs?.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-gray-500">
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
              <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-2">3. Shipping Address</label>
              <div className="space-y-1.5">
                {drops.map((d) => (
                  <label key={d.id} onClick={() => setDropId(d.id)}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                      dropId === d.id ? "border-blue-500/40 bg-blue-500/10" : "border-[#2a2d3a] hover:border-[#3a3d4a]"
                    }`}>
                    <div className={`w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 transition-colors ${dropId === d.id ? "bg-blue-600 border-blue-600" : "border-[#3a3d4a]"}`}>
                      {dropId === d.id && <div className="w-2 h-2 rounded-full bg-white" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 text-xs">
                        <span className="text-gray-200 font-medium">{d.recipient_name}</span>
                        {d.is_primary && <span className="text-[9px] text-green-400 bg-green-500/10 px-1.5 rounded-full">primary</span>}
                      </div>
                      <div className="text-[11px] text-gray-500">{d.address}, {d.city}{d.state ? `, ${d.state}` : ""} {d.zip}, {d.country}</div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
          )}

          {/* ── 4+5. Email + Proxy ── */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-2">4. Email (optional)</label>
              <select
                value={emailId || ""}
                onChange={(e) => setEmailId(e.target.value ? parseInt(e.target.value) : null)}
                className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500/50 transition-colors"
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
              <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-2">5. Proxy (optional)</label>
              <select
                value={proxyId || ""}
                onChange={(e) => setProxyId(e.target.value ? parseInt(e.target.value) : null)}
                className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-3 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500/50 transition-colors"
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
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-2">6. Risk Check</label>
            <RiskBlock result={riskResult} loading={riskLoading} />
          </div>

          {/* ── 7. Order number ── */}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-2">7. Order Number (optional)</label>
            <input value={orderNumber} onChange={(e) => setOrderNumber(e.target.value)} placeholder="ORD-12345"
              className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 font-mono placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors" />
          </div>

          {/* ── 8. Items ── */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-[10px] uppercase tracking-widest text-gray-500">8. Items</label>
              <div className="flex items-center gap-2">
                {/* Load template */}
                {templates.length > 0 && (
                  <div className="relative group">
                    <button className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors">
                      <FolderOpen size={12} /> Templates
                    </button>
                    <div className="absolute right-0 top-full mt-1 hidden group-hover:block z-20 bg-[#1a1d27] border border-[#2a2d3a] rounded-xl shadow-xl min-w-[180px] overflow-hidden">
                      {templates.map((t) => (
                        <button key={t.id} onClick={() => loadTemplate(t)}
                          className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-[#2a2d3a] transition-colors border-b border-[#2a2d3a] last:border-0">
                          {t.name}{t.shop_tag && <span className="text-gray-600 ml-1">({t.shop_tag})</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                <button onClick={() => setShowSaveTemplate(true)}
                  className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors">
                  <Save size={12} /> Save Template
                </button>
              </div>
            </div>

            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                  <input value={item.name} onChange={(e) => setItem(idx, "name", e.target.value)} placeholder="Product name"
                    className="col-span-4 bg-[#0f1117] border border-[#2a2d3a] rounded-lg px-3 py-2 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors" />
                  <input value={item.sku} onChange={(e) => setItem(idx, "sku", e.target.value)} placeholder="SKU"
                    className="col-span-3 bg-[#0f1117] border border-[#2a2d3a] rounded-lg px-3 py-2 text-xs text-gray-200 font-mono placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors" />
                  <input type="number" min="1" value={item.qty} onChange={(e) => setItem(idx, "qty", e.target.value)} placeholder="Qty"
                    className="col-span-2 bg-[#0f1117] border border-[#2a2d3a] rounded-lg px-3 py-2 text-xs text-gray-200 font-mono placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors" />
                  <input type="number" step="0.01" value={item.price} onChange={(e) => setItem(idx, "price", e.target.value)} placeholder="$0.00"
                    className="col-span-2 bg-[#0f1117] border border-[#2a2d3a] rounded-lg px-3 py-2 text-xs text-gray-200 font-mono placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors" />
                  <button onClick={() => removeItem(idx)} disabled={items.length === 1}
                    className="col-span-1 p-2 text-gray-600 hover:text-red-400 transition-colors disabled:opacity-30">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
            <div className="flex items-center justify-between mt-2">
              <button onClick={addItem} className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors">
                <Plus size={12} /> Add Item
              </button>
              {total > 0 && (
                <div className="text-xs text-gray-400">
                  Total: <span className="text-gray-100 font-medium font-mono">${total.toFixed(2)}</span>
                </div>
              )}
            </div>

            {/* Save template inline dialog */}
            {showSaveTemplate && (
              <div className="mt-3 bg-[#0f1117] rounded-xl border border-[#2a2d3a] p-3 flex items-center gap-2">
                <input value={templateName} onChange={(e) => setTemplateName(e.target.value)}
                  placeholder="Template name…"
                  className="flex-1 bg-transparent border border-[#2a2d3a] rounded-lg px-3 py-1.5 text-xs text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors" />
                <button onClick={handleSaveTemplate} disabled={!templateName.trim()}
                  className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white transition-colors">
                  Save
                </button>
                <button onClick={() => setShowSaveTemplate(false)} className="text-gray-500 hover:text-gray-300 transition-colors"><X size={14} /></button>
              </div>
            )}
          </div>

          {/* ── 9. Notes ── */}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-2">9. Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2}
              className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 resize-none transition-colors" />
          </div>

          {/* ── Submit ── */}
          <button onClick={handleCreate}
            disabled={loading || !profileId || !shopId || !dropId}
            className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors">
            {loading ? "Creating…" : "Create Order →"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main OrderList ───────────────────────────────────────────
export default function OrderList() {
  const [orders, setOrders] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState({ status: "", shop_id: null, date_from: "", date_to: "", search: "" });
  const [showCreate, setShowCreate] = useState(false);
  const [statusMenuId, setStatusMenuId] = useState(null);
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
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => { load(); }, []);

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
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a]">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-gray-100">Orders</h1>
          <span className="text-xs bg-[#2a2d3a] text-gray-400 px-2 py-0.5 rounded-full">{total}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => load()} className="p-1.5 text-gray-500 hover:text-gray-300 rounded-lg border border-[#2a2d3a] hover:border-[#3a3d4a] transition-colors">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors">
            <Plus size={14} /> New Order
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-[#2a2d3a] bg-[#0f1117]/40 flex-wrap">
        {/* Status */}
        <select
          value={filter.status}
          onChange={(e) => { setFilterVal("status", e.target.value); load(1, { ...filter, status: e.target.value }); }}
          className="bg-[#1a1d27] border border-[#2a2d3a] rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none"
        >
          <option value="">All Statuses</option>
          {STATUSES.map((s) => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
        </select>

        {/* Date range */}
        <input type="date" value={filter.date_from} onChange={(e) => setFilterVal("date_from", e.target.value)}
          className="bg-[#1a1d27] border border-[#2a2d3a] rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none" />
        <span className="text-gray-600 text-xs">–</span>
        <input type="date" value={filter.date_to} onChange={(e) => setFilterVal("date_to", e.target.value)}
          className="bg-[#1a1d27] border border-[#2a2d3a] rounded-lg px-3 py-1.5 text-xs text-gray-300 focus:outline-none" />

        {/* Search */}
        <div className="relative flex-1 max-w-xs">
          <Search size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={filter.search}
            onChange={(e) => setFilterVal("search", e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load(1, filter)}
            placeholder="Order # or last4… (Enter)"
            className="w-full bg-[#1a1d27] border border-[#2a2d3a] rounded-lg pl-8 pr-3 py-1.5 text-xs text-gray-300 placeholder-gray-600 focus:outline-none"
          />
        </div>

        {/* Reset */}
        {(filter.status || filter.search || filter.date_from || filter.date_to) && (
          <button onClick={() => { const f = { status:"",shop_id:null,date_from:"",date_to:"",search:"" }; setFilter(f); load(1, f); }}
            className="text-xs text-gray-500 hover:text-gray-300 transition-colors flex items-center gap-1">
            <X size={11} /> Reset
          </button>
        )}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#0f1117] z-10">
            <tr className="border-b border-[#2a2d3a]">
              {["Flags", "Order #", "Profile", "Shop", "Status", "Amount", "Tracking", "Date", "Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[11px] uppercase tracking-widest text-gray-500 font-medium whitespace-nowrap">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {orders.length === 0 && !loading && (
              <tr>
                <td colSpan={9} className="text-center py-20 text-gray-600">
                  <ShoppingCart size={36} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No orders found</p>
                </td>
              </tr>
            )}
            {orders.map((o) => (
              <tr key={o.id}
                className={`border-b transition-colors group hover:brightness-110 ${STATUS_ROW[o.status] || "border-[#2a2d3a]"}`}>
                {/* Flags */}
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1">
                    {o.pending_too_long && (
                      <span title="Pending too long"><Clock size={13} className="text-yellow-400" /></span>
                    )}
                    {o.card_expiring && (
                      <span title="Card expiring soon"><CreditCard size={13} className="text-orange-400" /></span>
                    )}
                    {o.bin_declined_here && (
                      <span title="BIN declined here before"><AlertTriangle size={13} className="text-red-400" /></span>
                    )}
                    {!o.pending_too_long && !o.card_expiring && !o.bin_declined_here && (
                      <span className="text-gray-700">—</span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono text-xs text-gray-300">{o.order_number || <span className="text-gray-600">#{o.id}</span>}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="text-xs text-gray-200">{o.holder_masked || "—"}</div>
                  <div className="text-[11px] text-gray-500 font-mono">···{o.last4 || "????"}</div>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-gray-300">{o.shop_name || "—"}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center px-2 py-0.5 text-[10px] rounded-full border ${STATUS_COLORS[o.status] || "bg-gray-500/20 text-gray-400 border-gray-500/20"}`}>
                    {o.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs font-mono text-gray-300">{o.total_amount != null ? `$${o.total_amount.toFixed(2)}` : "—"}</span>
                </td>
                <td className="px-4 py-3">
                  {o.tracking_number ? (
                    <span className="text-xs font-mono text-blue-400 truncate max-w-[100px] block">{o.tracking_number}</span>
                  ) : <span className="text-gray-600 text-xs">—</span>}
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-gray-500">{o.created_at?.slice(0, 10)}</span>
                </td>
                <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {/* Status change */}
                    <div className="relative">
                      <button
                        onClick={() => setStatusMenuId(statusMenuId === o.id ? null : o.id)}
                        className="p-1.5 text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 rounded transition-colors"
                        title="Change status"
                      >
                        <Edit2 size={12} />
                      </button>
                      {statusMenuId === o.id && (
                        <StatusMenu order={o} onUpdate={() => load()} onClose={() => setStatusMenuId(null)} />
                      )}
                    </div>
                    <button onClick={() => handleDelete(o)}
                      className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors">
                      <Trash2 size={12} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-[#2a2d3a] bg-[#0f1117]/60">
          <span className="text-xs text-gray-500">{total} orders</span>
          <div className="flex gap-1">
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i + 1).map((p) => (
              <button key={p} onClick={() => { setPage(p); load(p, filter); }}
                className={`w-8 h-8 text-xs rounded-lg transition-colors ${page === p ? "bg-blue-600 text-white" : "text-gray-500 hover:bg-[#2a2d3a] hover:text-gray-200"}`}>
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {showCreate && (
        <CreateOrderModal onCreated={() => load()} onClose={() => setShowCreate(false)} />
      )}
    </div>
  );
}
