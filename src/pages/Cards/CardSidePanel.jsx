import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLang } from "../../hooks/useLang.jsx";
import { useToast } from "../../hooks/useToast.jsx";
import { formatCardNumber, formatBinMasked, buildPipeString, countryFlag } from "../../utils/formatting.js";
import { getBinBadge } from "../../constants/cardTypes.js";
import { CardField } from "./CardField.jsx";

const STATUS_CSS = {
  free:    "st-free",
  in_use:  "st-inuse",
  dead:    "st-dead",
  archive: "st-archive",
};

export function CardSidePanel({ card, cards, idx, revealed, onClose, onNavigate, onStatusChange, onDelete, onCopy }) {
  const { t } = useLang();
  const { toast } = useToast();
  const rev = revealed[card.id];
  const displayNum = rev?.card_number ? formatCardNumber(rev.card_number) : formatBinMasked(card.bin, card.last4);
  const statusCls   = STATUS_CSS[card.status] ?? "st-archive";
  const statusLabel = card.status === "in_use" ? "in use" : card.status;
  const badge = getBinBadge(card.card_type);

  useEffect(() => {
    const handler = (e) => {
      if (e.key === "Escape")    { onClose(); return; }
      if (e.key === "ArrowDown") { const n = Math.min(idx + 1, cards.length - 1); onNavigate(cards[n], n); }
      if (e.key === "ArrowUp")   { const p = Math.max(idx - 1, 0);               onNavigate(cards[p], p); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [idx, cards, onClose, onNavigate]);

  const copyField = (val) => {
    if (!val) return;
    navigator.clipboard.writeText(val).then(() => {}, () => {});
  };

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{
          position: "fixed", inset: 0, right: 340,
          background: "rgba(0,0,0,0.25)", zIndex: 199,
        }}
      />
      {/* Panel */}
      <div style={{
        position: "fixed", right: 0, top: 0, width: 340, height: "100vh",
        background: "var(--card)", borderLeft: "1px solid var(--border)",
        zIndex: 200, display: "flex", flexDirection: "column",
        boxShadow: "-8px 0 32px rgba(0,0,0,0.45)",
        animation: "side-panel-in 200ms ease-out",
      }}>
        {/* Header */}
        <div style={{
          padding: "14px 16px", borderBottom: "1px solid var(--border)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="bg-transparent border-none text-muted cursor-pointer text-[16px] p-0 leading-none">✕</button>
            <span className="text-[12px] font-semibold text-text">{t("section_card")}</span>
            <span className="text-[10px] text-muted">{idx + 1} / {cards.length}</span>
          </div>
          <div className="flex gap-1">
            <button
              onClick={() => idx > 0 && onNavigate(cards[idx - 1], idx - 1)}
              disabled={idx === 0}
              className="btn btn-ghost btn-sm px-[7px] py-[3px]"
            >↑</button>
            <button
              onClick={() => idx < cards.length - 1 && onNavigate(cards[idx + 1], idx + 1)}
              disabled={idx === cards.length - 1}
              className="btn btn-ghost btn-sm px-[7px] py-[3px]"
            >↓</button>
          </div>
        </div>

        {/* Card number hero */}
        <div style={{
          padding: "16px", background: "var(--surface)",
          borderBottom: "1px solid var(--border)",
        }}>
          <div className="flex items-center gap-2 mb-2">
            {badge && (
              <span style={{
                padding: "2px 7px", borderRadius: 5, fontSize: 10, fontWeight: 700,
                background: badge.bg, color: badge.color,
                fontFamily: "'JetBrains Mono',monospace",
              }}>
                {badge.label}
              </span>
            )}
            {card.country && (
              <span className="text-[14px]">{countryFlag(card.country)}</span>
            )}
            <span className={`st ${statusCls}`}>{statusLabel}</span>
            {(card.orders_count ?? 0) > 0 && (
              <span style={{
                fontSize: 10, fontFamily: "'JetBrains Mono',monospace",
                color: (card.orders_count ?? 0) >= 5 ? "#fb923c" : (card.orders_count ?? 0) >= 3 ? "#facc15" : "var(--muted)",
              }} title={t("used_in_orders").replace("{n}", card.orders_count)}>
                ×{card.orders_count}
              </span>
            )}
          </div>
          <div style={{
            fontFamily: "'JetBrains Mono',monospace", fontSize: 15,
            fontWeight: 700, color: "var(--text)", letterSpacing: "0.05em",
            marginBottom: 4,
          }}>
            {displayNum}
          </div>
          <div className="flex gap-2 mt-2.5">
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => onCopy(buildPipeString(card, rev))}
            >
              ⧉ Copy Full
            </button>
          </div>
        </div>

        {/* Fields */}
        <div className="flex-1 overflow-y-auto px-4">
          <div className="pt-1">
            <CardField label={t("card_label_expiry")} value={card.expiry_date} mono onCopy={copyField} />
            <CardField label="CVV" value={rev?.cvv} mono onCopy={copyField} />
            <CardField label={t("card_label_holder")} value={rev?.holder_name || card.holder_name} onCopy={copyField} />
            <div className="h-px bg-border my-1.5" />
            <CardField label={t("drop_field_address").replace(" *","")} value={rev?.billing_address} onCopy={copyField} />
            <CardField label="ZIP" value={card.zip} mono onCopy={copyField} />
            <CardField label={t("drop_field_city").replace(" *","")} value={card.city} onCopy={copyField} />
            <CardField label={t("drop_field_state")} value={card.state} onCopy={copyField} />
            <CardField label={t("drop_field_country").replace(" *","")} value={card.country ? `${countryFlag(card.country)} ${card.country}` : null} onCopy={copyField} />
            <CardField label={t("drop_field_phone")} value={rev?.phone} mono onCopy={copyField} />
            <div className="h-px bg-border my-1.5" />
            <CardField label={t("card_label_bank")} value={card.bank_name} onCopy={copyField} />
            <CardField label="BIN" value={card.bin} mono onCopy={copyField} />
            <CardField label={t("card_label_type")} value={card.card_type} onCopy={copyField} />
            <CardField label={t("card_label_level")} value={card.card_level} onCopy={copyField} />
            <CardField label={t("cc_col_source")} value={card.source} onCopy={copyField} />
            <CardField label={t("cc_col_created")} value={card.created_at?.slice(0, 10)} mono onCopy={copyField} />
          </div>
        </div>

        {/* Actions footer */}
        <div style={{
          padding: "12px 16px", borderTop: "1px solid var(--border)",
          display: "flex", gap: 6,
        }}>
          <button className="btn btn-g btn-sm" onClick={() => { onStatusChange(card.id, "free"); onClose(); }}>{t("status_free")}</button>
          <button className="btn btn-r btn-sm" onClick={() => { onStatusChange(card.id, "dead"); onClose(); }}>{t("status_dead")}</button>
          <button className="btn btn-ghost btn-sm" onClick={() => { onStatusChange(card.id, "archive"); onClose(); }}>{t("status_archive")}</button>
          <button className="btn btn-b btn-sm" onClick={async () => {
            try {
              await invoke("create_profile", { cardId: card.id, notes: null });
              toast(t("profile_created"), "success");
              onClose();
              onNavigate?.("profiles");
            } catch (e) {
              toast(String(e) === "card_already_in_use" ? t("card_already_in_use") : String(e), "error");
            }
          }}>{t("new_profile")}</button>
          <button className="btn btn-r btn-sm ml-auto" onClick={() => { onDelete(card.id); onClose(); }}>{t("btn_delete")}</button>
        </div>
      </div>
    </>
  );
}
