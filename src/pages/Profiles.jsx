import React, { useState, useEffect, useCallback, useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useFocusTrap } from "../hooks/useFocusTrap.js";
import { invoke } from "@tauri-apps/api/core";
import {
  User, CreditCard, MapPin, Plus, Trash2, Star, StarOff,
  Search, RefreshCw, AlertTriangle,
  Package, ExternalLink, Layers, Import, CheckCircle2, XCircle,
  Edit2, Check, X, Filter, MoreHorizontal, Maximize2, ClipboardCopy,
  SearchCode, Download, ShoppingCart
} from "lucide-react";
import { useLang } from "../hooks/useLang";
import { useToast } from "../hooks/useToast";
import { useConfirm } from "../hooks/useConfirm";
import { useDebounce } from "../hooks/useDebounce.js";
import { EmptyState } from "../components/EmptyState.jsx";
import { SkeletonRows } from "../components/SkeletonRow.jsx";
import { ActionsMenu } from "../components/ActionsMenu.jsx";
import { CARD_STATUS_COLORS } from "../constants/status.js";
import { buildPipeString, shortId } from "../utils/formatting.js";
import { buildPageNumbers } from "../utils/pagination.js";
import { copyText } from "../utils/clipboard.js";
import { ProfileModal } from "./Profiles/ProfileModal.jsx";
import { ProfileFilters } from "./Profiles/ProfileFilters.jsx";
import { ProfileRow } from "./Profiles/ProfileRow.jsx";

// ─── helpers ─────────────────────────────────────────────────
const ORDER_STATUS_CSS = {
  pending:    "st-pending",
  processing: "st-inuse",
  shipped:    "st-transit",
  delivered:  "st-delivered",
  declined:   "st-decline",
  cancelled:  "st-archive",
};


