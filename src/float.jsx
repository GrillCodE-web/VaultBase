import React, { useState, useEffect, useCallback } from "react";
import ReactDOM from "react-dom/client";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Copy, Check, Eye, EyeOff, Lock } from "lucide-react";
import "./index.css";

// ─── Copy button ──────────────────────────────────────────────
function CopyBtn({ value, size = 13 }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    if (!value) return;
    navigator.clipboard.writeText(String(value)).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };
  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded transition-colors"
      style={{
        color: copied ? "#22c55e" : "#4b5563",
        background: copied ? "rgba(34,197,94,0.15)" : "transparent",
        border: "none",
        cursor: "pointer",
      }}
      title="Copy"
    >
      {copied ? <Check size={size} /> : <Copy size={size} />}
    </button>
  );
}

// ─── Field row ────────────────────────────────────────────────
function Field({ label, value, secret, onReveal, revealed }) {
  const display = secret && !revealed ? "••••••••" : (value ?? "—");
  return (
    <div className="flex items-center justify-between py-1.5" style={{ borderBottom: "1px solid #1e2338" }}>
      <span className="text-xs text-gray-500 w-28 flex-shrink-0">{label}</span>
      <div className="flex items-center gap-1 flex-1 justify-end min-w-0">
        <span className="text-xs text-white truncate max-w-[180px] font-mono">{display}</span>
        {secret && (
          <button
            onClick={onReveal}
            className="p-1 rounded transition-colors"
            style={{ color: "#4b5563" }}
          >
            {revealed ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        )}
        {!secret && <CopyBtn value={value} />}
        {secret && revealed && <CopyBtn value={value} />}
      </div>
    </div>
  );
}

// ─── Risk badge ───────────────────────────────────────────────
function RiskBadge({ level }) {
  if (!level) return null;
  const map = {
    safe:    { color: "#22c55e", bg: "rgba(34,197,94,0.12)",   border: "rgba(34,197,94,0.25)",   label: "Safe",      icon: "🟢" },
    warning: { color: "#eab308", bg: "rgba(234,179,8,0.12)",   border: "rgba(234,179,8,0.25)",   label: "Warning",   icon: "🟡" },
    high:    { color: "#ef4444", bg: "rgba(239,68,68,0.12)",   border: "rgba(239,68,68,0.25)",   label: "High Risk", icon: "🔴" },
  };
  const cfg = map[level] ?? map.warning;
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 4,
      fontSize: 11, fontWeight: 500, color: cfg.color,
      background: cfg.bg, border: `1px solid ${cfg.border}`,
      borderRadius: 999, padding: "2px 8px",
    }}>
      {cfg.icon} {cfg.label}
    </span>
  );
}

