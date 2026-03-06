import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Upload, Search, RefreshCw, Eye, EyeOff, Copy, Trash2,
  ChevronLeft, ChevronRight, UserPlus, CheckSquare, Square,
  Minus, Columns, X, Check, AlertTriangle, Filter,
} from "lucide-react";
import { useLang } from "../hooks/useLang.jsx";
import { useToast } from "../hooks/useToast.js";
import { useConfirm } from "../hooks/useConfirm.js";

// ─── Constants ────────────────────────────────────────────────────────────

const STATUS_META = {
  free:    { color: "bg-[#22c55e20] text-[#22c55e] border-[#22c55e40]",  dot: "bg-[#22c55e]"  },
  in_use:  { color: "bg-[#3b82f620] text-[#3b82f6] border-[#3b82f640]",  dot: "bg-[#3b82f6]"  },
  dead:    { color: "bg-[#ef444420] text-[#ef4444] border-[#ef444440]",   dot: "bg-[#ef4444]"  },
  archive: { color: "bg-[#6b728020] text-[#6b7280] border-[#6b728040]",  dot: "bg-[#6b7280]"  },
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
  { id: "actions",     label: "cc_col_actions" },
];

// ─── Small helpers ────────────────────────────────────────────────────────

function StatusBadge({ status }) {
  const meta = STATUS_META[status] || STATUS_META.free;
  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs
                      border ${meta.color}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${meta.dot}`} />
      {status}
    </span>
  );
}

function copyToClipboard(text, toast) {
  navigator.clipboard.writeText(text).then(
    () => toast.success("Copied"),
    () => toast.error("Copy failed"),
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
  const [preview, setPreview] = useState(null); // { preview_rows, detected_mapping }
  const [mapping, setMapping] = useState([]);
  const [result, setResult]   = useState(null);

  // Step 1 → 2
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

  // Step 2 → 3
  const handleToMapping = () => setStep(3);

  // Step 3 → Import
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-[#1a1d27] border border-[#2d3148] rounded-2xl shadow-2xl
                      w-full max-w-3xl mx-4 flex flex-col max-h-[90vh] overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2d3148]">
          <div className="flex items-center gap-3">
            <h2 className="text-[#e2e8f0] font-semibold">{t("cc_import_title")}</h2>
            <div className="flex gap-1">
              {[1,2,3].map(s => (
                <div key={s}
                  className={`w-6 h-1.5 rounded-full transition-colors
                    ${s <= step ? "bg-[#a855f7]" : "bg-[#2d3148]"}`}
                />
              ))}
            </div>
          </div>
          <button onClick={onClose} className="text-[#6b7280] hover:text-[#e2e8f0]">
            <X size={18} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 p-6">

          {/* ── Step 1: Input ─────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-[#94a3b8] text-sm">{t("cc_import_step1_hint")}</p>
              <textarea
                value={raw}
                onChange={e => setRaw(e.target.value)}
                placeholder="4111111111111111|12/26|123|JOHN SMITH|john@example.com..."
                rows={10}
                className="w-full bg-[#0f1117] border border-[#2d3148] rounded-lg
                           px-4 py-3 text-sm text-[#e2e8f0] placeholder-[#4b5563]
                           font-mono resize-none focus:outline-none focus:border-[#a855f7]"
              />
              <div>
                <label className="block text-xs text-[#94a3b8] mb-1">{t("cc_import_source_label")}</label>
                <input
                  value={source}
                  onChange={e => setSource(e.target.value)}
                  placeholder="nike-dump-jan"
                  className="w-full bg-[#0f1117] border border-[#2d3148] rounded-lg
                             px-4 py-2.5 text-sm text-[#e2e8f0] placeholder-[#4b5563]
                             focus:outline-none focus:border-[#a855f7]"
                />
              </div>
            </div>
          )}

          {/* ── Step 2: Preview ───────────────────────────── */}
          {step === 2 && preview && (
            <div className="space-y-4">
              <p className="text-[#94a3b8] text-sm">{t("cc_import_step2_hint")}</p>
              <div className="overflow-x-auto rounded-lg border border-[#2d3148]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[#2d3148]">
                      {preview.detected_mapping.map((field, i) => (
                        <th key={i} className="px-3 py-2 text-left font-medium">
                          <span className={`px-2 py-0.5 rounded text-xs
                            ${field !== "skip"
                              ? "bg-[#22c55e20] text-[#22c55e] border border-[#22c55e40]"
                              : "text-[#6b7280]"}`}>
                            {field !== "skip" ? `✓ ${field}` : `col ${i+1}`}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview_rows.map((row, ri) => (
                      <tr key={ri} className="border-b border-[#2d3148] hover:bg-[#21253a]">
                        {row.map((cell, ci) => (
                          <td key={ci} className="px-3 py-2 text-[#94a3b8] font-mono
                                                   max-w-[160px] truncate">
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

          {/* ── Step 3: Mapping ───────────────────────────── */}
          {step === 3 && preview && (
            <div className="space-y-3">
              <p className="text-[#94a3b8] text-sm">{t("cc_import_step3_hint")}</p>
              {Array.from({ length: colCount }).map((_, ci) => (
                <div key={ci} className="flex items-center gap-3 p-3 bg-[#0f1117]
                                          rounded-lg border border-[#2d3148]">
                  <div className="w-6 h-6 rounded bg-[#2d3148] flex items-center justify-center
                                  text-xs text-[#6b7280] shrink-0">
                    {ci+1}
                  </div>
                  <div className="flex-1 font-mono text-xs text-[#6b7280] truncate">
                    {preview.preview_rows[0]?.[ci] ?? "—"}
                  </div>
                  <select
                    value={mapping[ci] ?? "skip"}
                    onChange={e => {
                      const m = [...mapping];
                      m[ci] = e.target.value;
                      setMapping(m);
                    }}
                    className="bg-[#1a1d27] border border-[#2d3148] text-[#e2e8f0] text-xs
                               rounded-lg px-3 py-1.5 focus:outline-none focus:border-[#a855f7]"
                  >
                    {FIELD_OPTIONS.map(f => <option key={f} value={f}>{f}</option>)}
                  </select>
                </div>
              ))}

              {/* Result after import */}
              {result && (
                <div className="mt-4 p-4 bg-[#22c55e15] border border-[#22c55e40] rounded-lg">
                  <p className="text-[#22c55e] font-semibold text-sm mb-1">{t("cc_import_done")}</p>
                  <div className="flex gap-6 text-sm text-[#94a3b8]">
                    <span>✓ Imported: <strong className="text-[#22c55e]">{result.imported}</strong></span>
                    <span>↷ Skipped: <strong className="text-[#eab308]">{result.skipped}</strong></span>
                    <span>✗ Errors: <strong className="text-[#ef4444]">{result.errors?.length ?? 0}</strong></span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-[#2d3148]">
          <button
            onClick={() => step > 1 && !result ? setStep(s => s-1) : onClose()}
            className="px-4 py-2 text-sm text-[#94a3b8] hover:text-[#e2e8f0]
                       border border-[#2d3148] rounded-lg hover:bg-[#21253a] transition-colors"
          >
            {result ? t("btn_close") : step > 1 ? "← Back" : t("btn_cancel")}
          </button>
          <div className="flex gap-2">
            {step === 1 && (
              <button onClick={handlePreview} disabled={loading || !raw.trim()}
                className="btn-primary">
                {loading ? <Spinner /> : null}
                {t("cc_import_preview")} →
              </button>
            )}
            {step === 2 && (
              <button onClick={handleToMapping} className="btn-primary">
                {t("cc_import_mapping")} →
              </button>
            )}
            {step === 3 && !result && (
              <button onClick={handleImport} disabled={loading}
                className="btn-primary">
                {loading ? <Spinner /> : null}
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
    <div className="absolute right-0 top-10 z-20 bg-[#1a1d27] border border-[#2d3148]
                    rounded-xl shadow-2xl p-3 w-52">
      <p className="text-xs text-[#6b7280] mb-2 px-1">{t("cc_columns")}</p>
      {ALL_COLUMNS.filter(c => c.id !== "actions").map(col => (
        <label key={col.id}
          className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-[#21253a]
                     cursor-pointer text-sm text-[#94a3b8]">
          <input type="checkbox"
            checked={visible.includes(col.id)}
            onChange={e => {
              if (e.target.checked) onChange([...visible, col.id]);
              else onChange(visible.filter(v => v !== col.id));
            }}
            className="accent-[#a855f7]"
          />
          {t(col.label)}
        </label>
      ))}
    </div>
  );
}

// ─── Card row ─────────────────────────────────────────────────────────────

function CardRow({ card, visibleCols, selected, onSelect, onReveal, revealedData,
                   compact, onStatusChange, onDelete, onCopyNum, onCopyFull, onEditNote }) {
  const { t } = useLang();
  const isRevealed = !!revealedData;

  const displayNumber = isRevealed
    ? formatCardNumber(revealedData.card_number)
    : `****-****-****-${card.last4 || "????"}`;

  return (
    <tr className={`border-b border-[#2d3148] transition-colors
                    ${selected ? "bg-[#a855f710]" : "hover:bg-[#21253a]"}
                    ${compact ? "text-xs" : "text-sm"}`}>
      {/* Checkbox */}
      <td className="px-3 py-2 w-8">
        <button onClick={() => onSelect(card.id)}
          className="text-[#6b7280] hover:text-[#a855f7]">
          {selected ? <CheckSquare size={15} className="text-[#a855f7]" /> : <Square size={15} />}
        </button>
      </td>

      {/* Card Number */}
      {visibleCols.includes("card_number") && (
        <td className="px-3 py-2">
          <span className="font-mono text-[#e2e8f0]">{displayNumber}</span>
          {isRevealed && revealedData.cvv && (
            <span className="ml-2 text-[#eab308] font-mono text-xs">CVV:{revealedData.cvv}</span>
          )}
        </td>
      )}

      {/* BIN/Bank */}
      {visibleCols.includes("bin_bank") && (
        <td className="px-3 py-2">
          <span className="font-mono text-[#6b7280]">{card.bin || "——"}</span>
          {card.bank_name && (
            <span className="block text-xs text-[#6b7280]">{card.bank_name}</span>
          )}
        </td>
      )}

      {/* Type */}
      {visibleCols.includes("type") && (
        <td className="px-3 py-2 text-[#94a3b8]">
          {card.card_type || "—"}
          {card.card_level && <span className="ml-1 text-xs text-[#6b7280]">{card.card_level}</span>}
        </td>
      )}

      {/* Holder */}
      {visibleCols.includes("holder") && (
        <td className="px-3 py-2 text-[#94a3b8] max-w-[140px] truncate">
          {isRevealed ? revealedData.holder_name : (card.holder_name || "—")}
        </td>
      )}

      {/* Country */}
      {visibleCols.includes("country") && (
        <td className="px-3 py-2">
          {card.country
            ? <span className="px-1.5 py-0.5 bg-[#2d3148] rounded text-xs text-[#94a3b8]">{card.country}</span>
            : <span className="text-[#6b7280]">—</span>}
        </td>
      )}

      {/* Source */}
      {visibleCols.includes("source") && (
        <td className="px-3 py-2 text-[#6b7280] text-xs max-w-[100px] truncate">
          {card.source}
        </td>
      )}

      {/* Status */}
      {visibleCols.includes("status") && (
        <td className="px-3 py-2">
          <StatusBadge status={card.status} />
        </td>
      )}

      {/* Notes */}
      {visibleCols.includes("notes") && (
        <td className="px-3 py-2 text-[#6b7280] text-xs max-w-[120px] truncate">
          {card.notes || "—"}
        </td>
      )}

      {/* Created */}
      {visibleCols.includes("created") && (
        <td className="px-3 py-2 text-[#6b7280] text-xs whitespace-nowrap">
          {card.created_at?.slice(0, 10)}
        </td>
      )}

      {/* Actions */}
      <td className="px-3 py-2">
        <div className="flex items-center gap-1">
          {/* Reveal/Hide */}
          <ActionBtn
            icon={isRevealed ? <EyeOff size={13}/> : <Eye size={13}/>}
            title={isRevealed ? t("cc_hide") : t("cc_reveal")}
            onClick={() => onReveal(card.id)}
            color={isRevealed ? "text-[#a855f7]" : ""}
          />
          {/* Copy Number */}
          <ActionBtn
            icon={<Copy size={13}/>}
            title={t("cc_copy_num")}
            onClick={() => onCopyNum(card.id)}
          />
          {/* Mark Free */}
          <ActionBtn
            icon={<Check size={13}/>}
            title={t("cc_mark_free")}
            onClick={() => onStatusChange(card.id, "free")}
            color="text-[#22c55e]"
          />
          {/* Mark Dead */}
          <ActionBtn
            icon={<X size={13}/>}
            title={t("cc_mark_dead")}
            onClick={() => onStatusChange(card.id, "dead")}
            color="text-[#ef4444]"
          />
          {/* Delete */}
          <ActionBtn
            icon={<Trash2 size={13}/>}
            title={t("btn_delete")}
            onClick={() => onDelete(card.id)}
            color="hover:text-[#ef4444]"
          />
        </div>
      </td>
    </tr>
  );
}

function ActionBtn({ icon, title, onClick, color = "" }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`p-1.5 rounded hover:bg-[#2d3148] transition-colors
                  text-[#6b7280] hover:text-[#e2e8f0] ${color}`}
    >
      {icon}
    </button>
  );
}

function Spinner() {
  return <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin inline-block mr-1" />;
}

function formatCardNumber(num) {
  const d = num.replace(/\D/g, "");
  return d.match(/.{1,4}/g)?.join("-") ?? d;
}

// ─── Main CCList page ─────────────────────────────────────────────────────

export default function Cards() {
  const { t } = useLang();
  const toast   = useToast();
  const confirm = useConfirm();

  // ── State ──────────────────────────────────────────────────────────────

  const [cards, setCards]           = useState([]);
  const [total, setTotal]           = useState(0);
  const [page, setPage]             = useState(1);
  const [loading, setLoading]       = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showColPicker, setShowColPicker] = useState(false);
  const [compact, setCompact]       = useState(false);

  const [selected, setSelected]     = useState(new Set());
  const [revealed, setRevealed]     = useState({}); // id → CardDecrypted

  const [visibleCols, setVisibleCols] = useState(
    ["card_number","bin_bank","type","holder","country","source","status","notes","actions"]
  );

  const [filter, setFilter] = useState({
    status: null, country: null, bank_name: null, source: null,
    card_type: null, search: null,
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
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  }, [filter, page]);

  useEffect(() => { loadCards(); }, [loadCards]);

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
    if (revealed[id]) { setRevealed(r => { const n={...r}; delete n[id]; return n; }); return; }
    try {
      const data = await invoke("reveal_card", { id });
      setRevealed(r => ({ ...r, [id]: data }));
    } catch (e) { toast.error(String(e)); }
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
    } catch (e) { toast.error(String(e)); }
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

  const handleSearch = () => {
    setFilter(f => ({ ...f, search: searchInput || null }));
    setPage(1);
  };

  const handleResetFilters = () => {
    setFilter({ status: null, country: null, bank_name: null, source: null, card_type: null, search: null });
    setSearchInput("");
    setPage(1);
  };

  // ── Render ─────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col bg-[#0f1117]">

      {/* ── Header ─────────────────────────────────────────── */}
      <div className="px-6 pt-5 pb-3 border-b border-[#2d3148]">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold text-[#e2e8f0]">{t("nav_cards")}</h1>
            <span className="px-2 py-0.5 bg-[#2d3148] rounded-full text-xs text-[#94a3b8]">
              {total.toLocaleString()}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* Compact toggle */}
            <button
              onClick={() => setCompact(v => !v)}
              className={`px-3 py-1.5 rounded-lg text-xs border transition-colors
                ${compact
                  ? "bg-[#a855f720] text-[#a855f7] border-[#a855f740]"
                  : "text-[#94a3b8] border-[#2d3148] hover:bg-[#21253a]"}`}
            >
              {compact ? "Normal" : "Compact"}
            </button>

            {/* Column picker */}
            <div className="relative">
              <button
                onClick={() => setShowColPicker(v => !v)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs
                           text-[#94a3b8] border border-[#2d3148] hover:bg-[#21253a]"
              >
                <Columns size={13} /> {t("cc_columns")}
              </button>
              {showColPicker && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowColPicker(false)} />
                  <ColumnPicker
                    visible={visibleCols}
                    onChange={setVisibleCols}
                    onClose={() => setShowColPicker(false)}
                  />
                </>
              )}
            </div>

            <button
              onClick={() => setShowImport(true)}
              className="flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium
                         bg-[#a855f7] hover:bg-[#b366f8] text-white transition-colors"
            >
              <Upload size={14} /> {t("btn_import")}
            </button>
          </div>
        </div>

        {/* Filters row */}
        <div className="flex flex-wrap items-center gap-2">
          <FilterSelect
            value={filter.status}
            onChange={v => { setFilter(f => ({...f, status: v})); setPage(1); }}
            placeholder={t("cc_filter_status")}
            options={["free","in_use","dead","archive"]}
          />
          <FilterInput placeholder={t("cc_filter_country")} maxLen={2}
            value={filter.country || ""}
            onChange={v => { setFilter(f => ({...f, country: v || null})); setPage(1); }}
          />
          <FilterInput placeholder={t("cc_filter_bank")}
            value={filter.bank_name || ""}
            onChange={v => { setFilter(f => ({...f, bank_name: v || null})); setPage(1); }}
          />
          <FilterInput placeholder={t("cc_filter_source")}
            value={filter.source || ""}
            onChange={v => { setFilter(f => ({...f, source: v || null})); setPage(1); }}
          />
          <div className="flex items-center gap-1 ml-auto">
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#6b7280]" />
              <input
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && handleSearch()}
                placeholder={t("btn_search")}
                className="pl-8 pr-3 py-1.5 bg-[#1a1d27] border border-[#2d3148] rounded-lg
                           text-xs text-[#e2e8f0] placeholder-[#6b7280]
                           focus:outline-none focus:border-[#a855f7] w-44"
              />
            </div>
            <button onClick={handleSearch}
              className="px-2.5 py-1.5 bg-[#a855f7] text-white rounded-lg text-xs hover:bg-[#b366f8]">
              {t("btn_search")}
            </button>
            <button onClick={handleResetFilters}
              className="px-2.5 py-1.5 border border-[#2d3148] text-[#94a3b8] rounded-lg text-xs hover:bg-[#21253a]">
              {t("cc_reset_filters")}
            </button>
            <button onClick={loadCards}
              className="p-1.5 border border-[#2d3148] text-[#94a3b8] rounded-lg hover:bg-[#21253a]">
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>
      </div>

      {/* ── Bulk action bar ─────────────────────────────────── */}
      {selected.size > 0 && (
        <div className="px-6 py-2 bg-[#a855f710] border-b border-[#a855f730]
                        flex items-center gap-3 text-sm">
          <span className="text-[#a855f7] font-medium">{selected.size} selected</span>
          <div className="flex gap-2 ml-2">
            <button onClick={() => handleBulkStatus("free")}
              className="px-3 py-1 rounded text-xs text-[#22c55e] bg-[#22c55e15] hover:bg-[#22c55e25]">
              {t("cc_mark_free")}
            </button>
            <button onClick={() => handleBulkStatus("dead")}
              className="px-3 py-1 rounded text-xs text-[#ef4444] bg-[#ef444415] hover:bg-[#ef444425]">
              {t("cc_mark_dead")}
            </button>
            <button onClick={() => handleExport("txt")}
              className="px-3 py-1 rounded text-xs text-[#3b82f6] bg-[#3b82f615] hover:bg-[#3b82f625]">
              Export TXT
            </button>
            <button onClick={() => handleExport("csv")}
              className="px-3 py-1 rounded text-xs text-[#3b82f6] bg-[#3b82f615] hover:bg-[#3b82f625]">
              Export CSV
            </button>
            <button onClick={handleBulkDelete}
              className="px-3 py-1 rounded text-xs text-[#ef4444] bg-[#ef444415] hover:bg-[#ef444425]">
              {t("btn_delete")}
            </button>
          </div>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-[#6b7280] hover:text-[#e2e8f0]">
            <X size={14}/>
          </button>
        </div>
      )}

      {/* ── Table ──────────────────────────────────────────── */}
      <div className="flex-1 overflow-auto">
        {loading && cards.length === 0 ? (
          <div className="flex items-center justify-center h-48 text-[#6b7280] text-sm">
            <Spinner /> {t("msg_loading")}
          </div>
        ) : cards.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-[#6b7280] text-sm gap-2">
            <Upload size={32} className="opacity-30" />
            <p>{t("cc_no_cards")}</p>
            <button onClick={() => setShowImport(true)}
              className="mt-2 px-4 py-2 bg-[#a855f7] text-white text-sm rounded-lg hover:bg-[#b366f8]">
              {t("cc_import_first")}
            </button>
          </div>
        ) : (
          <table className="w-full border-collapse">
            <thead className="sticky top-0 bg-[#1a1d27] z-10">
              <tr className="border-b border-[#2d3148] text-xs text-[#6b7280]">
                <th className="px-3 py-2 w-8">
                  <button onClick={toggleSelectAll} className="text-[#6b7280] hover:text-[#a855f7]">
                    {selected.size === cards.length && cards.length > 0
                      ? <CheckSquare size={15} className="text-[#a855f7]" />
                      : selected.size > 0
                        ? <Minus size={15} className="text-[#a855f7]" />
                        : <Square size={15} />}
                  </button>
                </th>
                {ALL_COLUMNS.filter(c => visibleCols.includes(c.id) || c.id === "actions").map(c => (
                  <th key={c.id} className="px-3 py-2 text-left font-medium whitespace-nowrap">
                    {t(c.label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cards.map(card => (
                <CardRow
                  key={card.id}
                  card={card}
                  visibleCols={visibleCols}
                  selected={selected.has(card.id)}
                  onSelect={toggleSelect}
                  onReveal={handleReveal}
                  revealedData={revealed[card.id]}
                  compact={compact}
                  onStatusChange={handleStatusChange}
                  onDelete={handleDelete}
                  onCopyNum={handleCopyNum}
                  onCopyFull={(id) => {
                    const rev = revealed[id];
                    if (rev) {
                      const full = `${formatCardNumber(rev.card_number)}|${rev.expiry_date}|${rev.cvv}|${rev.holder_name}`;
                      copyToClipboard(full, toast);
                    } else {
                      toast.warn("Reveal first to copy full data");
                    }
                  }}
                  onEditNote={() => {}}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ──────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="px-6 py-3 border-t border-[#2d3148] flex items-center justify-between text-sm">
          <span className="text-[#6b7280] text-xs">
            {((page-1)*PER_PAGE)+1}–{Math.min(page*PER_PAGE, total)} of {total}
          </span>
          <div className="flex items-center gap-1">
            <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page === 1}
              className="p-1.5 rounded hover:bg-[#21253a] disabled:opacity-30 text-[#94a3b8]">
              <ChevronLeft size={16} />
            </button>
            {buildPageNumbers(page, totalPages).map((p, i) =>
              p === "…" ? (
                <span key={i} className="px-2 text-[#6b7280]">…</span>
              ) : (
                <button key={i} onClick={() => setPage(p)}
                  className={`w-8 h-8 rounded text-xs transition-colors
                    ${p === page
                      ? "bg-[#a855f7] text-white"
                      : "text-[#94a3b8] hover:bg-[#21253a]"}`}>
                  {p}
                </button>
              )
            )}
            <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page === totalPages}
              className="p-1.5 rounded hover:bg-[#21253a] disabled:opacity-30 text-[#94a3b8]">
              <ChevronRight size={16} />
            </button>
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

// ─── Filter helpers ───────────────────────────────────────────────────────

function FilterSelect({ value, onChange, placeholder, options }) {
  return (
    <select
      value={value || ""}
      onChange={e => onChange(e.target.value || null)}
      className="bg-[#1a1d27] border border-[#2d3148] text-xs text-[#94a3b8] rounded-lg
                 px-3 py-1.5 focus:outline-none focus:border-[#a855f7]"
    >
      <option value="">{placeholder}</option>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

function FilterInput({ placeholder, value, onChange, maxLen }) {
  return (
    <input
      value={value}
      maxLength={maxLen}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className="w-24 bg-[#1a1d27] border border-[#2d3148] text-xs text-[#94a3b8] rounded-lg
                 px-3 py-1.5 focus:outline-none focus:border-[#a855f7] placeholder-[#6b7280]"
    />
  );
}

function buildPageNumbers(current, total) {
  if (total <= 7) return Array.from({length: total}, (_, i) => i+1);
  const pages = [1];
  if (current > 3) pages.push("…");
  for (let p = Math.max(2, current-1); p <= Math.min(total-1, current+1); p++) pages.push(p);
  if (current < total - 2) pages.push("…");
  pages.push(total);
  return pages;
}
