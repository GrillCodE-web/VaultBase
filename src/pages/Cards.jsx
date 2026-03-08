import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLang } from "../hooks/useLang.jsx";
import { useToast } from "../hooks/useToast.jsx";
import { useConfirm } from "../hooks/useConfirm.jsx";

// ─── Helpers ──────────────────────────────────────────────────────────────

function countryFlag(code) {
  if (!code || code.length !== 2) return "";
  const offset = 0x1F1A5;
  return String.fromCodePoint(code.toUpperCase().charCodeAt(0) + offset) +
         String.fromCodePoint(code.toUpperCase().charCodeAt(1) + offset);
}

// ─── Constants ────────────────────────────────────────────────────────────

const STATUS_CSS = {
  free:    "st-free",
  in_use:  "st-inuse",
  dead:    "st-dead",
  archive: "st-archive",
};

const FIELD_OPTIONS = [
  "skip","card_number","expiry_date","cvv","holder_name",
  "billing_address","city","state","zip","country","phone","email","ip_address",
];

const ALL_COLUMNS = [
  { id: "card_number", label: "cc_col_number"  },
  { id: "bin_bank",    label: "cc_col_bin"     },
  { id: "type",        label: "cc_col_type"    },
  { id: "holder",      label: "cc_col_holder"  },
  { id: "country",     label: "cc_col_country" },
  { id: "source",      label: "cc_col_source"  },
  { id: "status",      label: "cc_col_status"  },
  { id: "notes",       label: "cc_col_notes"   },
  { id: "created",     label: "cc_col_created" },
  { id: "expiry",      label: "Expiry"         },
  { id: "cvv",         label: "CVV"            },
  { id: "zip",         label: "ZIP"            },
  { id: "city",        label: "City"           },
  { id: "state",       label: "State"          },
  { id: "phone",       label: "Phone"          },
  { id: "email_cc",    label: "Email"          },
  { id: "ip",          label: "IP"             },
  { id: "billing",     label: "Billing"        },
  { id: "actions",     label: "cc_col_actions" },
];

// ─── Small helpers ────────────────────────────────────────────────────────

function copyToClipboard(text, toast) {
  navigator.clipboard.writeText(text).then(
    () => toast.success("Copied"),
    () => toast.error("Copy failed"),
  );
}

function expiryDaysLeft(expiry) {
  if (!expiry) return null;
  const [mm, yy] = expiry.split("/");
  if (!mm || !yy) return null;
  const month = parseInt(mm, 10);
  const year = 2000 + parseInt(yy, 10);
  if (isNaN(month) || isNaN(year)) return null;
  const expires = new Date(year, month, 0);
  const now = new Date();
  return Math.floor((expires - now) / 86400000);
}

function ExpiryCell({ expiry }) {
  if (!expiry) return <span style={{ color: "var(--muted)" }}>—</span>;
  const days = expiryDaysLeft(expiry);
  const color = days === null ? "var(--muted)"
    : days < 0  ? "#ef4444"
    : days < 30 ? "#ef4444"
    : days < 60 ? "#eab308"
    : "var(--muted)";
  return (
    <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color }}>
      {expiry}
    </span>
  );
}

function formatCardNumber(num) {
  const d = num.replace(/\D/g, "");
  return d.match(/.{1,4}/g)?.join("-") ?? d;
}

function formatBinMasked(bin, last4) {
  // Format: "XXXX XX** **** XXXX" using BIN prefix + last4
  if (!bin || bin.length < 6) {
    return `••••-••••-••••-${last4 || "????"}`;
  }
  const part1 = bin.slice(0, 4);
  const part2 = bin.slice(4, 6) + "**";
  return `${part1}-${part2}-****-${last4 || "????"}`;
}

function Spinner() {
  return (
    <span style={{
      display: "inline-block", width: 12, height: 12, marginRight: 6,
      border: "2px solid rgba(255,255,255,0.3)", borderTopColor: "#fff",
      borderRadius: "50%", animation: "spin 0.7s linear infinite", verticalAlign: "middle",
    }} />
  );
}

// ─── ImportModal ─────────────────────────────────────────────────────────

