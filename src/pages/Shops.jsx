import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLang } from "../hooks/useLang";
import { useToast } from "../hooks/useToast";
import { useConfirm } from "../hooks/useConfirm";
import { SkeletonRows } from "../components/SkeletonRow.jsx";

// ─── Flag definitions ─────────────────────────────────────────────────────

const FLAGS = [
  { key: "requires_cvv_match",  label: "CVV Match",   bg: "rgba(59,130,246,0.12)",  color: "#60a5fa" },
  { key: "blocks_vpn",          label: "Blocks VPN",  bg: "rgba(239,68,68,0.12)",   color: "#f87171" },
  { key: "phone_must_match",    label: "Phone Match", bg: "rgba(234,179,8,0.12)",   color: "#facc15" },
  { key: "accepts_amex",        label: "Amex OK",     bg: "rgba(34,197,94,0.12)",   color: "#4ade80" },
  { key: "requires_avs",        label: "AVS",         bg: "rgba(234,179,8,0.12)",   color: "#facc15" },
  { key: "high_cancel_risk",    label: "Cancel Risk", bg: "rgba(239,68,68,0.12)",   color: "#f87171" },
];

function FlagPills({ shop }) {
  const active = FLAGS.filter((f) => shop[f.key]);
  if (!active.length) return <span style={{ color: "var(--muted)", fontSize: 12 }}>—</span>;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
      {active.map((f) => (
        <span key={f.key} style={{
          fontSize: 10, fontWeight: 600, padding: "2px 7px",
          borderRadius: 4, background: f.bg, color: f.color, whiteSpace: "nowrap",
        }}>
          {f.label}
        </span>
      ))}
    </div>
  );
}

// ─── Stat card for detail panel ───────────────────────────────────────────

function StatCard({ label, value, sub, accent }) {
  return (
    <div style={{
      background: "var(--surface)", borderRadius: 10,
      border: "1px solid var(--border)", padding: "10px 14px",
    }}>
      <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)", marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: accent || "var(--text)" }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: "var(--muted)", marginTop: 2 }}>{sub}</div>}
    </div>
  );
}

// ─── Suggestion badge (re-exported) ──────────────────────────────────────

function SuggestionBadge({ s }) {
  const bgMap = { good: "rgba(34,197,94,0.1)", warn: "rgba(234,179,8,0.1)", info: "rgba(59,130,246,0.1)" };
  const colorMap = { good: "#4ade80", warn: "#facc15", info: "#60a5fa" };
  const iconMap = { good: "✓", warn: "⚠", info: "i" };
  const lvl = s.level || "info";
  return (
    <div style={{
      display: "flex", alignItems: "flex-start", gap: 8,
      padding: "7px 10px", borderRadius: 7, fontSize: 12,
      background: bgMap[lvl] || bgMap.info,
      color: colorMap[lvl] || colorMap.info,
      border: `1px solid ${colorMap[lvl] || colorMap.info}30`,
    }}>
      <span style={{ fontWeight: 700, flexShrink: 0 }}>{iconMap[lvl] || iconMap.info}</span>
      <span style={{ color: "var(--dim)" }}>{s.message}</span>
    </div>
  );
}

