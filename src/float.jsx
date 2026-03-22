import { useState, useEffect, useCallback, useRef } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { useLang, LangProvider } from "./hooks/useLang";
import { ToastProvider, useToast } from "./hooks/useToast";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Lock } from "lucide-react";
import "./index.css";

// ─── Copy button ──────────────────────────────────────────────
// eslint-disable-next-line react-refresh/only-export-components -- Helper component
function CopyBtn({ value }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (!value) return;
    navigator.clipboard.writeText(String(value)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button className="float-copy" onClick={handleCopy} title="Copy"
      style={{ color: copied ? "#4ade80" : undefined }}>
      {copied ? "✓" : "⎘"}
    </button>
  );
}

// ─── Field row ────────────────────────────────────────────────
// eslint-disable-next-line react-refresh/only-export-components -- Helper component
function Field({ label, value }) {
  return (
    <div className="float-field">
      <span className="float-lbl">{label}</span>
      <span className="float-val" style={{ flex: 1, textAlign: "right", marginRight: 6 }}>{value ?? "—"}</span>
      <CopyBtn value={value} />
    </div>
  );
}

// ─── Risk badge ───────────────────────────────────────────────
// eslint-disable-next-line react-refresh/only-export-components -- Helper component
function RiskBadge({ level }) {
  if (!level) return null;
  const map = {
    safe:    { color: "#4ade80", bg: "rgba(34,197,94,0.12)",  border: "rgba(34,197,94,0.25)",  label: "Safe",      icon: "🟢" },
    warning: { color: "#facc15", bg: "rgba(234,179,8,0.12)",  border: "rgba(234,179,8,0.25)",  label: "Warning",   icon: "🟡" },
    high:    { color: "#f87171", bg: "rgba(239,68,68,0.12)",  border: "rgba(239,68,68,0.25)",  label: "High Risk", icon: "🔴" },
  };
  const cfg = map[level] ?? map.warning;
  return (
    <span className="st" style={{
      color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`,
      borderRadius: 999, padding: "2px 8px",
    }}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

// ─── Card Health Indicator ────────────────────────────────────
// eslint-disable-next-line react-refresh/only-export-components -- Helper component
function CardHealth({ card, orderCount }) {
  if (!card) return null;

  // Health logic: dead/blocked = burned, in_use with many orders = used, free/new = fresh
  let label, color, icon;
  if (card.status === "dead" || card.status === "blocked") {
    label = "Burned"; color = "#f87171"; icon = "🔴";
  } else if (orderCount >= 3 || card.status === "in_use") {
    label = "Used"; color = "#facc15"; icon = "🟡";
  } else {
    label = "Fresh"; color = "#4ade80"; icon = "🟢";
  }

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--muted)" }}>
      <span style={{ color }}>{icon}</span>
      <span style={{ color }}>{label}</span>
      {orderCount > 0 && <span style={{ color: "var(--muted)" }}>· {orderCount} order{orderCount !== 1 ? "s" : ""}</span>}
    </div>
  );
}

// ─── Order status helpers ─────────────────────────────────────
const STATUS_CSS = {
  pending:    "st-pending",
  processing: "st-inuse",
  shipped:    "st-transit",
  delivered:  "st-delivered",
  declined:   "st-decline",
  cancelled:  "st-archive",
};

function fmtDate(iso) {
  if (!iso) return "—";
  return iso.slice(0, 10);
}

// ─── Main float component ─────────────────────────────────────
function ProfileFloat() {
  const { t } = useLang();
  const { success: toastOk, error: toastErr } = useToast();

  const [profileId, setProfileId] = useState(null);
  const [profile, setProfile]     = useState(null);
  const [card, setCard]           = useState(null);
  const [drop, setDrop]           = useState(null);
  const [latestOrderId, setLatestOrderId] = useState(null);
  const [recentOrders, setRecentOrders]   = useState([]);
  const [tab, setTab]             = useState("card");
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState(null);
  const [appLocked, setAppLocked] = useState(false);
  const [showQuickOrder, setShowQuickOrder] = useState(false);
  const [quickUrl, setQuickUrl]   = useState("");
  const autoCopiedRef = useRef(false);
  const [floatWidth, setFloatWidth] = useState(() => {
    return parseInt(localStorage.getItem('float_width') || '380', 10);
  });

  // ── Load profile data ──────────────────────────────────────
  const load = useCallback(async (id) => {
    if (!id) return;
    setLoading(true);
    setError(null);
    setProfile(null);
    setCard(null);
    setDrop(null);
    setLatestOrderId(null);
    setRecentOrders([]);
    autoCopiedRef.current = false;
    try {
      const detail = await invoke("get_profile", { id: String(id) });
      setProfile(detail.profile);
      setCard(detail.card);
      if (detail.drops?.length > 0) {
        const primary = detail.drops.find((d) => d.is_primary) ?? detail.drops[0];
        setDrop(primary);
      }
      // Load latest order id (for quick status change)
      try {
        const order = await invoke("get_latest_order_by_profile", { profileId: String(id) });
        if (order) setLatestOrderId(order.id);
      } catch {
        // Ignore if no orders found
      }
      // Load recent orders (for Orders tab)
      try {
        const orders = await invoke("get_recent_orders_by_profile", { profileId: String(id), limit: 5 });
        setRecentOrders(orders ?? []);
      } catch {
        // Ignore if no orders found
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // ── Listen for float:load event ────────────────────────────
  useEffect(() => {
    let unlisten;
    listen("float:load", (event) => {
      const id = String(event.payload ?? "").trim();
      if (!id) return;
      setTab("card");
      setProfileId(id);
    }).then((u) => { unlisten = u; });
    return () => { if (unlisten) unlisten(); };
  }, []);

  // ── Reload whenever profileId changes ──────────────────────
  useEffect(() => {
    if (profileId) load(profileId);
  }, [profileId, load]);

  // ── App lock listener ──────────────────────────────────────
  useEffect(() => {
    let unlisten;
    listen("app_locked", () => setAppLocked(true)).then((u) => { unlisten = u; });
    return () => { if (unlisten) unlisten(); };
  }, []);

  // ── F5: Save float width to localStorage with debounce ─────
  useEffect(() => {
    const t = setTimeout(() => localStorage.setItem('float_width', String(floatWidth)), 300);
    return () => clearTimeout(t);
  }, [floatWidth]);

  // ── F5: Resize handle mouse handler ────────────────────────
  const handleResizeStart = (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = floatWidth;
    const onMove = (ev) => {
      const newW = Math.max(340, Math.min(600, startW - (ev.clientX - startX)));
      setFloatWidth(newW);
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // ── F4: Auto-copy billing address on tab switch ────────────
  useEffect(() => {
    if (tab === "billing" && card && !autoCopiedRef.current) {
      const addr = [card.billing_address, card.city, card.state, card.zip, card.country]
        .filter(Boolean).join(", ");
      if (addr) {
        navigator.clipboard.writeText(addr).catch(() => {});
        toastOk("Billing address copied");
        autoCopiedRef.current = true;
      }
    }
    if (tab !== "billing") {
      autoCopiedRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- toastOk is stable
  }, [tab, card]);

  // ── States ─────────────────────────────────────────────────
  if (appLocked) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "rgba(11,15,22,0.82)", gap: 10 }}>
        <Lock size={28} style={{ color: "var(--muted)" }} />
        <span style={{ fontSize: 12, color: "var(--muted)" }}>{t("auth_err_locked")}</span>
      </div>
    );
  }

  if (!profileId) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "rgba(11,15,22,0.82)" }}>
        <span style={{ fontSize: 12, color: "var(--muted)" }}>Waiting for profile…</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100vh", background: "rgba(11,15,22,0.82)" }}>
        <div style={{ width: 24, height: 24, borderRadius: "50%", border: "2px solid rgba(59,130,246,0.3)", borderTopColor: "var(--blue)", animation: "spin 0.8s linear infinite" }} />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100vh", background: "rgba(11,15,22,0.82)", gap: 10 }}>
        <span style={{ color: "#f87171", fontSize: 12 }}>{error ?? "Profile not found"}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => load(profileId)}>Retry</button>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", display: "flex", flexDirection: "column", height: "100vh", width: floatWidth, background: "rgba(11,15,22,0.82)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", color: "var(--text)" }}>
      {/* F5: Resize handle — left edge drag */}
      <div
        onMouseDown={handleResizeStart}
        style={{
          position: 'absolute', left: 0, top: 0, bottom: 0, width: 4,
          cursor: 'ew-resize', zIndex: 10,
          background: 'transparent',
        }}
      />

      {/* ── Header ── */}
      <div style={{ background: "rgba(17,21,32,0.75)", borderBottom: "1px solid var(--border)", padding: "10px 14px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{profile.holder_name || t("section_card")}</span>
            {card && <span style={{ marginLeft: 8, fontSize: 11, color: "var(--muted)" }}>••{card.last4}</span>}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <RiskBadge level={profile.risk_level} />
            {card && (
              <span className={`st ${card.status === "free" ? "st-free" : "st-archive"}`}>
                {card.status}
              </span>
            )}
            <button
              onClick={() => getCurrentWindow().hide()}
              style={{
                width: 14, height: 14, borderRadius: "50%",
                background: "#ef4444", border: "none", cursor: "pointer",
                display: "flex", alignItems: "center", justifyContent: "center",
                fontSize: 9, color: "rgba(0,0,0,0.6)", fontWeight: 700,
              }}
              title={t("btn_close")}
            >×</button>
          </div>
        </div>
        {/* F3: Card health indicator */}
        <CardHealth card={card} orderCount={recentOrders.length} />
      </div>

      {/* ── Tabs ── */}
      <div style={{ padding: "8px 12px", background: "rgba(13,17,26,0.65)", borderBottom: "1px solid var(--border)" }}>
        <div className="float-tabs">
          {[
            { key: "card",     label: t("section_card") },
            { key: "billing",  label: t("copy_billing") },
            { key: "shipping", label: t("copy_shipping") },
            { key: "orders",   label: "Orders" },
          ].map(({ key, label }) => (
            <button
              key={key}
              className={`ftab${tab === key ? " active" : ""}`}
              onClick={() => setTab(key)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ flex: 1, overflow: "auto", padding: "10px 12px", minHeight: 0 }}>

        {tab === "card" && card && (
          <>
            <Field label={t("card_label_number")} value={card.card_number} />
            <Field label={t("card_label_expiry")} value={card.expiry_date} />
            <Field label={t("card_label_cvv")} value={card.cvv} />
            <Field label={t("card_label_holder")} value={card.holder_name} />
            {card.email && <Field label={t("col_email")} value={card.email} />}
            {card.phone && <Field label={t("drop_field_phone")} value={card.phone} />}
            {card.bank_name  && <Field label={t("card_label_bank")} value={card.bank_name} />}
            {card.card_type  && <Field label={t("card_label_type")} value={[card.card_type, card.card_level].filter(Boolean).join(" / ")} />}
          </>
        )}

        {tab === "billing" && (
          <>
            {[
              { label: t("drop_field_address").replace(" *",""), value: card?.billing_address },
              { label: t("drop_field_city").replace(" *",""), value: card?.city },
              { label: t("drop_field_state"), value: card?.state },
              { label: t("drop_field_zip").replace(" *",""), value: card?.zip },
              { label: t("drop_field_country").replace(" *",""), value: card?.country },
            ].map(({ label, value }) => (
              <Field key={label} label={label} value={value} />
            ))}
            <button
              className="btn btn-b"
              style={{ width: "100%", marginTop: 8, justifyContent: "center" }}
              onClick={() => {
                const addr = [card?.billing_address, card?.city, card?.state, card?.zip, card?.country]
                  .filter(Boolean).join(", ");
                navigator.clipboard.writeText(addr);
                toastOk("Billing address copied");
              }}
            >
              Copy Billing Address
            </button>
          </>
        )}

        {tab === "shipping" && (
          drop ? (
            <>
              {[
                { label: t("drop_field_recipient"), value: drop.recipient_name },
                { label: t("drop_field_address").replace(" *",""), value: drop.address },
                { label: t("drop_field_city").replace(" *",""), value: drop.city },
                { label: t("drop_field_state"), value: drop.state },
                { label: t("drop_field_zip").replace(" *",""), value: drop.zip },
                { label: t("drop_field_country").replace(" *",""), value: drop.country },
                { label: t("drop_field_phone"), value: drop.phone },
              ].map(({ label, value }) => (
                <Field key={label} label={label} value={value} />
              ))}
              <button
                className="btn btn-b"
                style={{ width: "100%", marginTop: 8, justifyContent: "center" }}
                onClick={() => {
                  const addr = [drop.recipient_name, drop.address, drop.city, drop.state, drop.zip, drop.country]
                    .filter(Boolean).join(", ");
                  navigator.clipboard.writeText(addr);
                  toastOk("Shipping address copied");
                }}
              >
                Copy Shipping Address
              </button>
            </>
          ) : (
            <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", marginTop: 30 }}>
              No drop address configured
            </div>
          )
        )}

        {/* F1: Recent Orders tab */}
        {tab === "orders" && (
          <>
          {/* Quick Order inline form */}
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
            <button className="btn btn-g btn-s" onClick={() => { setShowQuickOrder(v => !v); setQuickUrl(""); }} style={{ fontSize: 10, padding: "2px 8px" }}>
              + Order
            </button>
          </div>
          {showQuickOrder && (
            <div style={{ padding: "8px", background: "var(--surface2)", borderRadius: 6, marginBottom: 8 }}>
              <input
                className="inp"
                placeholder="Shop URL..."
                value={quickUrl}
                onChange={e => setQuickUrl(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key !== "Enter" || !quickUrl.trim()) return;
                  try {
                    const shop = await invoke("find_or_create_shop", { url: quickUrl.trim() });
                    await invoke("create_order", {
                      input: {
                        profile_id: String(profileId),
                        shop_id: shop.id,
                        drop_id: null,
                        email_pool_id: null,
                        proxy_id: null,
                        order_number: null,
                        notes: null,
                        items: [{ name: shop.domain, sku: "", qty: 1, price: 0 }],
                      }
                    });
                    setQuickUrl("");
                    setShowQuickOrder(false);
                    load(profileId);
                    toastOk("Order created!");
                  } catch (err) { toastErr(String(err)); }
                }}
                style={{ fontSize: 11, marginBottom: 4 }}
                autoFocus
              />
              <div style={{ fontSize: 10, color: "var(--muted)" }}>Press Enter to create</div>
              <button style={{ fontSize: 10, color: "var(--muted)", background: "none", border: "none", cursor: "pointer" }} onClick={() => setShowQuickOrder(false)}>Cancel</button>
            </div>
          )}
          {recentOrders.length === 0 ? (
            <div style={{ textAlign: "center", fontSize: 12, color: "var(--muted)", marginTop: 30 }}>
              No orders yet
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {recentOrders.map(order => (
                <div
                  key={order.id}
                  onClick={() => invoke("open_main_window_page", { page: "orders" }).catch(() => {})}
                  style={{
                    background: "rgba(255,255,255,0.04)", borderRadius: 8, padding: "8px 10px",
                    border: "1px solid var(--border)", cursor: "pointer",
                    display: "flex", flexDirection: "column", gap: 4,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 12, fontWeight: 500, flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {order.shop_name ?? `Shop #${order.shop_id}`}
                    </span>
                    <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
                      <span className={`st ${STATUS_CSS[order.status] ?? ""}`} style={{ fontSize: 10 }}>
                        {order.status}
                      </span>
                      {/* F2: Quick status change dropdown */}
                      <select
                        value={order.status}
                        onChange={async (e) => {
                          try {
                            await invoke("update_order_status", { id: order.id, status: e.target.value, meta: null });
                            toastOk("Status updated");
                            load(profileId);
                          } catch (err) { toastErr(String(err)); }
                        }}
                        style={{ fontSize: 10, padding: "1px 4px", borderRadius: 4, border: "1px solid var(--border)", background: "var(--surface2)", color: "var(--text)", cursor: "pointer" }}
                        onClick={e => e.stopPropagation()}
                      >
                        {["Pending","Processing","Shipped","Delivered","Cancelled","Declined"].map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--muted)" }}>
                    <span>{fmtDate(order.created_at)}</span>
                    {order.tracking_number && (
                      <span style={{ fontFamily: "monospace" }}>{order.tracking_number.slice(0, 16)}</span>
                    )}
                  </div>
                </div>
              ))}
              <button
                className="btn btn-ghost btn-sm"
                style={{ marginTop: 4, justifyContent: "center" }}
                onClick={() => invoke("open_main_window_page", { page: "orders" }).catch(() => {})}
              >
                View all orders →
              </button>
            </div>
          )}
          </>
        )}
      </div>

      {/* ── Footer actions ── */}
      <div style={{ display: "flex", gap: 8, padding: "10px 12px", borderTop: "1px solid var(--border)", background: "rgba(17,21,32,0.75)" }}>
        <button
          className="btn btn-ghost btn-sm"
          style={{ fontSize: 10, padding: "4px 8px" }}
          onClick={() => invoke("open_main_window_page", { page: "orders" }).catch(() => {})}
        >
          + Order
        </button>
        <button
          className="btn btn-g"
          style={{ flex: 1, justifyContent: "center", opacity: latestOrderId ? 1 : 0.35, cursor: latestOrderId ? "pointer" : "not-allowed" }}
          disabled={!latestOrderId}
          onClick={async () => {
            if (!latestOrderId) return;
            try {
              await invoke("update_order_status", { id: latestOrderId, status: "delivered", meta: null });
              toastOk("Order marked as delivered");
              await load(profileId);
            } catch (e) { toastErr(String(e)); }
          }}
        >
          ✓ Delivered
        </button>
        <button
          className="btn btn-r"
          style={{ flex: 1, justifyContent: "center", opacity: latestOrderId ? 1 : 0.35, cursor: latestOrderId ? "pointer" : "not-allowed" }}
          disabled={!latestOrderId}
          onClick={async () => {
            if (!latestOrderId) return;
            try {
              await invoke("update_order_status", { id: latestOrderId, status: "declined", meta: null });
              toastOk("Order marked as declined");
              await load(profileId);
            } catch (e) { toastErr(String(e)); }
          }}
        >
          ✗ Declined
        </button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <LangProvider><ToastProvider><ProfileFloat /></ToastProvider></LangProvider>
);