function ImportModal({ onClose, onImported }) {
  const { t } = useLang();
  const toast  = useToast();
  const [step, setStep]       = useState(1);
  const [raw, setRaw]         = useState("");
  const [source, setSource]   = useState("");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState(null);
  const [mapping, setMapping] = useState([]);
  const [result, setResult]   = useState(null);

  const handlePreview = async () => {
    if (!raw.trim()) { toast.warn("Paste some card data first"); return; }
    setLoading(true);
    try {
      const data = await invoke("detect_mapping_preview", { raw });
      setPreview(data);
      setMapping([...data.detected_mapping]);
      setStep(2);
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleToMapping = () => setStep(3);

  const handleImport = async () => {
    setLoading(true);
    try {
      const res = await invoke("import_cards", {
        raw,
        mapping,
        source: source || "dump",
      });
      setResult(res);
      onImported?.();
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  const colCount = preview?.preview_rows?.[0]?.length ?? 0;

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 680, width: "100%", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span className="modal-title" style={{ margin: 0 }}>{t("cc_import_title")}</span>
            <div style={{ display: "flex", gap: 4 }}>
              {[1,2,3].map(s => (
                <div key={s} style={{
                  width: 24, height: 4, borderRadius: 4,
                  background: s <= step ? "var(--accent)" : "var(--border)",
                  transition: "background 0.2s",
                }} />
              ))}
            </div>
          </div>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div style={{ overflowY: "auto", flex: 1, padding: "20px" }}>

          {/* Step 1: Input */}
          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <p style={{ color: "var(--muted)", fontSize: 12, margin: 0 }}>{t("cc_import_step1_hint")}</p>
              <textarea
                value={raw}
                onChange={e => setRaw(e.target.value)}
                placeholder="4111111111111111|12/26|123|JOHN SMITH|john@example.com..."
                rows={10}
                className="form-input"
                style={{ fontFamily: "'JetBrains Mono',monospace", resize: "none", fontSize: 12 }}
              />
              <div className="form-group">
                <label className="form-label">{t("cc_import_source_label")}</label>
                <input
                  value={source}
                  onChange={e => setSource(e.target.value)}
                  placeholder="nike-dump-jan"
                  className="form-input"
                />
              </div>
            </div>
          )}

          {/* Step 2: Preview */}
          {step === 2 && preview && (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              <p style={{ color: "var(--muted)", fontSize: 12, margin: 0 }}>{t("cc_import_step2_hint")}</p>
              <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      {preview.detected_mapping.map((field, i) => (
                        <th key={i}>
                          <span style={{
                            padding: "2px 6px", borderRadius: 4, fontSize: 10,
                            background: field !== "skip" ? "rgba(34,197,94,0.12)" : "transparent",
                            color: field !== "skip" ? "#4ade80" : "var(--muted)",
                            border: field !== "skip" ? "1px solid rgba(34,197,94,0.25)" : "none",
                          }}>
                            {field !== "skip" ? `✓ ${field}` : `col ${i+1}`}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview_rows.map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci} style={{ fontFamily: "'JetBrains Mono',monospace", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Step 3: Mapping */}
          {step === 3 && preview && (
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <p style={{ color: "var(--muted)", fontSize: 12, margin: 0 }}>{t("cc_import_step3_hint")}</p>
              {Array.from({ length: colCount }).map((_, ci) => (
                <div key={ci} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", background: "var(--surface)", borderRadius: 7,
                  border: "1px solid var(--border)",
                }}>
                  <div style={{
                    width: 22, height: 22, borderRadius: 5, background: "var(--border)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 11, color: "var(--muted)", flexShrink: 0,
                  }}>
                    {ci + 1}
                  </div>
                  <div style={{ flex: 1, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                    {preview.preview_rows[0]?.[ci] ?? "—"}
                  </div>
                  <select
                    value={mapping[ci] ?? "skip"}
                    onChange={e => {
                      const m = [...mapping];
                      m[ci] = e.target.value;
                      setMapping(m);
                    }}
                    style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, padding: "5px 10px", fontSize: 12, outline: "none" }}
                  >
                    {FIELD_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              ))}

              {result && (
                <div style={{
                  marginTop: 8, padding: 14, background: "rgba(34,197,94,0.08)",
                  border: "1px solid rgba(34,197,94,0.25)", borderRadius: 8,
                }}>
                  <p style={{ color: "#4ade80", fontWeight: 600, fontSize: 13, margin: "0 0 6px" }}>{t("cc_import_done")}</p>
                  <div style={{ display: "flex", gap: 20, fontSize: 12, color: "var(--muted)" }}>
                    <span>✓ Imported: <strong style={{ color: "#4ade80" }}>{result.imported}</strong></span>
                    <span>↷ Skipped: <strong style={{ color: "#facc15" }}>{result.skipped}</strong></span>
                    <span>✗ Errors: <strong style={{ color: "#f87171" }}>{result.errors?.length ?? 0}</strong></span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 20px", borderTop: "1px solid var(--border)" }}>
          <button
            onClick={() => step > 1 && !result ? setStep(s => s - 1) : onClose()}
            className="btn btn-ghost btn-sm"
          >
            {result ? t("btn_close") : step > 1 ? "← Back" : t("btn_cancel")}
          </button>
          <div style={{ display: "flex", gap: 8 }}>
            {step === 1 && (
              <button onClick={handlePreview} disabled={loading || !raw.trim()} className="btn btn-p">
                {loading && <Spinner />}
                {t("cc_import_preview")} →
              </button>
            )}
            {step === 2 && (
              <button onClick={handleToMapping} className="btn btn-p">
                {t("cc_import_mapping")} →
              </button>
            )}
            {step === 3 && !result && (
              <button onClick={handleImport} disabled={loading} className="btn btn-p">
                {loading && <Spinner />}
                {t("cc_import_do")}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Column visibility picker ─────────────────────────────────────────────

function ColumnPicker({ visible, onChange, onClose }) {
  const { t } = useLang();
  return (
    <div style={{
      position: "absolute", right: 0, top: 38, zIndex: 20,
      background: "var(--card)", border: "1px solid var(--border)",
      borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      padding: 10, minWidth: 180,
    }}>
      <p className="ptitle" style={{ marginBottom: 8, paddingLeft: 4 }}>{t("cc_columns")}</p>
      {ALL_COLUMNS.filter(c => c.id !== "actions").map(col => (
        <label key={col.id} style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "5px 8px", borderRadius: 6, cursor: "pointer",
          fontSize: 12, color: "var(--muted)",
        }}>
          <input
            type="checkbox"
            checked={visible.includes(col.id)}
            onChange={e => {
              if (e.target.checked) onChange([...visible, col.id]);
              else onChange(visible.filter(v => v !== col.id));
            }}
            style={{ accentColor: "var(--accent)" }}
          />
          {t(col.label)}
        </label>
      ))}
    </div>
  );
}

// ─── Note inline editor ───────────────────────────────────────────────────

function NoteCell({ card, onEditNote }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(card.notes || "");

  if (editing) {
    return (
      <input
        autoFocus
        value={val}
        onChange={e => setVal(e.target.value)}
        onBlur={() => { onEditNote(card.id, val); setEditing(false); }}
        onKeyDown={e => {
          if (e.key === "Enter") { onEditNote(card.id, val); setEditing(false); }
          if (e.key === "Escape") { setVal(card.notes || ""); setEditing(false); }
        }}
        className="form-input"
        style={{ fontSize: 11, padding: "2px 6px", width: "100%" }}
      />
    );
  }
  return (
    <span
      onDoubleClick={() => setEditing(true)}
      style={{ color: "var(--muted)", fontSize: 11, cursor: "text", display: "block", maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
      title={val || "—"}
    >
      {val || "—"}
    </span>
  );
}

// ─── buildPageNumbers ─────────────────────────────────────────────────────

function buildPageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1];
  if (current > 3) pages.push("…");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p);
  if (current < total - 2) pages.push("…");
  pages.push(total);
  return pages;
}

// ─── Main Cards page ──────────────────────────────────────────────────────

export default function Cards({ onNavigate, activeTab = "list", openImport = false }) {
  const { t } = useLang();
  const toast   = useToast();
  const confirm = useConfirm();

  // ── State ──────────────────────────────────────────────────────────────

  const [cards, setCards]           = useState([]);
  const [total, setTotal]           = useState(0);
  const [freeTotal, setFreeTotal]   = useState(0);
  const [page, setPage]             = useState(1);
  const [loading, setLoading]       = useState(false);
  const [showImport, setShowImport] = useState(openImport);
  const [showColPicker, setShowColPicker] = useState(false);
  const [compact, setCompact]       = useState(false);
  const [groupByBank, setGroupByBank] = useState(false);

  const [selected, setSelected]     = useState(new Set());
  const [revealed, setRevealed]     = useState({});

  const [visibleCols, setVisibleCols] = useState(
    ["card_number","bin_bank","type","expiry","holder","country","zip","city","state","status","source","notes","actions"]
  );

  const [filter, setFilter] = useState({
    status: null, country: null, bank_name: null, source: null,
    card_type: null, search: null, state: null, zip_prefix: null,
  });
  const [searchInput, setSearchInput] = useState("");

  const PER_PAGE = 50;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  // ── Load cards ─────────────────────────────────────────────────────────

  const loadCards = useCallback(async () => {
    setLoading(true);
    try {
      const res = await invoke("get_cards", {
        filter,
        page,
        perPage: PER_PAGE,
      });
      setCards(res.items);
      setTotal(res.total);
      setFreeTotal(res.free_total ?? 0);
      if (res.items.length === 0 && res.total > 0 && page > 1) {
        setPage((p) => Math.max(1, p - 1));
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => { loadCards(); }, [loadCards]);

  useEffect(() => {
    setFilter(f => ({ ...f, expiring_soon: activeTab === "expiring" ? true : null }));
    setPage(1);
  }, [activeTab]);

  // ── Selection helpers ──────────────────────────────────────────────────

  const toggleSelect = (id) => {
    setSelected(prev => {
      const n = new Set(prev);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });
  };

  const toggleSelectAll = () => {
    if (selected.size === cards.length) setSelected(new Set());
    else setSelected(new Set(cards.map(c => c.id)));
  };

  // ── Actions ────────────────────────────────────────────────────────────

  const handleReveal = async (id) => {
    if (revealed[id]) { setRevealed(r => { const n = { ...r }; delete n[id]; return n; }); return; }
    try {
      const data = await invoke("reveal_card", { id });
      setRevealed(r => ({ ...r, [id]: data }));
    } catch (e) { toast.error(String(e)); }
  };

  const handleRevealAll = async () => {
    const unrevealed = cards.filter(c => !revealed[c.id]);
    for (const card of unrevealed) {
      try {
        const data = await invoke("reveal_card", { id: card.id });
        setRevealed(r => ({ ...r, [card.id]: data }));
      } catch(e) {}
    }
  };

  const handleCopyNum = async (id) => {
    const rev = revealed[id];
    if (rev) { copyToClipboard(formatCardNumber(rev.card_number), toast); return; }
    try {
      const data = await invoke("reveal_card", { id });
      copyToClipboard(formatCardNumber(data.card_number), toast);
    } catch (e) { toast.error(String(e)); }
  };

  const handleStatusChange = async (id, status) => {
    if (status === "dead") {
      const ok = await confirm(t("cc_confirm_dead"), t("cc_mark_dead"));
      if (!ok) return;
    }
    try {
      await invoke("update_card_status", { id, status });
      toast.success(`Marked as ${status}`);
      loadCards();
    } catch (e) { toast.error(String(e)); }
  };

  const handleDelete = async (id) => {
    const ok = await confirm(t("msg_confirm_delete"), t("btn_delete"));
    if (!ok) return;
    try {
      await invoke("delete_card", { id });
      toast.success(t("msg_deleted"));
      loadCards();
    } catch (e) {
      const msg = String(e);
      if (msg.includes("in_use") || msg.includes("card_in_use")) {
        toast.error("Cannot delete: card is linked to an active profile. Mark it dead first or unlink the profile.");
      } else {
        toast.error(msg);
      }
    }
  };

  const handleBulkStatus = async (status) => {
    if (status === "dead") {
      const ok = await confirm(`Mark ${selected.size} cards as dead?`, t("cc_mark_dead"));
      if (!ok) return;
    }
    try {
      await invoke("bulk_update_cards", { ids: [...selected], status });
      toast.success(`${selected.size} cards → ${status}`);
      setSelected(new Set());
      loadCards();
    } catch (e) { toast.error(String(e)); }
  };

  const handleBulkDelete = async () => {
    const ok = await confirm(`Delete ${selected.size} cards?`, t("btn_delete"));
    if (!ok) return;
    try {
      await invoke("bulk_delete_cards", { ids: [...selected] });
      toast.success(`Deleted ${selected.size} cards`);
      setSelected(new Set());
      loadCards();
    } catch (e) { toast.error(String(e)); }
  };

  const handleExport = async (format) => {
    try {
      const content = await invoke("export_cards", { ids: [...selected], format });
      const blob = new Blob([content], { type: "text/plain" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `cards_export.${format === "csv" ? "csv" : "txt"}`;
      a.click();
    } catch (e) { toast.error(String(e)); }
  };

  const handleEditNote = async (id, notes) => {
    try {
      await invoke("update_card_notes", { id, notes });
    } catch (e) { toast.error(String(e)); }
  };

  const handleSearch = () => {
    setFilter(f => ({ ...f, search: searchInput || null }));
    setPage(1);
  };

  const handleResetFilters = () => {
    setFilter({ status: null, country: null, bank_name: null, source: null, card_type: null, search: null, state: null, zip_prefix: null });
    setSearchInput("");
    setPage(1);
  };

  // ── Render helpers ─────────────────────────────────────────────────────

  const allSelected = cards.length > 0 && selected.size === cards.length;
  const someSelected = selected.size > 0 && selected.size < cards.length;

  const renderCard = (card) => {
    const isRevealed = !!revealed[card.id];
    const revealedData = revealed[card.id];
    const displayNumber = isRevealed
      ? formatCardNumber(revealedData.card_number)
      : formatBinMasked(card.bin, card.last4);
    const statusCls = STATUS_CSS[card.status] ?? "st-archive";
    const statusLabel = card.status === "in_use" ? "in use" : card.status;

    return (
      <tr key={card.id} style={{ background: selected.has(card.id) ? "rgba(168,85,247,0.06)" : undefined }}>
        <td>
          <input
            type="checkbox"
            checked={selected.has(card.id)}
            onChange={() => toggleSelect(card.id)}
            style={{ accentColor: "var(--accent)", cursor: "pointer" }}
          />
        </td>

        {visibleCols.includes("card_number") && (
          <td>
            <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 12 }}>{displayNumber}</span>
            {isRevealed && revealedData.cvv && (
              <span style={{ marginLeft: 8, color: "#facc15", fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>
                CVV:{revealedData.cvv}
              </span>
            )}
            <br />
            <ExpiryCell expiry={card.expiry_date} />
          </td>
        )}

        {visibleCols.includes("bin_bank") && (
          <td>
            <span className="mono" style={{ fontSize: 12, color: "var(--text-2)" }}>{card.bin || "——"}</span>
            {card.bank_name && <span style={{ display: "block", fontSize: 11, color: "var(--muted)" }}>{card.bank_name}</span>}
          </td>
        )}

        {visibleCols.includes("type") && (
          <td style={{ color: "var(--text-2)" }}>
            {card.card_type || "—"}
            {card.card_level && <span style={{ marginLeft: 4, fontSize: 11, color: "var(--muted)" }}>{card.card_level}</span>}
          </td>
        )}

        {visibleCols.includes("holder") && (
          <td style={{ color: "var(--text-2)", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {isRevealed ? revealedData.holder_name : (card.holder_name || "—")}
          </td>
        )}

        {visibleCols.includes("country") && (
          <td>
            {card.country
              ? <span style={{ padding: "2px 6px", background: "var(--surface)", borderRadius: 5, fontSize: 11, color: "var(--text-2)" }}>
                  {countryFlag(card.country)} {card.country}
                </span>
              : <span style={{ color: "var(--muted)" }}>—</span>}
          </td>
        )}

        {visibleCols.includes("source") && (
          <td style={{ color: "var(--text-2)", fontSize: 11, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {card.source || "—"}
          </td>
        )}

        {visibleCols.includes("status") && (
          <td>
            <span className={`st ${statusCls}`}>{statusLabel}</span>
          </td>
        )}

        {visibleCols.includes("notes") && (
          <td>
            <NoteCell card={card} onEditNote={handleEditNote} />
          </td>
        )}

        {visibleCols.includes("created") && (
          <td style={{ color: "var(--muted)", fontSize: 11, whiteSpace: "nowrap", fontFamily: "'JetBrains Mono',monospace" }}>
            {card.created_at?.slice(0, 10)}
          </td>
        )}

        {visibleCols.includes("expiry") && (
          <td>
            <ExpiryCell expiry={card.expiry_date} />
          </td>
        )}

        {visibleCols.includes("cvv") && (
          <td style={{ fontSize: 11, color: "var(--text-2)", fontFamily: "'JetBrains Mono',monospace" }}>
            {isRevealed ? (revealedData.cvv || "—") : "•••"}
          </td>
        )}

        {visibleCols.includes("zip") && (
          <td style={{ fontSize: 11, color: "var(--text-2)" }}>
            {card.zip || "—"}
          </td>
        )}

        {visibleCols.includes("city") && (
          <td style={{ fontSize: 11, color: "var(--text-2)" }}>
            {card.city || "—"}
          </td>
        )}

        {visibleCols.includes("state") && (
          <td style={{ fontSize: 11, color: "var(--text-2)" }}>
            {card.state || "—"}
          </td>
        )}

        {visibleCols.includes("phone") && (
          <td style={{ fontSize: 11, color: "var(--text-2)", fontFamily: "'JetBrains Mono',monospace" }}>
            {isRevealed ? (revealedData.phone || "—") : "•••"}
          </td>
        )}

        {visibleCols.includes("email_cc") && (
          <td style={{ fontSize: 11, color: "var(--text-2)" }}>
            {isRevealed ? (revealedData.email || "—") : "•••"}
          </td>
        )}

        {visibleCols.includes("ip") && (
          <td style={{ fontSize: 11, color: "var(--text-2)", fontFamily: "'JetBrains Mono',monospace" }}>
            {isRevealed ? (revealedData.ip_address || "—") : "•••"}
          </td>
        )}

        {visibleCols.includes("billing") && (
          <td style={{ fontSize: 11, color: "var(--text-2)", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {isRevealed ? (revealedData.billing_address || "—") : "•••"}
          </td>
        )}

        <td>
          <div className="tbl-actions">
            <button
              className="btn btn-ghost btn-sm"
              title={isRevealed ? t("cc_hide") : t("cc_reveal")}
              onClick={() => handleReveal(card.id)}
              style={isRevealed ? { color: "var(--accent)" } : undefined}
            >
              {isRevealed ? "Hide" : "Reveal"}
            </button>
            <button className="btn btn-ghost btn-sm" title={t("cc_copy_num")} onClick={() => handleCopyNum(card.id)}>
              Copy
            </button>
            <button
              className="btn btn-ghost btn-sm"
              title="Copy full (pipe format)"
              onClick={() => {
                const rev = revealed[card.id];
                if (rev) {
                  const full = `${formatCardNumber(rev.card_number)}|${rev.expiry_date}|${rev.cvv}|${rev.holder_name}`;
                  copyToClipboard(full, toast);
                } else {
                  toast.warn("Reveal first to copy full data");
                }
              }}
            >
              Full
            </button>
            <button className="btn btn-g btn-sm" title={t("cc_mark_free")} onClick={() => handleStatusChange(card.id, "free")}>
              Free
            </button>
            <button className="btn btn-r btn-sm" title={t("cc_mark_dead")} onClick={() => handleStatusChange(card.id, "dead")}>
              Dead
            </button>
            <button className="btn btn-r btn-sm" title={t("btn_delete")} onClick={() => handleDelete(card.id)}>
              Del
            </button>
          </div>
        </td>
      </tr>
    );
  };

  // ── Grouped render ─────────────────────────────────────────────────────

  const renderRows = () => {
    if (!groupByBank) return cards.map(renderCard);

    const grouped = Object.entries(
      cards.reduce((acc, c) => {
        const k = c.bank_name || "Unknown";
        (acc[k] = acc[k] || []).push(c);
        return acc;
      }, {})
    ).sort((a, b) => a[0].localeCompare(b[0]));

    return grouped.map(([bank, groupCards]) => (
      <>
        <tr key={`group-${bank}`}>
          <td colSpan={99} style={{
            padding: "5px 10px", background: "var(--surface)",
            color: "var(--muted)", fontSize: 10, fontWeight: 700,
            borderBottom: "1px solid var(--border)",
            letterSpacing: "0.06em", textTransform: "uppercase",
          }}>
            {bank} · {groupCards.length} cards · {groupCards.filter(c => c.status === "free").length} free
          </td>
        </tr>
        {groupCards.map(renderCard)}
      </>
    ));
  };

  // ── Active visible column headers ──────────────────────────────────────

  const visibleHeaders = ALL_COLUMNS.filter(c => visibleCols.includes(c.id) || c.id === "actions");

  // ── Pagination helpers ─────────────────────────────────────────────────

  const from = ((page - 1) * PER_PAGE) + 1;
  const to   = Math.min(page * PER_PAGE, total);

  return (
    <div className="content">

      {/* Page header */}
      <div className="ph">
        <div>
          <div className="ph-title">
            💳 CC{" "}
            <span style={{ color: "var(--dim)", fontSize: 14, fontWeight: 400 }}>
              {total.toLocaleString()} {t("nav_cards")}
            </span>
            {freeTotal > 0 && (
              <span style={{ marginLeft: 8, fontSize: 12, color: "#4ade80", fontWeight: 400 }}>
                · {freeTotal.toLocaleString()} free
              </span>
            )}
          </div>
        </div>
        <div className="ph-actions">
          <button className="btn btn-ghost btn-sm" onClick={handleRevealAll}>👁 Reveal All</button>
          <button
            onClick={() => setCompact(v => !v)}
            className={compact ? "btn btn-p btn-sm" : "btn btn-ghost btn-sm"}
          >
            {compact ? "Normal" : "Compact"}
          </button>
          <button
            onClick={() => setGroupByBank(v => !v)}
            className={groupByBank ? "btn btn-b btn-sm" : "btn btn-ghost btn-sm"}
          >
            Group
          </button>
          <div style={{ position: "relative" }}>
            <button
              onClick={() => setShowColPicker(v => !v)}
              className="btn btn-ghost btn-sm"
            >
              Columns
            </button>
            {showColPicker && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 10 }} onClick={() => setShowColPicker(false)} />
                <ColumnPicker
                  visible={visibleCols}
                  onChange={setVisibleCols}
                  onClose={() => setShowColPicker(false)}
                />
              </>
            )}
          </div>
          <button onClick={() => setShowImport(true)} className="btn btn-p">
            ⬆ {t("btn_import")}
          </button>
        </div>
      </div>

      {/* Filters row */}
      <div className="filters">
        <select
          value={filter.status || ""}
          onChange={e => { setFilter(f => ({ ...f, status: e.target.value || null })); setPage(1); }}
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, padding: "5px 10px", fontSize: 12, outline: "none" }}
        >
          <option value="">{t("cc_filter_status")}</option>
          <option value="free">Free</option>
          <option value="in_use">In Use</option>
          <option value="dead">Dead</option>
          <option value="archive">Archive</option>
        </select>

        <input
          value={filter.country || ""}
          maxLength={2}
          onChange={e => { setFilter(f => ({ ...f, country: e.target.value || null })); setPage(1); }}
          placeholder={t("cc_filter_country")}
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, padding: "5px 10px", fontSize: 12, outline: "none", width: 70 }}
        />

        <input
          value={filter.bank_name || ""}
          onChange={e => { setFilter(f => ({ ...f, bank_name: e.target.value || null })); setPage(1); }}
          placeholder={t("cc_filter_bank")}
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, padding: "5px 10px", fontSize: 12, outline: "none", width: 100 }}
        />

        <input
          value={filter.source || ""}
          onChange={e => { setFilter(f => ({ ...f, source: e.target.value || null })); setPage(1); }}
          placeholder={t("cc_filter_source")}
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, padding: "5px 10px", fontSize: 12, outline: "none", width: 100 }}
        />

        <select
          value={filter.card_type || ""}
          onChange={e => { setFilter(f => ({ ...f, card_type: e.target.value || null })); setPage(1); }}
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, padding: "5px 10px", fontSize: 12, outline: "none" }}
        >
          <option value="">Type</option>
          <option value="visa">Visa</option>
          <option value="mastercard">Mastercard</option>
          <option value="amex">Amex</option>
          <option value="discover">Discover</option>
        </select>

        <input
          value={filter.state || ""}
          onChange={e => { setFilter(f => ({ ...f, state: e.target.value || null })); setPage(1); }}
          placeholder="State"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, padding: "5px 10px", fontSize: 12, outline: "none", width: 60 }}
        />

        <input
          value={filter.zip_prefix || ""}
          onChange={e => { setFilter(f => ({ ...f, zip_prefix: e.target.value || null })); setPage(1); }}
          placeholder="ZIP"
          title="ZIP prefix match"
          style={{ background: "var(--surface)", border: "1px solid var(--border)", color: "var(--text)", borderRadius: 6, padding: "5px 10px", fontSize: 12, outline: "none", width: 70 }}
        />

        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <input
            className="search-box"
            value={searchInput}
            onChange={e => setSearchInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder={"🔍  " + t("btn_search")}
            style={{ width: 180 }}
          />
          <button onClick={handleSearch} className="btn btn-p btn-sm">{t("btn_search")}</button>
          <button onClick={handleResetFilters} className="btn btn-ghost btn-sm">{t("cc_reset_filters")}</button>
          <button onClick={loadCards} className="btn btn-ghost btn-sm" title="Refresh">
            {loading ? "⟳" : "↺"}
          </button>
        </div>
      </div>

      {/* Expiring soon banner */}
      {activeTab === "expiring" && (
        <div style={{
          padding: "8px 14px", background: "rgba(234,179,8,0.08)",
          border: "1px solid rgba(234,179,8,0.15)", borderRadius: 8, marginBottom: 10,
          color: "#eab308", fontSize: 12,
        }}>
          Showing cards expiring within 60 days
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <div style={{
          padding: "8px 14px", background: "rgba(168,85,247,0.07)",
          border: "1px solid rgba(168,85,247,0.2)", borderRadius: 8,
          display: "flex", alignItems: "center", gap: 10, marginBottom: 10,
        }}>
          <span style={{ color: "var(--accent)", fontWeight: 600, fontSize: 12 }}>{selected.size} selected</span>
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => handleBulkStatus("free")} className="btn btn-g btn-sm">{t("cc_mark_free")}</button>
            <button onClick={() => handleBulkStatus("dead")} className="btn btn-r btn-sm">{t("cc_mark_dead")}</button>
            <button onClick={() => handleExport("txt")} className="btn btn-b btn-sm">Export TXT</button>
            <button onClick={() => handleExport("csv")} className="btn btn-b btn-sm">Export CSV</button>
            <button onClick={handleBulkDelete} className="btn btn-r btn-sm">{t("btn_delete")}</button>
          </div>
          <button
            onClick={() => setSelected(new Set())}
            style={{ marginLeft: "auto", background: "none", border: "none", color: "var(--muted)", cursor: "pointer", fontSize: 14 }}
          >
            ✕
          </button>
        </div>
      )}

      {/* Table panel */}
      {loading && cards.length === 0 ? (
        <div className="panel" style={{ textAlign: "center", padding: 40, color: "var(--muted)", fontSize: 13 }}>
          Loading…
        </div>
      ) : cards.length === 0 ? (
        <div className="panel" style={{ textAlign: "center", padding: 48 }}>
          <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.3 }}>💳</div>
          <p style={{ color: "var(--muted)", fontSize: 13, margin: "0 0 14px" }}>{t("cc_no_cards")}</p>
          <button onClick={() => setShowImport(true)} className="btn btn-p">
            {t("cc_import_first")}
          </button>
        </div>
      ) : (
        <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 36 }}>
                  <input
                    type="checkbox"
                    checked={allSelected}
                    ref={el => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleSelectAll}
                    style={{ accentColor: "var(--accent)", cursor: "pointer" }}
                  />
                </th>
                {visibleHeaders.map(c => (
                  <th key={c.id}>{t(c.label)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {renderRows()}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10, fontSize: 11, color: "var(--muted)" }}>
          <span>Показано {from}–{to} из {total}</span>
          <div style={{ display: "flex", gap: 5 }}>
            <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}>← Пред</button>
            {buildPageNumbers(page, totalPages).map((p, i) =>
              p === "…" ? (
                <span key={i} style={{ padding: "0 4px", color: "var(--muted)", lineHeight: "28px" }}>…</span>
              ) : (
                <button
                  key={i}
                  onClick={() => setPage(p)}
                  className="btn btn-ghost btn-sm"
                  style={p === page ? { background: "var(--accent)", color: "#fff", border: "none" } : undefined}
                >
                  {p}
                </button>
              )
            )}
            <button className="btn btn-ghost btn-sm" onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>След →</button>
          </div>
        </div>
      )}

      {/* Modals */}
      {showImport && (
        <ImportModal
          onClose={() => setShowImport(false)}
          onImported={() => { loadCards(); }}
        />
      )}
    </div>
  );
}