// ─── Main float component ─────────────────────────────────────
function ProfileFloat() {
  const [profile, setProfile] = useState(null);
  const [card, setCard] = useState(null);
  const [drop, setDrop] = useState(null);
  const [latestOrderId, setLatestOrderId] = useState(null);
  const [tab, setTab] = useState("card");
  const [revealed, setRevealed] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [appLocked, setAppLocked] = useState(false);

  // Extract profile_id from URL query param
  const profileId = (() => {
    try {
      return new URLSearchParams(window.location.search).get("id");
    } catch {
      return null;
    }
  })();

  const load = useCallback(async () => {
    if (!profileId) { setError("No profile ID"); setLoading(false); return; }
    try {
      await new Promise((r) => setTimeout(r, 200)); // small delay to avoid white flash
      const p = await invoke("get_profile", { id: Number(profileId) });
      setProfile(p);
      if (p.card_id) {
        try {
          const c = await invoke("get_card", { id: p.card_id });
          setCard(c);
        } catch (_) {}
      }
      if (p.drops?.length > 0) {
        const primary = p.drops.find((d) => d.is_primary) ?? p.drops[0];
        setDrop(primary);
      }
      try {
        const order = await invoke("get_latest_order_by_profile", { profileId: String(profileId) });
        if (order) setLatestOrderId(order.id);
      } catch (_) {}
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    let unlisten;
    listen("app_locked", () => setAppLocked(true)).then((u) => { unlisten = u; });
    return () => { if (unlisten) unlisten(); };
  }, []);

  const reveal = (key) => {
    if (revealed[key]) {
      setRevealed((p) => ({ ...p, [key]: false }));
      return;
    }
    // For card number and CVV, use reveal_card
    if (key === "number" && card) {
      invoke("reveal_card", { id: card.id }).then((full) => {
        setCard((c) => ({ ...c, _full: full }));
        setRevealed((p) => ({ ...p, [key]: true }));
      }).catch(() => {});
    } else {
      setRevealed((p) => ({ ...p, [key]: true }));
    }
  };

  const cardNumber = revealed.number
    ? (card?._full?.card_number ?? card?.card_number)
    : card
    ? `••••-••••-••••-${card.last4 ?? "?????"}`
    : null;

  const cvv = revealed.cvv
    ? (card?._full?.cvv ?? card?.cvv ?? "—")
    : card?.cvv
    ? "•••"
    : null;

  if (appLocked) {
    return (
      <div className="flex flex-col items-center justify-center h-screen gap-3" style={{ backgroundColor: "#0b0d14" }}>
        <Lock size={28} style={{ color: "#6b7280" }} />
        <span className="text-sm text-gray-500">App locked</span>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: "#0b0d14" }}>
        <div className="w-6 h-6 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="flex items-center justify-center h-screen" style={{ backgroundColor: "#0b0d14" }}>
        <div className="text-red-400 text-sm">{error ?? "Profile not found"}</div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen" style={{ backgroundColor: "#0b0d14", color: "#fff", fontSize: 13 }}>
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-2.5"
        style={{ backgroundColor: "#171b28", borderBottom: "1px solid #1e2338" }}
      >
        <div>
          <span className="font-semibold text-white text-sm">{profile.holder_name || "Profile"}</span>
          {card && (
            <span className="ml-2 text-xs text-gray-500">••{card.last4}</span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <RiskBadge level={profile.risk_level} />
          {card && (
            <span className="text-xs px-2 py-0.5 rounded-full" style={{
              backgroundColor: card.status === "free" ? "rgba(34,197,94,0.1)" : "rgba(107,114,128,0.1)",
              color: card.status === "free" ? "#22c55e" : "#9ca3af",
            }}>
              {card.status}
            </span>
          )}
          <button
            onClick={() => getCurrentWindow().close()}
            style={{
              width: 14, height: 14, borderRadius: "50%",
              background: "#ef4444", border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 9, color: "rgba(0,0,0,0.6)", fontWeight: 700, lineHeight: 1,
            }}
            title="Close"
          >×</button>
        </div>
      </div>

      {/* Tabs — pill style (float window spec) */}
      <div
        style={{
          display: "flex",
          backgroundColor: "#12151f",
          borderBottom: "1px solid #1e2338",
          padding: "6px 10px",
          gap: 4,
        }}
      >
        {[
          { key: "card", label: "Card" },
          { key: "billing", label: "Billing" },
          { key: "shipping", label: "Shipping" },
        ].map(({ key, label }) => {
          const active = tab === key;
          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              style={{
                flex: 1,
                padding: "5px 0",
                borderRadius: 5,
                fontSize: 12,
                fontWeight: active ? 600 : 400,
                color: active ? "#e2e8f0" : "#4b5680",
                background: active ? "#171b28" : "transparent",
                border: active ? "1px solid #1e2338" : "1px solid transparent",
                cursor: "pointer",
                transition: "all 0.15s",
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-4 py-3" style={{ minHeight: 0 }}>
        {tab === "card" && card && (
          <div>
            <Field label="Card Number" value={cardNumber} secret revealed={revealed.number}
              onReveal={() => reveal("number")} />
            <Field label="Expiry" value={card.expiry_date} />
            <Field label="CVV" value={cvv} secret revealed={revealed.cvv}
              onReveal={() => reveal("cvv")} />
            <Field label="Holder" value={card.holder_name} />
            {profile.email_hash && (
              <Field label="Email" value={profile._email ?? profile.email_hash} />
            )}
            {profile.phone && (
              <Field label="Phone" value={profile.phone} />
            )}
            {card.bank_name && (
              <Field label="Bank" value={card.bank_name} />
            )}
            {card.card_type && (
              <Field label="Type" value={[card.card_type, card.card_level].filter(Boolean).join(" / ")} />
            )}
          </div>
        )}

        {tab === "billing" && (
          <div>
            {[
              { label: "Address", value: profile.billing_address },
              { label: "City", value: profile.city },
              { label: "State", value: profile.state },
              { label: "ZIP", value: profile.zip },
              { label: "Country", value: profile.country },
            ].map(({ label, value }) => (
              <Field key={label} label={label} value={value} />
            ))}
            <button
              onClick={() => {
                const addr = [profile.billing_address, profile.city, profile.state, profile.zip, profile.country]
                  .filter(Boolean).join(", ");
                navigator.clipboard.writeText(addr);
              }}
              className="mt-3 w-full py-2 rounded-xl text-xs font-medium transition-colors"
              style={{ backgroundColor: "rgba(59,130,246,0.1)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.2)" }}
            >
              Copy Billing Address
            </button>
          </div>
        )}

        {tab === "shipping" && (
          <div>
            {drop ? (
              <>
                {[
                  { label: "Recipient", value: drop.recipient_name },
                  { label: "Address", value: drop.address },
                  { label: "City", value: drop.city },
                  { label: "State", value: drop.state },
                  { label: "ZIP", value: drop.zip },
                  { label: "Country", value: drop.country },
                  { label: "Phone", value: drop.phone },
                ].map(({ label, value }) => (
                  <Field key={label} label={label} value={value} />
                ))}
                <button
                  onClick={() => {
                    const addr = [drop.recipient_name, drop.address, drop.city, drop.state, drop.zip, drop.country]
                      .filter(Boolean).join(", ");
                    navigator.clipboard.writeText(addr);
                  }}
                  className="mt-3 w-full py-2 rounded-xl text-xs font-medium transition-colors"
                  style={{ backgroundColor: "rgba(59,130,246,0.1)", color: "#3b82f6", border: "1px solid rgba(59,130,246,0.2)" }}
                >
                  Copy Shipping Address
                </button>
              </>
            ) : (
              <div className="text-center text-sm text-gray-500 mt-8">No drop address configured</div>
            )}
          </div>
        )}
      </div>
      {/* Bottom action buttons */}
      <div style={{
        display: "flex", gap: 8, padding: "10px 16px",
        borderTop: "1px solid #1e2338", backgroundColor: "#171b28",
      }}>
        <button
          disabled={!latestOrderId}
          onClick={() => latestOrderId && invoke("update_order_status", { id: latestOrderId, status: "delivered", meta: null }).catch(() => {})}
          style={{
            flex: 1, padding: "7px 0", fontSize: 12, fontWeight: 600,
            background: latestOrderId ? "rgba(34,197,94,0.12)" : "rgba(34,197,94,0.04)",
            border: `1px solid ${latestOrderId ? "rgba(34,197,94,0.25)" : "rgba(34,197,94,0.1)"}`,
            borderRadius: 8, color: latestOrderId ? "#22c55e" : "#374a3a",
            cursor: latestOrderId ? "pointer" : "not-allowed",
          }}
        >
          ✓ Success
        </button>
        <button
          disabled={!latestOrderId}
          onClick={() => latestOrderId && invoke("update_order_status", { id: latestOrderId, status: "declined", meta: null }).catch(() => {})}
          style={{
            flex: 1, padding: "7px 0", fontSize: 12, fontWeight: 600,
            background: latestOrderId ? "rgba(239,68,68,0.12)" : "rgba(239,68,68,0.04)",
            border: `1px solid ${latestOrderId ? "rgba(239,68,68,0.25)" : "rgba(239,68,68,0.1)"}`,
            borderRadius: 8, color: latestOrderId ? "#ef4444" : "#4a3737",
            cursor: latestOrderId ? "pointer" : "not-allowed",
          }}
        >
          ✗ Decline
        </button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <ProfileFloat />
);
