import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Store, Plus, ExternalLink, Edit2, Trash2, RefreshCw, Search,
  X, ChevronRight, Package, TrendingUp, TrendingDown, BarChart2,
  ShieldAlert, Wifi, Phone, CreditCard, AlertTriangle, CheckCircle2,
  Info, Sparkles, DollarSign, ShoppingCart, Tag
} from "lucide-react";
import { useLang } from "../hooks/useLang";
import { useToast } from "../hooks/useToast";
import { useConfirm } from "../hooks/useConfirm";

// ─── Flag definitions ─────────────────────────────────────────
const FLAGS = [
  { key: "requires_cvv_match",  label: "CVV Match",   icon: CreditCard,   color: "text-blue-400" },
  { key: "blocks_vpn",          label: "Blocks VPN",  icon: Wifi,         color: "text-red-400" },
  { key: "phone_must_match",    label: "Phone Match", icon: Phone,        color: "text-yellow-400" },
  { key: "accepts_amex",        label: "Amex OK",     icon: CheckCircle2, color: "text-green-400" },
  { key: "requires_avs",        label: "AVS",         icon: ShieldAlert,  color: "text-purple-400" },
  { key: "high_cancel_risk",    label: "Cancel Risk", icon: AlertTriangle, color: "text-orange-400" },
];

function FlagIcons({ shop }) {
  return (
    <div className="flex items-center gap-1">
      {FLAGS.filter((f) => shop[f.key]).map((f) => (
        <span key={f.key} title={f.label} className={f.color}>
          <f.icon size={12} />
        </span>
      ))}
    </div>
  );
}

// ─── Stats card ───────────────────────────────────────────────
function StatCard({ label, value, sub, accent }) {
  return (
    <div className="bg-[#0f1117] rounded-xl border border-[#2a2d3a] p-4">
      <div className="text-[10px] uppercase tracking-widest text-gray-500 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${accent || "text-gray-100"}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-500 mt-0.5">{sub}</div>}
    </div>
  );
}

// ─── Suggestion badge ─────────────────────────────────────────
function SuggestionBadge({ s }) {
  const styles = {
    good: "bg-green-500/10 border-green-500/20 text-green-300",
    warn: "bg-yellow-500/10 border-yellow-500/20 text-yellow-300",
    info: "bg-blue-500/10 border-blue-500/20 text-blue-300",
  };
  const icons = {
    good: <CheckCircle2 size={12} className="text-green-400 flex-shrink-0" />,
    warn: <AlertTriangle size={12} className="text-yellow-400 flex-shrink-0" />,
    info: <Info size={12} className="text-blue-400 flex-shrink-0" />,
  };
  return (
    <div className={`flex items-start gap-2 px-3 py-2 rounded-lg border text-xs ${styles[s.level] || styles.info}`}>
      {icons[s.level] || icons.info}
      <span>{s.message}</span>
    </div>
  );
}

// ─── ProductForm ──────────────────────────────────────────────
const EMPTY_PRODUCT = { asin: "", name: "", amazon_price: "", shop_price: "", url: "", notes: "" };