// ─── ProductModal ─────────────────────────────────────────────────────────

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
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 480, width: "100%" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
          <span className="modal-title">{initial ? "Edit Product" : "Add Product"}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div className="form-group">
            <label className="form-label">ASIN</label>
            <input value={form.asin} onChange={set("asin")} placeholder="B08N5WRWNW"
              className="form-input" style={{ fontFamily: "'JetBrains Mono',monospace" }} />
          </div>
          <div className="form-group">
            <label className="form-label">Name *</label>
            <input value={form.name} onChange={set("name")} placeholder="Product name" className="form-input" />
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
          <div className="form-group">
            <label className="form-label">Amazon $</label>
            <input type="number" step="0.01" value={form.amazon_price} onChange={set("amazon_price")}
              placeholder="0.00" className="form-input" style={{ fontFamily: "'JetBrains Mono',monospace" }} />
          </div>
          <div className="form-group">
            <label className="form-label">Shop $</label>
            <input type="number" step="0.01" value={form.shop_price} onChange={set("shop_price")}
              placeholder="0.00" className="form-input" style={{ fontFamily: "'JetBrains Mono',monospace" }} />
          </div>
          <div className="form-group">
            <label className="form-label">Margin</label>
            <div className="form-input" style={{
              display: "flex", alignItems: "center", fontFamily: "'JetBrains Mono',monospace",
              color: margin === null ? "var(--muted)" : parseFloat(margin) >= 0 ? "#4ade80" : "#f87171",
            }}>
              {margin !== null ? `$${margin}` : "—"}
            </div>
          </div>
        </div>

        <div className="form-group" style={{ marginBottom: 10 }}>
          <label className="form-label">URL</label>
          <input value={form.url} onChange={set("url")} placeholder="https://shop.com/product" className="form-input" />
        </div>

        <div className="form-group" style={{ marginBottom: 16 }}>
          <label className="form-label">Notes</label>
          <textarea value={form.notes} onChange={set("notes")} rows={2}
            className="form-input" style={{ resize: "none" }} />
        </div>

        <button onClick={handleSave} disabled={!form.name.trim() || loading}
          className="btn btn-p" style={{ width: "100%" }}>
          {loading ? "Saving…" : initial ? "Save Changes" : "Add Product"}
        </button>
      </div>
    </div>
  );
}

// ─── ShopModal (create / edit) ────────────────────────────────────────────

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
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 500, width: "100%", maxHeight: "90vh", overflowY: "auto" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <span className="modal-title">{initial ? "Edit Shop" : "New Shop"}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="form-group">
          <label className="form-label">Shop Name *</label>
          <input value={form.name} onChange={set("name")} placeholder="Nike, Amazon, etc." className="form-input" />
        </div>

        <div className="form-group">
          <label className="form-label">URL *</label>
          <input value={form.url} onChange={set("url")} placeholder="https://nike.com"
            className="form-input" style={{ fontFamily: "'JetBrains Mono',monospace" }} />
        </div>

        <div className="form-group">
          <label className="form-label">Category</label>
          <input value={form.category} onChange={set("category")} placeholder="Retail, Electronics, Fashion…" className="form-input" />
        </div>

        <div className="form-group">
          <label className="form-label">Notes</label>
          <textarea value={form.notes} onChange={set("notes")} rows={2}
            className="form-input" style={{ resize: "none" }} />
        </div>

        {/* Flags */}
        <div className="form-group">
          <label className="form-label" style={{ marginBottom: 10 }}>Risk Flags</label>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {FLAGS.map((f) => (
              <label
                key={f.key}
                onClick={toggle(f.key)}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "9px 12px", borderRadius: 8, cursor: "pointer",
                  border: form[f.key] ? `1px solid ${f.color}40` : "1px solid var(--border)",
                  background: form[f.key] ? f.bg : "transparent",
                  transition: "all 0.15s",
                }}
              >
                <div style={{
                  width: 16, height: 16, borderRadius: 4, flexShrink: 0,
                  display: "flex", alignItems: "center", justifyContent: "center",
                  background: form[f.key] ? "#2563eb" : "transparent",
                  border: form[f.key] ? "1px solid #2563eb" : "1px solid var(--border)",
                }}>
                  {form[f.key] && <span style={{ color: "#fff", fontSize: 10, fontWeight: 700 }}>✓</span>}
                </div>
                <span style={{ fontSize: 12, color: "var(--dim)" }}>{f.label}</span>
              </label>
            ))}
          </div>
        </div>

        <button onClick={handleSave} disabled={!valid || loading}
          className="btn btn-b" style={{ width: "100%", marginTop: 6 }}>
          {loading ? "Saving…" : initial ? "Save Changes" : "Create Shop"}
        </button>
      </div>
    </div>
  );
}

// ─── Shop detail panel ────────────────────────────────────────────────────

const ORDER_STATUS_COLOR = {
  pending:    { bg: "rgba(234,179,8,0.15)",  color: "#facc15" },
  processing: { bg: "rgba(59,130,246,0.15)", color: "#60a5fa" },
  shipped:    { bg: "rgba(168,85,247,0.15)", color: "#c084fc" },
  delivered:  { bg: "rgba(34,197,94,0.15)",  color: "#4ade80" },
  declined:   { bg: "rgba(239,68,68,0.15)",  color: "#f87171" },
  cancelled:  { bg: "rgba(107,114,128,0.15)",color: "#9ca3af" },
};