// ─── DropForm ─────────────────────────────────────────────────
function DropForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(
    initial || { recipient_name: "", address: "", city: "", state: "", zip: "", country: "", phone: "" }
  );
  const { t } = useLang();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = form.address.trim() && form.city.trim() && form.country.trim();

  const fields = [
    ["recipient_name", t("drop_field_recipient"), 2],
    ["address", t("drop_field_address"), 2],
    ["city", t("drop_field_city"), 1],
    ["state", t("drop_field_state"), 1],
    ["zip", t("drop_field_zip"), 1],
    ["country", t("drop_field_country"), 1],
    ["phone", t("drop_field_phone"), 2],
  ];

  return (
    <div style={{
      background: "var(--surface)", borderRadius: 8, border: "1px solid var(--border)",
      padding: 16, marginTop: 8,
    }}>
      <div className="grid grid-cols-2 gap-3">
        {fields.map(([key, label, span]) => (
          <div key={key} style={span === 2 ? { gridColumn: "1 / -1" } : {}}>
            <label style={{
              display: "block", fontSize: 10, textTransform: "uppercase",
              letterSpacing: "0.1em", color: "var(--muted)", marginBottom: 4,
            }}>{label}</label>
            <input
              value={form[key]}
              onChange={set(key)}
              className="form-input w-full box-border"
            />
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2 mt-3">
        <button onClick={onCancel} className="btn btn-ghost btn-sm">{t("btn_cancel")}</button>
        <button
          onClick={() => valid && onSave(form)}
          disabled={!valid}
          className="btn btn-b btn-sm"
          style={!valid ? { opacity: 0.4, cursor: "not-allowed" } : {}}
        >
          Save Drop
        </button>
      </div>
    </div>
  );
}

// ─── ImportDropsModal ─────────────────────────────────────────
function ImportDropsModal({ profileId, onDone, onClose }) {
  const [step, setStep] = useState(1);
  const [raw, setRaw] = useState("");
  const [mapping, setMapping] = useState([]);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const { t } = useLang();

  const DROP_COLUMNS = ["recipient_name", "address", "city", "state", "zip", "country", "phone", "skip"];

  const handlePreview = async () => {
    if (!raw.trim()) return;
    setLoading(true);
    try {
      const p = await invoke("detect_mapping_preview", { raw });
      const cols = p.detected_mapping || [];
      const remapped = cols.map((c) => DROP_COLUMNS.includes(c) ? c : "skip");
      setMapping(remapped);
      setPreview(p);
      setStep(2);
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  };

  const handleImport = async () => {
    setLoading(true);
    try {
      const r = await invoke("import_drops", { profileId, raw, mapping });
      setResult(r);
      setStep(3);
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  };

  const dropFormRef = useRef(null);
  useFocusTrap(dropFormRef, true);
  // Scroll lock
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return (
    <div className="modal-overlay">
      <div ref={dropFormRef} className="modal w-[680px] max-h-[80vh] flex flex-col" role="dialog" aria-modal="true" aria-labelledby="import-drops-title">
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 24px", borderBottom: "1px solid var(--border)",
        }}>
          <div className="flex items-center gap-2">
            <Import size={18} className="text-blue-t" />
            <span id="import-drops-title" className="modal-title m-0">{t("import_drops_title")}</span>
          </div>
          <div className="flex gap-1">
            {[1, 2, 3].map((s) => (
              <div key={s} style={{
                width: 24, height: 6, borderRadius: 3,
                background: step >= s ? "#60a5fa" : "var(--border)",
                transition: "background 0.2s",
              }} />
            ))}
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {step === 1 && (
            <div className="flex flex-col gap-4">
              <p className="text-[13px] text-muted m-0">
                Paste raw drop data below. Supported delimiters:{" "}
                <code className="text-blue-t text-[11px] font-mono">| , ; TAB</code>
              </p>
              <textarea
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                rows={12}
                placeholder="John Doe | 123 Main St | New York | NY | 10001 | US | +1-555-0100"
                style={{
                  width: "100%", boxSizing: "border-box",
                  background: "var(--surface)", border: "1px solid var(--border)",
                  borderRadius: 8, padding: "12px 16px", fontSize: 13,
                  color: "var(--text)", fontFamily: "'JetBrains Mono',monospace",
                  outline: "none", resize: "none",
                }}
              />
              <button
                onClick={handlePreview}
                disabled={!raw.trim() || loading}
                className="btn btn-b"
                style={{ width: "100%", opacity: (!raw.trim() || loading) ? 0.4 : 1 }}
              >
                {loading ? t("drops_detecting") : t("drops_detect_btn")}
              </button>
            </div>
          )}

          {step === 2 && preview && (
            <div className="flex flex-col gap-4">
              <p className="text-[13px] text-muted m-0">Map columns to drop fields. First row shown as example.</p>
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="tbl">
                  <thead>
                    <tr>
                      {mapping.map((_, i) => (
                        <th key={i} className="font-normal">
                          <select
                            value={mapping[i]}
                            onChange={(e) => {
                              const m = [...mapping];
                              m[i] = e.target.value;
                              setMapping(m);
                            }}
                            style={{
                              background: "var(--surface)", border: "1px solid var(--border)",
                              color: "var(--text)", borderRadius: 6, padding: "5px 10px",
                              fontSize: 12, outline: "none",
                            }}
                          >
                            {DROP_COLUMNS.map((c) => (
                              <option key={c} value={c}>{c}</option>
                            ))}
                          </select>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.preview_rows.slice(0, 5).map((row, ri) => (
                      <tr key={ri}>
                        {row.map((cell, ci) => (
                          <td key={ci} style={{
                            fontFamily: "'JetBrains Mono',monospace",
                            color: mapping[ci] === "skip" ? "var(--muted)" : "var(--text)",
                            opacity: mapping[ci] === "skip" ? 0.5 : 1,
                          }}>
                            {cell || <span className="text-muted">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="btn btn-ghost">← {t("btn_cancel")}</button>
                <button
                  onClick={handleImport}
                  disabled={loading}
                  className="btn btn-b"
                  style={{ flex: 1, opacity: loading ? 0.4 : 1 }}
                >
                  {loading ? t("drops_importing") : t("drops_import_rows").replace("{n}", preview.preview_rows.length)}
                </button>
              </div>
            </div>
          )}

          {step === 3 && result && (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div style={{
                  background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)",
                  borderRadius: 10, padding: 16, textAlign: "center",
                }}>
                  <div className="text-[32px] font-bold text-green-t">{result.imported}</div>
                  <div className="text-[12px] text-muted mt-1">{t("cc_import_done")}</div>
                </div>
                <div style={{
                  background: "rgba(250,204,21,0.08)", border: "1px solid rgba(250,204,21,0.2)",
                  borderRadius: 10, padding: 16, textAlign: "center",
                }}>
                  <div className="text-[32px] font-bold text-yellow-t">{result.skipped}</div>
                  <div className="text-[12px] text-muted mt-1">{t("profiles_skipped")}</div>
                </div>
              </div>
              {result.errors?.length > 0 && (
                <div style={{
                  background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border)",
                  padding: 12, maxHeight: 160, overflowY: "auto",
                }}>
                  {result.errors.map((e, i) => (
                    <div key={i} className="text-[12px] text-red-t font-mono py-[2px]">{e}</div>
                  ))}
                </div>
              )}
              <button
                onClick={() => { onDone(); onClose(); }}
                className="btn btn-g w-full"
                
              >
                {t("proxy_import_done")}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── DuplicateDropsModal ──────────────────────────────────────
function DuplicateDropsModal({ groups, onClose }) {
  const { t } = useLang();
  // Scroll lock
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return (
    <div className="modal-overlay">
      <div className="modal w-[620px] max-h-[75vh] flex flex-col" role="dialog" aria-modal="true" aria-labelledby="duplicate-drops-title">
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 24px", borderBottom: "1px solid var(--border)",
        }}>
          <div className="flex items-center gap-2">
            <SearchCode size={18} className="text-yellow-t" />
            <span id="duplicate-drops-title" className="modal-title m-0">{t("duplicate_drops")}</span>
            <span style={{
              marginLeft: 8, fontSize: 11,
              background: "rgba(250,204,21,0.15)", color: "#facc15",
              padding: "2px 8px", borderRadius: 20,
            }}>{groups.length} groups</span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-6 flex flex-col gap-4">
          {groups.length === 0 ? (
            <div className="text-center py-12 text-muted">
              <CheckCircle2 size={40} className="mx-auto mb-3 text-[rgba(74,222,128,0.4)]" />
              <p className="m-0">{t("no_dup_drops")}</p>
            </div>
          ) : groups.map((group, gi) => (
            <div key={gi} style={{
              border: "1px solid rgba(250,204,21,0.2)", borderRadius: 10, overflow: "hidden",
            }}>
              <div style={{
                background: "rgba(250,204,21,0.05)", padding: "8px 16px",
                fontSize: 12, color: "#facc15", fontWeight: 500,
                borderBottom: "1px solid rgba(250,204,21,0.2)",
              }}>
                {group[0].address}, {group[0].city}, {group[0].country} — {group.length} duplicates
              </div>
              {group.map((d, di) => (
                <div key={d.id} style={{
                  padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between",
                  borderTop: di === 0 ? "none" : "1px solid var(--border)",
                }}>
                  <div>
                    <span className="text-[13px] text-text">{d.recipient_name}</span>
                    <span className="text-[11px] text-muted ml-2">profile: {shortId(d.profile_id)}</span>
                  </div>
                  <span className="text-[11px] font-mono text-muted">{d.phone || "—"}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── DuplicateProfilesModal ───────────────────────────────────
function DuplicateProfilesModal({ groups, onClose }) {
  const { t } = useLang();
  const dupProfRef = useRef(null);
  useFocusTrap(dupProfRef, true);
  // Scroll lock
  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  return (
    <div className="modal-overlay">
      <div ref={dupProfRef} className="modal w-[620px] max-h-[75vh] flex flex-col" role="dialog" aria-modal="true" aria-labelledby="duplicate-profiles-title">
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 24px", borderBottom: "1px solid var(--border)",
        }}>
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-orange-t" />
            <span id="duplicate-profiles-title" className="modal-title m-0">{t("duplicate_profiles")}</span>
            <span style={{
              marginLeft: 8, fontSize: 11,
              background: "rgba(251,146,60,0.15)", color: "#fb923c",
              padding: "2px 8px", borderRadius: 20,
            }}>{groups.length} groups</span>
          </div>
          <button className="modal-close" onClick={onClose} aria-label="Close"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-6 flex flex-col gap-4">
          {groups.length === 0 ? (
            <div className="text-center py-12 text-muted">
              <CheckCircle2 size={40} className="mx-auto mb-3 text-[rgba(74,222,128,0.4)]" />
              <p className="m-0">{t("no_dup_profiles")}</p>
            </div>
          ) : groups.map((group, gi) => (
            <div key={gi} style={{
              border: "1px solid rgba(251,146,60,0.2)", borderRadius: 10, overflow: "hidden",
            }}>
              <div style={{
                background: "rgba(251,146,60,0.05)", padding: "8px 16px",
                fontSize: 12, color: "#fb923c", fontWeight: 500,
                borderBottom: "1px solid rgba(251,146,60,0.2)",
              }}>
                Card {group[0].bin}••••{group[0].last4} — {group.length} profiles
              </div>
              {group.map((p, pi) => (
                <div key={p.id} style={{
                  padding: "8px 16px", display: "flex", alignItems: "center", justifyContent: "space-between",
                  borderTop: pi === 0 ? "none" : "1px solid var(--border)",
                }}>
                  <span className="text-[12px] font-mono text-text">{shortId(p.id)}</span>
                  <span className="text-[11px] text-muted">{p.drop_count} drops · {p.order_count} orders</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── ProfileDetail panel ──────────────────────────────────────
function ProfileDetailPanel({ profileId, onRefresh, onNavigate }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editNotes, setEditNotes] = useState(false);
  const [notes, setNotes] = useState("");
  const [addingDrop, setAddingDrop] = useState(false);
  const [editingDrop, setEditingDrop] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [showDupDrops, setShowDupDrops] = useState(false);
  const [dupDropGroups, setDupDropGroups] = useState([]);
  const [ltvData, setLtvData] = useState(null);
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const { t } = useLang();

  useEffect(() => {
    if (!profileId) return;
    invoke("get_profile_ltv", { profileId: String(profileId) })
      .then((data) => setLtvData(data))
      .catch(() => setLtvData(null));
  }, [profileId]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await invoke("get_profile_detail", { id: profileId });
      setDetail(d);
      setNotes(d.profile.notes || "");
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  }, [profileId]);

  useEffect(() => { load(); }, [load]);

  const saveNotes = async () => {
    try {
      await invoke("update_profile_notes", { id: profileId, notes });
      setEditNotes(false);
      toast("Notes saved", "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const handleAddDrop = async (form) => {
    try {
      await invoke("add_drop", { profileId, drop: form });
      setAddingDrop(false);
      load();
      onRefresh?.();
      toast("Drop added", "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const handleAutoDropFromBilling = async () => {
    if (!detail?.card) return;
    const c = detail.card;
    if (!c.billing_address && !c.city) {
      toast("No billing address on card", "warn"); return;
    }
    const form = {
      recipient_name: c.holder_name || "",
      address: c.billing_address || "",
      city: c.city || "",
      state: c.state || "",
      zip: c.zip || "",
      country: c.country || "",
      phone: c.phone || "",
    };
    try {
      await invoke("add_drop", { profileId, drop: form });
      load(); onRefresh?.();
      toast("Drop created from billing address", "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const handleUpdateDrop = async (form) => {
    try {
      await invoke("update_drop", { id: editingDrop.id, drop: form });
      setEditingDrop(null);
      load();
      toast("Drop updated", "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const handleSetPrimary = async (drop) => {
    try {
      await invoke("set_primary_drop", { id: drop.id, profileId });
      load();
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const handleDeleteDrop = async (drop) => {
    const ok = await confirm(t("confirm_delete_drop"), { danger: true });
    if (!ok) return;
    try {
      await invoke("delete_drop", { id: drop.id });
      load();
      onRefresh?.();
      toast("Drop deleted", "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const handleFindDupDrops = async () => {
    try {
      const groups = await invoke("find_duplicate_drops");
      setDupDropGroups(groups);
      setShowDupDrops(true);
    } catch (e) {
      toast(String(e), "error");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div style={{
          width: 24, height: 24, borderRadius: "50%",
          border: "2px solid rgba(96,165,250,0.3)",
          borderTopColor: "#60a5fa",
          animation: "spin 0.8s linear infinite",
        }} />
      </div>
    );
  }
  if (!detail) return null;

  const { card, drops, orders } = detail;
  const primaryDrop = drops.find((d) => d.is_primary);

  return (
    <div className="border-t border-border bg-[rgba(11,13,20,0.6)]">
      <div className="grid grid-cols-3 border-t-0">

        {/* ── Card info ── */}
        <div className="p-5 border-r border-border">
          <div className="flex items-center gap-2 mb-4">
            <CreditCard size={14} className="text-blue-t" />
            <span className="text-[10px] uppercase tracking-[0.1em] text-muted">{t("section_card")}</span>
          </div>
          <div className="flex flex-col gap-2">
            {[
              [t("card_label_number"), card.card_number ? `${card.bin || ""}••••••••${card.last4 || ""}` : "—"],
              [t("card_label_expiry"), card.expiry_date || "—"],
              [t("card_label_cvv"), "•••"],
              [t("card_label_holder"), card.holder_name || "—"],
              [t("card_label_bank"), card.bank_name || "—"],
              [t("card_label_type"), card.card_type || "—"],
              [t("card_label_level"), card.card_level || "—"],
              [t("card_label_country"), card.country || "—"],
              [t("cc_col_status"), card.status || "—"],
            ].map(([label, val]) => (
              <div key={label} className="flex items-center justify-between">
                <span className="text-[11px] text-muted">{label}</span>
                <span style={{
                  fontSize: 12, fontFamily: "'JetBrains Mono',monospace",
                  color: label === t("cc_col_status") ? (CARD_STATUS_COLORS[card.status]?.text || "var(--muted)") : "var(--text)",
                }}>
                  {val}
                </span>
              </div>
            ))}
          </div>
          {/* Notes */}
          <div className="pt-4 mt-4 border-t border-border">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-muted">{t("cc_col_notes")}</span>
              {!editNotes && (
                <button
                  onClick={() => setEditNotes(true)}
                  className="bg-transparent border-none cursor-pointer text-muted p-0.5"
                >
                  <Edit2 size={12} />
                </button>
              )}
            </div>
            {editNotes ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    background: "var(--surface)", border: "1px solid var(--border)",
                    borderRadius: 6, padding: "8px 12px", fontSize: 12,
                    color: "var(--text)", outline: "none", resize: "none",
                  }}
                />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setEditNotes(false)} className="btn btn-ghost btn-sm">{t("btn_cancel")}</button>
                  <button onClick={saveNotes} className="btn btn-b btn-sm">{t("btn_save")}</button>
                </div>
              </div>
            ) : (
              <p className="text-[12px] text-muted italic m-0">{notes || t("no_notes")}</p>
            )}
          </div>
        </div>

        {/* ── Drops ── */}
        <div className="p-5 border-r border-border">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <MapPin size={14} className="text-green-t" />
              <span className="text-[10px] uppercase tracking-[0.1em] text-muted">{t("section_shipping")}</span>
            </div>
            <div className="flex gap-1">
              <button
                onClick={handleFindDupDrops}
                title={t("find_dup_drops")}
                className="icon-btn icon-btn-yellow"
              >
                <SearchCode size={13} />
              </button>
              <button
                onClick={() => setShowImport(true)}
                title={t("import_drops")}
                className="icon-btn icon-btn-blue"
              >
                <Import size={13} />
              </button>
              <button
                onClick={handleAutoDropFromBilling}
                title="Auto-create drop from card billing address"
                className="icon-btn icon-btn-purple"
              >
                <CreditCard size={13} />
              </button>
              <button
                onClick={() => { setAddingDrop(true); setEditingDrop(null); }}
                title={t("add_drop")}
                className="icon-btn icon-btn-green"
              >
                <Plus size={13} />
              </button>
            </div>
          </div>

          {addingDrop && (
            <DropForm onSave={handleAddDrop} onCancel={() => setAddingDrop(false)} />
          )}

          <div className="flex flex-col gap-2 max-h-[288px] overflow-y-auto pr-1">
            {drops.length === 0 && !addingDrop && (
              <div className="text-center py-6 text-muted text-[12px]">
                <MapPin size={24} className="block opacity-30 mx-auto mb-2" />
                No shipping addresses
              </div>
            )}
            {drops.map((drop) => (
              <div key={drop.id}>
                {editingDrop?.id === drop.id ? (
                  <DropForm
                    initial={drop}
                    onSave={handleUpdateDrop}
                    onCancel={() => setEditingDrop(null)}
                  />
                ) : (
                  <div style={{
                    borderRadius: 10, padding: 12,
                    border: `1px solid ${drop.is_primary ? "rgba(74,222,128,0.3)" : "var(--border)"}`,
                    background: drop.is_primary ? "rgba(74,222,128,0.05)" : "rgba(23,27,40,0.5)",
                    transition: "border-color 0.2s",
                  }}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          {drop.is_primary && <Star size={11} className="text-green-t fill-green-t shrink-0" />}
                          <span className="text-[12px] font-medium text-text overflow-hidden text-ellipsis whitespace-nowrap">
                            {drop.recipient_name}
                          </span>
                        </div>
                        <p className="text-[11px] text-muted leading-[1.5] m-0">
                          {drop.address}, {drop.city}{drop.state ? `, ${drop.state}` : ""} {drop.zip}, {drop.country}
                        </p>
                        {drop.phone && <p className="text-[11px] text-muted mt-0.5 mb-0">{drop.phone}</p>}
                      </div>
                      <div className="flex gap-1 shrink-0">
                        {!drop.is_primary && (
                          <button
                            onClick={() => handleSetPrimary(drop)}
                            title={t("set_primary")}
                            className="icon-btn icon-btn-green"
                          >
                            <StarOff size={12} />
                          </button>
                        )}
                        <button
                          onClick={() => setEditingDrop(drop)}
                          className="icon-btn icon-btn-blue"
                        >
                          <Edit2 size={12} />
                        </button>
                        <button
                          onClick={() => handleDeleteDrop(drop)}
                          className="icon-btn icon-btn-red"
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* ── Orders ── */}
        <div className="p-5">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Package size={14} className="text-blue-t" />
              <span className="text-[10px] uppercase tracking-[0.1em] text-muted">{t("section_orders")}</span>
            </div>
            <button
              className="btn btn-ghost btn-sm flex items-center gap-1"
              onClick={() => onNavigate?.("orders", { profileId })}
            >
              <ShoppingCart size={12} /> New Order
            </button>
          </div>
          {ltvData && (
            <div style={{ fontSize: 11, color: "var(--muted)", marginBottom: 10, fontFamily: "'JetBrains Mono',monospace" }}>
              LTV: ${Number(ltvData.total).toFixed(2)} | {ltvData.orders} orders | Avg ${Number(ltvData.avg).toFixed(2)}
            </div>
          )}
          <div className="flex flex-col max-h-[288px] overflow-y-auto pr-1">
            {orders.length === 0 && (
              <div className="text-center py-6 text-muted text-[12px]">
                <Package size={24} className="block opacity-30 mx-auto mb-2" />
                No orders yet
              </div>
            )}
            {orders.map((o, oi) => (
              <div key={o.id} style={{
                display: "flex", alignItems: "center", justifyContent: "space-between",
                padding: "8px 0",
                borderBottom: oi < orders.length - 1 ? "1px solid var(--border)" : "none",
              }}>
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`st ${ORDER_STATUS_CSS[o.status] ?? "st-archive"}`}>
                      {o.status}
                    </span>
                    <span className="text-[12px] text-text">{o.shop_name || "—"}</span>
                  </div>
                  {o.tracking_number && (
                    <p className="text-[10px] font-mono text-muted m-0">{o.tracking_number}</p>
                  )}
                </div>
                <div className="text-right">
                  {o.total_amount != null && (
                    <p className="text-[12px] text-text m-0">${o.total_amount.toFixed(2)}</p>
                  )}
                  <p className="text-[10px] text-muted m-0">{o.created_at?.slice(0, 10)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showImport && (
        <ImportDropsModal
          profileId={profileId}
          onDone={() => { load(); onRefresh?.(); }}
          onClose={() => setShowImport(false)}
        />
      )}
      {showDupDrops && (
        <DuplicateDropsModal groups={dupDropGroups} onClose={() => setShowDupDrops(false)} />
      )}
    </div>
  );
}

// ─── CreateProfileModal ───────────────────────────────────────

// ─── QuickOrderModal ──────────────────────────────────────────
function QuickOrderModal({ profile, onClose, onCreated }) {
  const [url, setUrl] = useState("");
  const [shop, setShop] = useState(null); // { id, domain, is_new }
  const [lookingUp, setLookingUp] = useState(false);
  const [itemName, setItemName] = useState("");
  const [itemSku, setItemSku] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  const handleLookup = async () => {
    if (!url.trim()) return;
    setLookingUp(true);
    try {
      const result = await invoke("find_or_create_shop", { url: url.trim() });
      setShop(result);
    } catch (e) { toast(String(e), "error"); }
    finally { setLookingUp(false); }
  };

  const handleCreate = async () => {
    if (!shop) return;
    setSaving(true);
    try {
      const amountF = parseFloat(amount) || 0;
      await invoke("create_order", {
        input: {
          profile_id: String(profile.id),
          shop_id: shop.id,
          drop_id: null,
          email_pool_id: null,
          proxy_id: null,
          order_number: null,
          notes: null,
          items: [{ name: itemName || shop.domain, sku: itemSku || "", qty: 1, price: amountF }],
        }
      });
      toast("Order created!", "success");
      onCreated?.();
      onClose();
    } catch (e) { toast(String(e), "error"); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>New Order — {profile.holder_masked || `••••${profile.last4 || "?????"}`}</span>
          <button className="icon-btn" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div>
            <label style={{ fontSize: 11, color: "var(--muted)" }}>Shop URL or Domain</label>
            <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
              <input
                className="inp"
                placeholder="nike.com or https://nike.com/checkout"
                value={url}
                onChange={e => { setUrl(e.target.value); setShop(null); }}
                onKeyDown={e => e.key === "Enter" && handleLookup()}
                style={{ flex: 1 }}
                autoFocus
              />
              <button className="btn btn-b" onClick={handleLookup} disabled={lookingUp || !url.trim()}>
                {lookingUp ? "..." : "Find"}
              </button>
            </div>
          </div>

          {shop && (
            <div style={{ padding: "8px 12px", background: "var(--surface2)", borderRadius: 6, fontSize: 12, display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ color: shop.is_new ? "var(--accent)" : "var(--text)" }}>
                {shop.is_new ? "✦ New shop:" : "✓ Found:"} <strong>{shop.domain}</strong>
              </span>
            </div>
          )}

          {shop && (
            <>
              <input className="inp" placeholder="Item name (optional)" value={itemName} onChange={e => setItemName(e.target.value)} />
              <input className="inp" placeholder="SKU (optional)" value={itemSku} onChange={e => setItemSku(e.target.value)} />
              <input className="inp" placeholder="Amount, e.g. 89.99" value={amount} onChange={e => setAmount(e.target.value)} />
            </>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-g" onClick={handleCreate} disabled={!shop || saving}>
            {saving ? "Creating..." : "Create Order"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main ProfileList ─────────────────────────────────────────
export default function ProfileList({ onNavigate, activeTab = "list", openCreate: initOpenCreate = false }) {
  const [profiles, setProfiles] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState({ has_drop: null, search: "", card_status: null });
  const [searchInput, setSearchInput] = useState("");
  const [deletingIds, setDeletingIds] = useState(new Set());
  const debouncedSearch = useDebounce(searchInput, 300);
  const [expanded, setExpanded] = useState(null);
  const [hoveredProfile, setHoveredProfile] = useState(null);
  const hoverTimer = useRef(null);
  const [showCreate, setShowCreate] = useState(initOpenCreate);
  const [showDupProfiles, setShowDupProfiles] = useState(false);
  const [dupProfileGroups, setDupProfileGroups] = useState([]);
  const [quickOrderProfile, setQuickOrderProfile] = useState(null);
  const [selectedIdx, setSelectedIdx] = useState(null);
  const tableBodyRef = useRef(null);
  const tableContainerRef = useRef(null);
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const { t } = useLang();
  const PER_PAGE = 50;

  // Virtual scrolling setup
  const rowVirtualizer = useVirtualizer({
    count: profiles.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: useCallback((index) => {
      // Base row height + expanded detail panel if open
      const profile = profiles[index];
      return expanded === profile?.id ? 450 : 50;
    }, [profiles, expanded]),
    overscan: 5,
  });

  const load = useCallback(async (p = page, f = filter) => {
    setLoading(true);
    try {
      const result = await invoke("get_profiles", {
        filter: { has_drop: f.has_drop, search: f.search || null, card_status: f.card_status },
        page: p,
        perPage: PER_PAGE,
      });
      setProfiles(result.items);
      setTotal(result.total);
      if (result.items.length === 0 && result.total > 0 && p > 1) {
        setPage((prev) => Math.max(1, prev - 1));
      }
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => { load(); }, [load]);

  // #20 debounce search
  useEffect(() => {
    const f = { ...filter, search: debouncedSearch };
    setFilter(f);
    load(1, f);
  }, [debouncedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (activeTab === "nodrop") {
      const f = { ...filter, has_drop: false };
      setFilter(f);
      setPage(1);
      load(1, f);
    } else if (activeTab === "list") {
      const f = { ...filter, has_drop: null };
      setFilter(f);
      setPage(1);
      load(1, f);
    }
  }, [activeTab]);

  // H4: Keyboard navigation with virtual scrolling
  useEffect(() => {
    const onKey = (e) => {
      // Don't intercept when typing in an input/textarea
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
      if (profiles.length === 0) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIdx((i) => {
          const next = i === null ? 0 : Math.min(i + 1, profiles.length - 1);
          // Scroll to row using virtualizer
          rowVirtualizer.scrollToIndex(next, { align: "auto" });
          return next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIdx((i) => {
          const prev = i === null ? 0 : Math.max(i - 1, 0);
          // Scroll to row using virtualizer
          rowVirtualizer.scrollToIndex(prev, { align: "auto" });
          return prev;
        });
      } else if (e.key === "Enter" && selectedIdx !== null) {
        e.preventDefault();
        const p = profiles[selectedIdx];
        if (p) invoke("open_float_window", { profileId: p.id }).catch(() => {});
      } else if (e.key === "Escape") {
        setSelectedIdx(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [profiles, selectedIdx, rowVirtualizer]);

  const handleSearch = (e) => {
    if (e.key === "Enter") {
      setPage(1);
      load(1, filter);
    }
  };

  const handleDelete = async (profile) => {
    // #15 — undo delete, no confirm dialog
    setDeletingIds(prev => new Set([...prev, profile.id]));
    let undone = false;
    toast({
      message: t("profile_deleted"),
      type: "info",
      duration: 5000,
      action: {
        label: "Undo",
        onClick: () => {
          undone = true;
          setDeletingIds(prev => { const n = new Set(prev); n.delete(profile.id); return n; });
        },
      },
    });
    setTimeout(async () => {
      if (undone) return;
      try {
        await invoke("delete_profile", { id: profile.id });
        setDeletingIds(prev => { const n = new Set(prev); n.delete(profile.id); return n; });
        load();
      } catch (e) {
        setDeletingIds(prev => { const n = new Set(prev); n.delete(profile.id); return n; });
        if (e.includes?.("active_orders")) {
          const count = e.split(":")[1];
          toast(`Cannot delete: ${count} active order(s)`, "error");
        } else {
          toast(String(e), "error");
        }
      }
    }, 5000);
  };

  const handleDuplicate = async (profile) => {
    try {
      const p = await invoke("duplicate_profile", { id: profile.id });
      toast(`Profile duplicated → ${shortId(p.id)}`, "success");
      load();
    } catch (e) {
      if (e.includes?.("no_free_cards") || e.includes?.("no_unburned_free_card")) {
        toast("No suitable free card found for duplication", "warn");
      } else {
        toast(String(e), "error");
      }
    }
  };

  const handleFindDupProfiles = async () => {
    try {
      const groups = await invoke("find_duplicate_profiles");
      setDupProfileGroups(groups);
      setShowDupProfiles(true);
    } catch (e) {
      toast(String(e), "error");
    }
  };

  // Copy helpers — reveal encrypted card data first
  const copyProfile = async (p) => {
    try {
      const card = await invoke("reveal_card", { id: p.card_id });
      const lines = [
        `Card: ${card.card_number} | ${card.expiry_date} | ${card.cvv} | ${card.holder_name || "—"}`,
        `Bank: ${p.bank_name || "—"} · ${p.country || "—"}`,
        `Billing: ${card.billing_address || "—"}, ${card.city || ""} ${card.state || ""} ${card.zip || ""}, ${card.country || ""}`,
      ];
      copyText(lines.join("\n"));
      toast("Profile copied", "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const copyCard = async (p) => {
    try {
      const card = await invoke("reveal_card", { id: p.card_id });
      copyText(buildPipeString(p, card));
      toast("Card format copied", "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const copyBilling = async (p) => {
    try {
      const card = await invoke("reveal_card", { id: p.card_id });
      const addr = [card.billing_address, card.city, card.state, card.zip, card.country].filter(Boolean).join(", ");
      copyText(addr);
      toast("Billing address copied", "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const copyShipping = async (p) => {
    try {
      const detail = await invoke("get_profile", { id: String(p.id) });
      const drop = detail.drops?.find(d => d.is_primary) ?? detail.drops?.[0];
      if (!drop) { toast("No drop address", "warn"); return; }
      const addr = [drop.recipient_name, drop.address, drop.city, drop.state, drop.zip, drop.country].filter(Boolean).join(", ");
      copyText(addr);
      toast("Shipping address copied", "success");
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div className="content">
      {/* Header */}
      <div className="ph">
        <div><div className="ph-title">Profiles</div></div>
        <div className="ph-actions">
          <button className="btn btn-ghost btn-sm" onClick={() => {
            const rows = profiles.map(p =>
              [p.id, p.holder_masked ?? "", p.last4 ?? "", p.bank_name ?? "", p.country ?? "", p.order_count, p.drop_count, p.card_status ?? ""]
                .map(v => `"${String(v).replace(/"/g, '""')}"`)
                .join(",")
            );
            const csv = ["ID,Holder,Last4,Bank,Country,Orders,Drops,CardStatus", ...rows].join("\n");
            const a = document.createElement("a");
            a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
            a.download = "profiles_export.csv";
            a.click();
          }}><Download size={13} /> Export</button>
          <button className="btn btn-g" onClick={() => setShowCreate(true)}>+ {t("new_profile")}</button>
          <button className="btn btn-ghost btn-sm" onClick={handleFindDupProfiles}>{t("find_duplicates")}</button>
        </div>
      </div>

      {/* Filters */}
      <ProfileFilters
        filter={filter}
        searchInput={searchInput}
        onFilterChange={(newFilter) => {
          setFilter(newFilter);
          setPage(1);
          load(1, newFilter);
        }}
        onSearchChange={setSearchInput}
        onSearch={() => load(1, { ...filter, search: searchInput })}
      />

      {/* Table */}
      <div className="panel p-0 overflow-x-auto">
        <div
          ref={tableContainerRef}
          style={{ flex: 1, minHeight: 0, overflowY: "auto", maxHeight: "calc(100vh - 280px)" }}
        >
        <table className="tbl">
          <thead className="sticky top-0 z-[3] bg-card">
            <tr>
              <th className="bg-card"></th>
              <th className="bg-card">{t("prof_col_profile")}</th>
              <th className="bg-card">{t("prof_col_card")}</th>
              <th className="bg-card">{t("prof_col_type")}</th>
              <th className="bg-card">{t("prof_col_bank")}</th>
              <th className="bg-card">{t("prof_col_country")}</th>
              <th className="bg-card">{t("prof_col_status")}</th>
              <th className="bg-card">{t("prof_col_drops")}</th>
              <th className="bg-card">{t("prof_col_orders")}</th>
              <th className="bg-card">{t("cc_col_notes")}</th>
              <th className="bg-card">{t("prof_col_created")}</th>
              <th className="bg-card">{t("cc_col_actions")}</th>
            </tr>
          </thead>
          <tbody ref={tableBodyRef}>
            {loading && profiles.length === 0 && (
              <SkeletonRows count={6} cols={12} />
            )}
            {profiles.length === 0 && !loading && (
              <EmptyState
                colSpan={12}
                icon={<User size={38} />}
                title={t("no_profiles")}
                subtitle={t("new_profile")}
                action={<button className="btn btn-g btn-sm" onClick={() => setShowCreate(true)}>+ Create Profile</button>}
              />
            )}
            {!loading && profiles.length > 0 && (
              <>
                {/* Spacer for virtual scroll offset */}
                {rowVirtualizer.getVirtualItems().length > 0 && (
                  <tr style={{ height: `${rowVirtualizer.getVirtualItems()[0].start}px` }}>
                    <td colSpan={12} style={{ padding: 0, border: 0 }}></td>
                  </tr>
                )}

                {/* Render visible rows */}
                {rowVirtualizer.getVirtualItems().map((virtualRow) => {
                  const idx = virtualRow.index;
                  const p = profiles[idx];
                  if (!p) return null;

                  const isExpanded = expanded === p.id;
                  const isDeleting = deletingIds.has(p.id);
                  const isSelected = selectedIdx === idx;

                  return (
                    <React.Fragment key={p.id}>
                      <ProfileRow
                        profile={p}
                        idx={idx}
                        isExpanded={isExpanded}
                        isDeleting={isDeleting}
                        isSelected={isSelected}
                        onRowClick={() => {
                          setSelectedIdx(idx);
                          setExpanded(isExpanded ? null : p.id);
                          // Remeasure after state change
                          setTimeout(() => rowVirtualizer.measure(), 0);
                        }}
                        onMouseEnter={(e) => {
                          const rect = e.currentTarget.getBoundingClientRect();
                          hoverTimer.current = setTimeout(() => setHoveredProfile({ p, rect }), 400);
                        }}
                        onMouseLeave={() => { clearTimeout(hoverTimer.current); setHoveredProfile(null); }}
                        onDelete={() => handleDelete(p)}
                        onDuplicate={() => handleDuplicate(p)}
                        onCopyProfile={() => copyProfile(p)}
                        onCopyBilling={() => copyBilling(p)}
                        onCopyShipping={() => copyShipping(p)}
                        onQuickOrder={() => setQuickOrderProfile(p)}
                      />
                      {isExpanded && (
                        <tr key={`${p.id}-detail`}>
                          <td colSpan={12} className="p-0">
                            <ProfileDetailPanel profileId={p.id} onRefresh={load} onNavigate={onNavigate} />
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}

                {/* Spacer for remaining virtual scroll space */}
                {rowVirtualizer.getVirtualItems().length > 0 && (
                  <tr style={{
                    height: `${
                      rowVirtualizer.getTotalSize() -
                      (rowVirtualizer.getVirtualItems()[rowVirtualizer.getVirtualItems().length - 1]?.end || 0)
                    }px`
                  }}>
                    <td colSpan={12} style={{ padding: 0, border: 0 }}></td>
                  </tr>
                )}
              </>
            )}
          </tbody>
        </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3">
          <span className="text-[12px] text-muted">{total} profiles</span>
          <div className="flex gap-1">
            {buildPageNumbers(page, totalPages).map((p, idx) =>
              p === "…" ? (
                <span key={`ellipsis-${idx}`} className="px-2 py-1 text-[12px] text-muted">…</span>
              ) : (
                <button
                  key={p}
                  onClick={() => { setPage(p); load(p, filter); }}
                  className={`btn btn-ghost btn-sm${page === p ? " active" : ""}`}
                  style={page === p ? { background: "var(--accent)", color: "var(--text)", borderColor: "var(--accent)" } : {}}
                >
                  {p}
                </button>
              )
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      {showCreate && (
        <ProfileModal
          onCreated={() => load()}
          onClose={() => setShowCreate(false)}
        />
      )}
      {showDupProfiles && (
        <DuplicateProfilesModal groups={dupProfileGroups} onClose={() => setShowDupProfiles(false)} />
      )}
      {quickOrderProfile && (
        <QuickOrderModal
          profile={quickOrderProfile}
          onClose={() => setQuickOrderProfile(null)}
          onCreated={() => load()}
        />
      )}
      {hoveredProfile && (() => {
        const { p, rect } = hoveredProfile;
        const top = Math.min(rect.top + rect.height / 2 - 55, window.innerHeight - 130);
        const left = Math.min(rect.right + 10, window.innerWidth - 240);
        return (
          <div style={{
            position: "fixed", top, left, zIndex: 200, pointerEvents: "none",
            background: "var(--card)", border: "1px solid var(--border)", borderRadius: 10,
            padding: "12px 14px", minWidth: 200, maxWidth: 240,
            boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
          }}>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="font-mono text-text text-[13px] font-medium">
                ••••-{p.last4 || "????"}
              </span>
              <span style={{
                fontSize: 10, padding: "1px 6px", borderRadius: 4,
                background: p.drop_count > 0 ? "rgba(34,197,94,0.12)" : "rgba(234,179,8,0.12)",
                border: `1px solid ${p.drop_count > 0 ? "rgba(34,197,94,0.25)" : "rgba(234,179,8,0.25)"}`,
                color: p.drop_count > 0 ? "#22c55e" : "#eab308",
              }}>
                {p.drop_count > 0 ? t("profile_ready") : t("profile_no_drop")}
              </span>
            </div>
            {p.holder_masked && <div className="text-muted text-[12px] mb-1">{p.holder_masked}</div>}
            <div className="flex flex-wrap gap-1.5">
              {p.bin && <span className="text-muted text-[11px] font-mono">BIN {p.bin}</span>}
              {p.bank_name && <span className="text-[11px] text-muted">· {p.bank_name}</span>}
            </div>
            {p.drop_count !== undefined && (
              <div className="mt-[5px] text-muted text-[11px]">
                {p.drop_count} drop{p.drop_count !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