function ProductModal({ initial, shopId, onSave, onClose }) {
  const [form, setForm] = useState(initial
    ? { ...initial, amazon_price: initial.amazon_price ?? "", shop_price: initial.shop_price ?? "" }
    : { ...EMPTY_PRODUCT }
  );
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const margin = (() => {
    const a = parseFloat(form.amazon_price);
    const s = parseFloat(form.shop_price);
    if (!isNaN(a) && !isNaN(s)) return (s - a).toFixed(2);
    return null;
  })();

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setLoading(true);
    try {
      const payload = {
        asin: form.asin,
        name: form.name,
        amazon_price: form.amazon_price !== "" ? parseFloat(form.amazon_price) : null,
        shop_price: form.shop_price !== "" ? parseFloat(form.shop_price) : null,
        url: form.url,
        notes: form.notes,
      };
      await onSave(payload);
      onClose();
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-2xl w-[480px] shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a]">
          <div className="flex items-center gap-2">
            <Package size={16} className="text-purple-400" />
            <span className="font-semibold text-gray-100">{initial ? "Edit Product" : "Add Product"}</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">ASIN</label>
              <input value={form.asin} onChange={set("asin")} placeholder="B08N5WRWNW"
                className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 font-mono placeholder-gray-600 focus:outline-none focus:border-purple-500/50 transition-colors" />
            </div>
            <div className="col-span-1">
              <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">Name *</label>
              <input value={form.name} onChange={set("name")} placeholder="Product name"
                className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500/50 transition-colors" />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">Amazon $</label>
              <input type="number" step="0.01" value={form.amazon_price} onChange={set("amazon_price")} placeholder="0.00"
                className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500/50 font-mono transition-colors" />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">Shop $</label>
              <input type="number" step="0.01" value={form.shop_price} onChange={set("shop_price")} placeholder="0.00"
                className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500/50 font-mono transition-colors" />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">Margin</label>
              <div className={`flex items-center h-[42px] px-4 rounded-xl border border-[#2a2d3a] text-sm font-mono ${
                margin === null ? "text-gray-600" : parseFloat(margin) >= 0 ? "text-green-400" : "text-red-400"
              }`}>
                {margin !== null ? `$${margin}` : "—"}
              </div>
            </div>
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">URL</label>
            <input value={form.url} onChange={set("url")} placeholder="https://shop.com/product"
              className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500/50 transition-colors" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">Notes</label>
            <textarea value={form.notes} onChange={set("notes")} rows={2}
              className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-purple-500/50 resize-none transition-colors" />
          </div>
          <button onClick={handleSave} disabled={!form.name.trim() || loading}
            className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-sm font-medium transition-colors">
            {loading ? "Saving…" : initial ? "Save Changes" : "Add Product"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── ShopModal (create / edit) ────────────────────────────────
const EMPTY_SHOP = {
  name: "", url: "", category: "", notes: "",
  requires_cvv_match: false, blocks_vpn: false, phone_must_match: false,
  accepts_amex: false, requires_avs: false, high_cancel_risk: false,
};

function ShopModal({ initial, onSave, onClose }) {
  const [form, setForm] = useState(initial
    ? { name: initial.name, url: initial.url || initial.domain, category: initial.category || "",
        notes: initial.notes || "", requires_cvv_match: initial.requires_cvv_match,
        blocks_vpn: initial.blocks_vpn, phone_must_match: initial.phone_must_match,
        accepts_amex: initial.accepts_amex, requires_avs: initial.requires_avs,
        high_cancel_risk: initial.high_cancel_risk }
    : { ...EMPTY_SHOP }
  );
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const toggle = (k) => () => setForm((f) => ({ ...f, [k]: !f[k] }));
  const valid = form.name.trim() && form.url.trim();

  const handleSave = async () => {
    if (!valid) return;
    setLoading(true);
    try {
      await onSave(form);
      onClose();
    } catch (e) {
      if (e.toString().includes("duplicate")) toast("Domain already exists", "error");
      else toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-2xl w-[500px] shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a] sticky top-0 bg-[#1a1d27] z-10">
          <div className="flex items-center gap-2">
            <Store size={16} className="text-blue-400" />
            <span className="font-semibold text-gray-100">{initial ? "Edit Shop" : "New Shop"}</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">Shop Name *</label>
            <input value={form.name} onChange={set("name")} placeholder="Nike, Amazon, etc."
              className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">URL *</label>
            <input value={form.url} onChange={set("url")} placeholder="https://nike.com"
              className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 font-mono transition-colors" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">Category</label>
            <input value={form.category} onChange={set("category")} placeholder="Retail, Electronics, Fashion…"
              className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors" />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">Notes</label>
            <textarea value={form.notes} onChange={set("notes")} rows={2}
              className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 resize-none transition-colors" />
          </div>

          {/* Flags */}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-3">Risk Flags</label>
            <div className="grid grid-cols-2 gap-2">
              {FLAGS.map((f) => (
                <label key={f.key} onClick={toggle(f.key)}
                  className={`flex items-center gap-2.5 px-3 py-2.5 rounded-xl border cursor-pointer transition-colors ${
                    form[f.key]
                      ? "border-blue-500/40 bg-blue-500/10"
                      : "border-[#2a2d3a] hover:border-[#3a3d4a]"
                  }`}>
                  <div className={`w-4 h-4 rounded flex items-center justify-center border transition-colors ${
                    form[f.key] ? "bg-blue-600 border-blue-600" : "border-[#3a3d4a]"
                  }`}>
                    {form[f.key] && <span className="text-white text-[10px]">✓</span>}
                  </div>
                  <f.icon size={13} className={form[f.key] ? f.color : "text-gray-500"} />
                  <span className="text-xs text-gray-300">{f.label}</span>
                </label>
              ))}
            </div>
          </div>

          <button onClick={handleSave} disabled={!valid || loading}
            className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium transition-colors">
            {loading ? "Saving…" : initial ? "Save Changes" : "Create Shop"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Shop detail panel ────────────────────────────────────────
const ORDER_STATUS_COLOR = {
  pending:    "bg-yellow-500/20 text-yellow-300",
  processing: "bg-blue-500/20 text-blue-300",
  shipped:    "bg-purple-500/20 text-purple-300",
  delivered:  "bg-green-500/20 text-green-300",
  declined:   "bg-red-500/20 text-red-400",
  cancelled:  "bg-gray-500/20 text-gray-400",
};

function ShopDetailPanel({ shopId, onRefresh }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [productModal, setProductModal] = useState(null); // null | "add" | Product
  const { toast } = useToast();
  const { confirm } = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await invoke("get_shop_detail", { id: shopId });
      setDetail(d);
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  }, [shopId]);

  useEffect(() => { load(); }, [load]);

  const handleAddProduct = async (payload) => {
    await invoke("add_shop_product", { shopId, product: payload });
    toast("Product added", "success");
    load();
  };

  const handleEditProduct = async (payload) => {
    await invoke("update_shop_product", { id: productModal.id, product: payload });
    toast("Product updated", "success");
    load();
  };

  const handleDeleteProduct = async (p) => {
    const ok = await confirm(`Delete product "${p.name}"?`, { danger: true });
    if (!ok) return;
    try {
      await invoke("delete_shop_product", { id: p.id });
      toast("Product deleted", "success");
      load();
    } catch (e) {
      toast(String(e), "error");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-10">
        <div className="w-6 h-6 border-2 border-blue-500/40 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }
  if (!detail) return null;

  const { stats, recent_orders, products } = detail;

  return (
    <div className="border-t border-[#2a2d3a] bg-[#0c0e16]">
      {/* Stats row */}
      <div className="p-5 border-b border-[#2a2d3a]">
        <div className="flex items-center gap-2 mb-4">
          <BarChart2 size={14} className="text-blue-400" />
          <span className="text-xs uppercase tracking-widest text-gray-500">Statistics</span>
        </div>
        <div className="grid grid-cols-4 gap-3 mb-4">
          <StatCard label="Total Orders" value={stats.total} />
          <StatCard label="Delivered" value={stats.delivered} accent="text-green-400" />
          <StatCard label="Declined" value={stats.declined} accent="text-red-400" />
          <StatCard label="Avg Order" value={stats.avg_order_value > 0 ? `$${stats.avg_order_value.toFixed(2)}` : "—"} accent="text-blue-400" />
        </div>
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="Pending" value={stats.pending} accent="text-yellow-400" />
          <StatCard label="Processing" value={stats.processing} accent="text-blue-300" />
          <StatCard label="Shipped" value={stats.shipped} accent="text-purple-400" />
          <StatCard label="Success Rate"
            value={`${stats.success_rate.toFixed(1)}%`}
            accent={stats.success_rate >= 70 ? "text-green-400" : stats.success_rate >= 40 ? "text-yellow-400" : "text-red-400"}
            sub={`Decline: ${stats.decline_rate.toFixed(1)}%`}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 divide-x divide-[#2a2d3a]">
        {/* Products section */}
        <div className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Package size={14} className="text-purple-400" />
              <span className="text-xs uppercase tracking-widest text-gray-500">Products</span>
              <span className="text-[10px] text-gray-600">({products.length})</span>
            </div>
            <button onClick={() => setProductModal("add")}
              className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 transition-colors">
              <Plus size={12} /> Add
            </button>
          </div>

          {products.length === 0 ? (
            <div className="text-center py-8 text-gray-600 text-xs">
              <Package size={24} className="mx-auto mb-2 opacity-30" />
              No products catalogued
            </div>
          ) : (
            <div className="overflow-x-auto rounded-xl border border-[#2a2d3a]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[#0f1117] border-b border-[#2a2d3a]">
                    {["ASIN", "Name", "Amazon", "Shop", "Margin", ""].map((h) => (
                      <th key={h} className="px-3 py-2 text-left text-[10px] uppercase tracking-widest text-gray-500">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id} className="border-t border-[#2a2d3a] hover:bg-[#1a1d27]/50 group transition-colors">
                      <td className="px-3 py-2 font-mono text-gray-500">{p.asin || "—"}</td>
                      <td className="px-3 py-2 text-gray-200 max-w-[140px] truncate">{p.name}</td>
                      <td className="px-3 py-2 font-mono text-gray-400">{p.amazon_price != null ? `$${p.amazon_price.toFixed(2)}` : "—"}</td>
                      <td className="px-3 py-2 font-mono text-gray-400">{p.shop_price != null ? `$${p.shop_price.toFixed(2)}` : "—"}</td>
                      <td className="px-3 py-2 font-mono">
                        {p.margin != null ? (
                          <span className={p.margin >= 0 ? "text-green-400" : "text-red-400"}>
                            {p.margin >= 0 ? "+" : ""}{p.margin.toFixed(2)}
                          </span>
                        ) : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          {p.url && (
                            <a href={p.url} target="_blank" rel="noreferrer"
                              className="p-1 text-gray-500 hover:text-blue-400 transition-colors">
                              <ExternalLink size={11} />
                            </a>
                          )}
                          <button onClick={() => setProductModal(p)}
                            className="p-1 text-gray-500 hover:text-blue-400 transition-colors">
                            <Edit2 size={11} />
                          </button>
                          <button onClick={() => handleDeleteProduct(p)}
                            className="p-1 text-gray-500 hover:text-red-400 transition-colors">
                            <Trash2 size={11} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Recent Orders */}
        <div className="p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ShoppingCart size={14} className="text-green-400" />
              <span className="text-xs uppercase tracking-widest text-gray-500">Recent Orders</span>
            </div>
          </div>
          {recent_orders.length === 0 ? (
            <div className="text-center py-8 text-gray-600 text-xs">
              <ShoppingCart size={24} className="mx-auto mb-2 opacity-30" />
              No orders yet
            </div>
          ) : (
            <div className="space-y-2">
              {recent_orders.map((o) => (
                <div key={o.id} className="flex items-center justify-between py-2 border-b border-[#2a2d3a] last:border-0">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${ORDER_STATUS_COLOR[o.status] || "bg-gray-500/20 text-gray-400"}`}>
                      {o.status}
                    </span>
                    {o.tracking_number && (
                      <span className="text-[10px] font-mono text-gray-500 truncate max-w-[100px]">{o.tracking_number}</span>
                    )}
                  </div>
                  <div className="text-right">
                    {o.total_amount != null && <p className="text-xs text-gray-300">${o.total_amount.toFixed(2)}</p>}
                    <p className="text-[10px] text-gray-600">{o.created_at?.slice(0, 10)}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {productModal === "add" && (
        <ProductModal shopId={shopId} onSave={handleAddProduct} onClose={() => setProductModal(null)} />
      )}
      {productModal && productModal !== "add" && (
        <ProductModal initial={productModal} shopId={shopId} onSave={handleEditProduct} onClose={() => setProductModal(null)} />
      )}
    </div>
  );
}

// ─── Main ShopList ────────────────────────────────────────────
export default function ShopList() {
  const [shops, setShops] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [modal, setModal] = useState(null); // null | "new" | Shop
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const PER_PAGE = 50;

  const load = useCallback(async (p = page, s = search) => {
    setLoading(true);
    try {
      const r = await invoke("get_shops", { page: p, perPage: PER_PAGE, search: s || null });
      setShops(r.items);
      setTotal(r.total);
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  }, [page, search]);

  useEffect(() => { load(); }, []);

  const handleCreate = async (form) => {
    await invoke("create_shop", { input: form });
    toast("Shop created", "success");
    load();
  };

  const handleEdit = async (form) => {
    await invoke("update_shop", { id: modal.id, input: form });
    toast("Shop updated", "success");
    load();
  };

  const handleDelete = async (shop) => {
    const ok = await confirm(`Delete shop "${shop.name}"?`, { danger: true });
    if (!ok) return;
    try {
      await invoke("delete_shop", { id: shop.id });
      toast("Shop deleted", "success");
      if (expanded === shop.id) setExpanded(null);
      load();
    } catch (e) {
      if (e.toString().includes("active_orders")) {
        const count = e.toString().split(":")[1];
        toast(`Cannot delete: ${count} active order(s)`, "error");
      } else {
        toast(String(e), "error");
      }
    }
  };

  const openSite = (shop) => {
    const url = shop.url || `https://${shop.domain}`;
    window.open(url, "_blank");
  };

  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a]">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-gray-100">Shops</h1>
          <span className="text-xs bg-[#2a2d3a] text-gray-400 px-2 py-0.5 rounded-full">{total}</span>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => load()} className="p-1.5 text-gray-500 hover:text-gray-300 rounded-lg border border-[#2a2d3a] hover:border-[#3a3d4a] transition-colors">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button onClick={() => setModal("new")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors">
            <Plus size={14} /> New Shop
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-[#2a2d3a] bg-[#0f1117]/40">
        <div className="relative max-w-xs w-full">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load(1, search)}
            placeholder="Search name or domain… (Enter)"
            className="w-full bg-[#1a1d27] border border-[#2a2d3a] rounded-lg pl-8 pr-4 py-1.5 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
          />
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#0f1117] z-10">
            <tr className="border-b border-[#2a2d3a]">
              <th className="w-8" />
              {["Name / Domain", "Category", "Orders", "Delivered", "Declined", "Success %", "Avg Order", "Flags", "Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[11px] uppercase tracking-widest text-gray-500 font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shops.length === 0 && !loading && (
              <tr>
                <td colSpan={10} className="text-center py-20 text-gray-600">
                  <Store size={36} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No shops yet</p>
                </td>
              </tr>
            )}
            {shops.map((shop) => {
              const isExpanded = expanded === shop.id;
              return (
                <>
                  <tr
                    key={shop.id}
                    className={`border-b border-[#2a2d3a] cursor-pointer group transition-colors ${isExpanded ? "bg-[#1a1d27]" : "hover:bg-[#1a1d27]"}`}
                    onClick={() => setExpanded(isExpanded ? null : shop.id)}
                  >
                    <td className="pl-4 py-3">
                      <span className={`text-gray-600 inline-block transition-transform ${isExpanded ? "rotate-90" : ""}`}>
                        <ChevronRight size={14} />
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-gray-200 text-sm">{shop.name}</div>
                      <div className="text-[11px] text-gray-500 font-mono">{shop.domain}</div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-400">{shop.category || <span className="text-gray-600">—</span>}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-300">{shop.total_orders}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-green-400">{shop.delivered}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-red-400">{shop.declined}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${
                        shop.total_orders === 0 ? "text-gray-600"
                        : shop.success_rate >= 70 ? "text-green-400"
                        : shop.success_rate >= 40 ? "text-yellow-400"
                        : "text-red-400"
                      }`}>
                        {shop.total_orders > 0 ? `${shop.success_rate.toFixed(1)}%` : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-400">
                        {shop.avg_order_value > 0 ? `$${shop.avg_order_value.toFixed(2)}` : "—"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <FlagIcons shop={shop} />
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button onClick={() => openSite(shop)} title="Visit site"
                          className="p-1.5 text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 rounded transition-colors">
                          <ExternalLink size={12} />
                        </button>
                        <button onClick={() => setModal(shop)} title="Edit"
                          className="p-1.5 text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 rounded transition-colors">
                          <Edit2 size={12} />
                        </button>
                        <button onClick={() => handleDelete(shop)} title="Delete"
                          className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${shop.id}-detail`}>
                      <td colSpan={10} className="p-0">
                        <ShopDetailPanel shopId={shop.id} onRefresh={load} />
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-[#2a2d3a] bg-[#0f1117]/60">
          <span className="text-xs text-gray-500">{total} shops</span>
          <div className="flex gap-1">
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i + 1).map((p) => (
              <button key={p} onClick={() => { setPage(p); load(p, search); }}
                className={`w-8 h-8 text-xs rounded-lg transition-colors ${page === p ? "bg-blue-600 text-white" : "text-gray-500 hover:bg-[#2a2d3a] hover:text-gray-200"}`}>
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      {modal === "new" && (
        <ShopModal onSave={handleCreate} onClose={() => setModal(null)} />
      )}
      {modal && modal !== "new" && (
        <ShopModal initial={modal} onSave={handleEdit} onClose={() => setModal(null)} />
      )}
    </div>
  );
}

// ─── Export SmartSuggestions hook for use in Orders ───────────
export function useSmartSuggestions(shopId, cardId) {
  const [suggestions, setSuggestions] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!shopId || !cardId) { setSuggestions([]); return; }
    setLoading(true);
    invoke("get_shop_smart_suggestions", { shopId, cardId })
      .then(setSuggestions)
      .catch(() => setSuggestions([]))
      .finally(() => setLoading(false));
  }, [shopId, cardId]);

  return { suggestions, loading };
}

// Re-export SuggestionBadge for use in Orders form
export { SuggestionBadge };