function ShopDetailPanel({ shopId, onRefresh }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [productModal, setProductModal] = useState(null);
  const { toast } = useToast();
  const { confirm } = useConfirm();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await invoke("get_shop", { id: shopId });
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
      <div style={{ padding: "20px", textAlign: "center", color: "var(--muted)", fontSize: 12 }}>
        Loading…
      </div>
    );
  }
  if (!detail) return null;

  const { stats, recent_orders, products } = detail;

  return (
    <div style={{ borderTop: "1px solid var(--border)", background: "var(--surface)", padding: "16px 18px" }}>
      {/* Stats */}
      <p className="ptitle" style={{ marginBottom: 10 }}>Statistics</p>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 10 }}>
        <StatCard label="Total Orders" value={stats.total} />
        <StatCard label="Delivered" value={stats.delivered} accent="#4ade80" />
        <StatCard label="Declined" value={stats.declined} accent="#f87171" />
        <StatCard label="Avg Order" value={stats.avg_order_value > 0 ? `$${stats.avg_order_value.toFixed(2)}` : "—"} accent="#60a5fa" />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10, marginBottom: 18 }}>
        <StatCard label="Pending" value={stats.pending} accent="#facc15" />
        <StatCard label="Processing" value={stats.processing} accent="#93c5fd" />
        <StatCard label="Shipped" value={stats.shipped} accent="#c084fc" />
        <StatCard
          label="Success Rate"
          value={`${stats.success_rate.toFixed(1)}%`}
          accent={stats.success_rate >= 70 ? "#4ade80" : stats.success_rate >= 40 ? "#facc15" : "#f87171"}
          sub={`Decline: ${stats.decline_rate.toFixed(1)}%`}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        {/* Products */}
        <div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
            <p className="ptitle" style={{ margin: 0 }}>Products ({products.length})</p>
            <button onClick={() => setProductModal("add")} className="btn btn-p btn-sm">+ Add</button>
          </div>
          {products.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 0", color: "var(--muted)", fontSize: 12 }}>
              No products catalogued
            </div>
          ) : (
            <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th>ASIN</th>
                    <th>Name</th>
                    <th>Amazon</th>
                    <th>Shop</th>
                    <th>Margin</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id}>
                      <td style={{ fontFamily: "'JetBrains Mono',monospace", color: "var(--muted)" }}>{p.asin || "—"}</td>
                      <td style={{ maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.name}</td>
                      <td style={{ fontFamily: "'JetBrains Mono',monospace" }}>{p.amazon_price != null ? `$${p.amazon_price.toFixed(2)}` : "—"}</td>
                      <td style={{ fontFamily: "'JetBrains Mono',monospace" }}>{p.shop_price != null ? `$${p.shop_price.toFixed(2)}` : "—"}</td>
                      <td style={{ fontFamily: "'JetBrains Mono',monospace" }}>
                        {p.margin != null ? (
                          <span style={{ color: p.margin >= 0 ? "#4ade80" : "#f87171" }}>
                            {p.margin >= 0 ? "+" : ""}{p.margin.toFixed(2)}
                          </span>
                        ) : "—"}
                      </td>
                      <td>
                        <div className="tbl-actions">
                          {p.url && (
                            <a href={p.url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">↗</a>
                          )}
                          <button onClick={() => setProductModal(p)} className="btn btn-ghost btn-sm">Edit</button>
                          <button onClick={() => handleDeleteProduct(p)} className="btn btn-r btn-sm">Del</button>
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
        <div>
          <p className="ptitle" style={{ marginBottom: 10 }}>Recent Orders</p>
          {recent_orders.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 0", color: "var(--muted)", fontSize: 12 }}>
              No orders yet
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {recent_orders.map((o) => {
                const sc = ORDER_STATUS_COLOR[o.status] || { bg: "rgba(107,114,128,0.15)", color: "#9ca3af" };
                return (
                  <div key={o.id} style={{
                    display: "flex", alignItems: "center", justifyContent: "space-between",
                    padding: "8px 0", borderBottom: "1px solid var(--border)",
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span style={{
                        fontSize: 10, padding: "2px 7px", borderRadius: 20,
                        background: sc.bg, color: sc.color,
                      }}>
                        {o.status}
                      </span>
                      {o.tracking_number && (
                        <span style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "var(--muted)", maxWidth: 100, overflow: "hidden", textOverflow: "ellipsis" }}>
                          {o.tracking_number}
                        </span>
                      )}
                    </div>
                    <div style={{ textAlign: "right" }}>
                      {o.total_amount != null && <p style={{ fontSize: 12, color: "var(--dim)", margin: 0 }}>${o.total_amount.toFixed(2)}</p>}
                      <p style={{ fontSize: 10, color: "var(--muted)", margin: 0 }}>{o.created_at?.slice(0, 10)}</p>
                    </div>
                  </div>
                );
              })}
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

// ─── Main ShopList ────────────────────────────────────────────────────────

export default function ShopList() {
  const [shops, setShops]   = useState([]);
  const [total, setTotal]   = useState(0);
  const [page, setPage]     = useState(1);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(null);
  const [modal, setModal]   = useState(null);
  const { toast }   = useToast();
  const { confirm } = useConfirm();
  const PER_PAGE = 50;

  const load = useCallback(async (p = page, s = search) => {
    setLoading(true);
    try {
      const r = await invoke("get_shops", { page: p, perPage: PER_PAGE, search: s || "" });
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
      toast(String(e), "error");
    }
  };

  const openSite = (shop) => {
    const url = shop.url || `https://${shop.domain}`;
    window.open(url, "_blank");
  };

  const totalPages = Math.ceil(total / PER_PAGE);

  // Aggregate stats for stat bar
  const totOrders    = shops.reduce((s, x) => s + (x.total_orders ?? 0), 0);
  const totDelivered = shops.reduce((s, x) => s + (x.delivered ?? 0), 0);
  const totDeclined  = shops.reduce((s, x) => s + (x.declined ?? 0), 0);

  return (
    <div className="content">

      {/* Page header */}
      <div className="ph">
        <div>
          <div className="ph-title">
            🏪 Shops{" "}
            <span style={{ color: "var(--dim)", fontSize: 14, fontWeight: 400 }}>{total} магазинов</span>
          </div>
        </div>
        <div className="ph-actions">
          <button onClick={() => load()} className="btn btn-ghost btn-sm" title="Refresh">
            {loading ? "⟳" : "↺"} Refresh
          </button>
          <button onClick={() => setModal("new")} className="btn btn-b">
            + New Shop
          </button>
        </div>
      </div>

      {/* Search + stat bar */}
      <div className="filters">
        <input
          className="search-box"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load(1, search)}
          placeholder="🔍  Search name or domain… (Enter)"
          style={{ width: 260 }}
        />

        {shops.length > 0 && (
          <>
            {[
              { label: "shops",     val: shops.length, color: "#60a5fa" },
              { label: "orders",    val: totOrders,     color: "#a78bfa" },
              { label: "delivered", val: totDelivered,  color: "#4ade80" },
              { label: "declined",  val: totDeclined,   color: "#f87171" },
            ].map(({ label, val, color }) => (
              <div key={label} style={{
                background: `${color}12`, border: `1px solid ${color}25`,
                borderRadius: 8, padding: "4px 12px",
                display: "flex", alignItems: "center", gap: 7,
              }}>
                <span style={{ width: 5, height: 5, borderRadius: "50%", background: color, flexShrink: 0, display: "inline-block" }} />
                <span style={{ color, fontSize: 12, fontWeight: 500 }}>{val}</span>
                <span style={{ color: "var(--muted)", fontSize: 11 }}>{label}</span>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Table */}
      {loading && shops.length === 0 ? (
        <div className="panel" style={{ padding: 0 }}>
          <table className="tbl">
            <tbody>
              <SkeletonRows count={5} cols={9} />
            </tbody>
          </table>
        </div>
      ) : shops.length === 0 ? (
        <div className="panel" style={{ textAlign: "center", padding: 48 }}>
          <div style={{ fontSize: 36, marginBottom: 12, opacity: 0.2 }}>🏪</div>
          <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 14px" }}>No shops yet</p>
          <button onClick={() => setModal("new")} className="btn btn-b">
            + Add your first shop
          </button>
        </div>
      ) : (
        <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 32 }}></th>
                <th>Магазин</th>
                <th>Domain</th>
                <th>Категория</th>
                <th>Флаги</th>
                <th>Заказов</th>
                <th>Success%</th>
                <th>Decline%</th>
                <th>Revenue</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {shops.map((shop) => {
                const isExpanded = expanded === shop.id;
                const successPct = shop.total_orders > 0 ? shop.success_rate : null;
                const declinePct = shop.total_orders > 0 ? shop.decline_rate : null;
                const successColor = successPct === null ? "var(--muted)"
                  : successPct >= 60 ? "#4ade80"
                  : successPct < 30  ? "#f87171"
                  : "#facc15";
                const declineColor = declinePct !== null && declinePct > 50 ? "#f87171" : "var(--dim)";

                return (
                  <>
                    <tr
                      key={shop.id}
                      style={{ cursor: "pointer", background: isExpanded ? "var(--card)" : undefined }}
                      onClick={() => setExpanded(isExpanded ? null : shop.id)}
                    >
                      <td style={{ textAlign: "center", color: "var(--muted)", fontSize: 12 }}>
                        <span style={{ display: "inline-block", transition: "transform 0.15s", transform: isExpanded ? "rotate(90deg)" : "rotate(0deg)" }}>›</span>
                      </td>
                      <td>
                        <b style={{ fontSize: 13 }}>{shop.name}</b>
                      </td>
                      <td>
                        <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "var(--muted)" }}>
                          {shop.domain}
                        </span>
                      </td>
                      <td style={{ color: shop.category ? "var(--dim)" : "var(--muted)" }}>
                        {shop.category || "—"}
                      </td>
                      <td>
                        <FlagPills shop={shop} />
                      </td>
                      <td style={{ fontFamily: "'JetBrains Mono',monospace" }}>
                        {shop.total_orders}
                      </td>
                      <td>
                        <span style={{ fontWeight: 600, color: successColor }}>
                          {successPct !== null ? `${successPct.toFixed(1)}%` : "—"}
                        </span>
                      </td>
                      <td>
                        <span style={{ color: declineColor }}>
                          {declinePct !== null ? `${declinePct.toFixed(1)}%` : "—"}
                        </span>
                      </td>
                      <td style={{ fontFamily: "'JetBrains Mono',monospace" }}>
                        {shop.avg_order_value > 0 ? `$${shop.avg_order_value.toFixed(2)}` : "—"}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="tbl-actions">
                          <button onClick={() => openSite(shop)} className="btn btn-ghost btn-sm" title="Visit site">↗</button>
                          <button onClick={() => setModal(shop)} className="btn btn-ghost btn-sm">Edit</button>
                          <button onClick={() => handleDelete(shop)} className="btn btn-r btn-sm">Del</button>
                        </div>
                      </td>
                    </tr>

                    {isExpanded && (
                      <tr key={`${shop.id}-detail`}>
                        <td colSpan={10} style={{ padding: 0 }}>
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
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, fontSize: 11, color: "var(--muted)" }}>
          <span>Показано {total} shops</span>
          <div style={{ display: "flex", gap: 5 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => { const np = Math.max(1, page - 1); setPage(np); load(np, search); }} disabled={page === 1}>← Пред</button>
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => { setPage(p); load(p, search); }}
                className="btn btn-ghost btn-sm"
                style={p === page ? { background: "var(--accent)", color: "#fff", border: "none" } : undefined}
              >
                {p}
              </button>
            ))}
            <button className="btn btn-ghost btn-sm" onClick={() => { const np = Math.min(totalPages, page + 1); setPage(np); load(np, search); }} disabled={page >= totalPages}>След →</button>
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

// ─── Export SmartSuggestions hook for use in Orders ───────────────────────

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

export { SuggestionBadge };
