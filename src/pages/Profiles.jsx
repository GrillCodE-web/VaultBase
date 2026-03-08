import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  User, CreditCard, MapPin, Plus, Copy, Trash2, Star, StarOff,
  ChevronDown, ChevronRight, Search, RefreshCw, AlertTriangle,
  Package, ExternalLink, Layers, Import, CheckCircle2, XCircle,
  Edit2, Check, X, Filter, MoreHorizontal, Maximize2, ClipboardCopy,
  ShoppingCart, SearchCode
} from "lucide-react";
import { useLang } from "../hooks/useLang";
import { useToast } from "../hooks/useToast";
import { useConfirm } from "../hooks/useConfirm";
import { SkeletonRows } from "../components/SkeletonRow.jsx";

// ─── helpers ─────────────────────────────────────────────────
const STATUS_COLOR_MAP = {
  active:  "#4ade80",
  free:    "#4ade80",
  in_use:  "#60a5fa",
  dead:    "#f87171",
  blocked: "#f87171",
};

const ORDER_STATUS_CSS = {
  pending:    "st-pending",
  processing: "st-inuse",
  shipped:    "st-transit",
  delivered:  "st-delivered",
  declined:   "st-decline",
  cancelled:  "st-archive",
};

function copyText(text) {
  navigator.clipboard.writeText(text).catch(() => {});
}

function shortId(id) {
  return id ? id.slice(-8).toUpperCase() : "—";
}

function maskedCard(last4, bin) {
  if (!last4) return "—";
  const b = bin ? bin.slice(0, 4) : "????";
  return `${b}••••••••${last4}`;
}

// ─── DropForm ─────────────────────────────────────────────────
function DropForm({ initial, onSave, onCancel }) {
  const [form, setForm] = useState(
    initial || { recipient_name: "", address: "", city: "", state: "", zip: "", country: "", phone: "" }
  );
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = form.address.trim() && form.city.trim() && form.country.trim();

  const fields = [
    ["recipient_name", "Recipient Name", 2],
    ["address", "Address *", 2],
    ["city", "City *", 1],
    ["state", "State", 1],
    ["zip", "ZIP *", 1],
    ["country", "Country *", 1],
    ["phone", "Phone", 2],
  ];

  return (
    <div style={{
      background: "var(--surface)", borderRadius: 8, border: "1px solid var(--border)",
      padding: 16, marginTop: 8,
    }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {fields.map(([key, label, span]) => (
          <div key={key} style={span === 2 ? { gridColumn: "1 / -1" } : {}}>
            <label style={{
              display: "block", fontSize: 10, textTransform: "uppercase",
              letterSpacing: "0.1em", color: "var(--muted)", marginBottom: 4,
            }}>{label}</label>
            <input
              value={form[key]}
              onChange={set(key)}
              className="form-input"
              style={{ width: "100%", boxSizing: "border-box" }}
            />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
        <button onClick={onCancel} className="btn btn-ghost btn-sm">Cancel</button>
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

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 680, maxHeight: "80vh", display: "flex", flexDirection: "column" }}>
        {/* Header */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 24px", borderBottom: "1px solid var(--border)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Import size={18} style={{ color: "#c084fc" }} />
            <span className="modal-title" style={{ margin: 0 }}>Import Drops</span>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            {[1, 2, 3].map((s) => (
              <div key={s} style={{
                width: 24, height: 6, borderRadius: 3,
                background: step >= s ? "#c084fc" : "var(--border)",
                transition: "background 0.2s",
              }} />
            ))}
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: 24 }}>
          {step === 1 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>
                Paste raw drop data below. Supported delimiters:{" "}
                <code style={{ color: "#60a5fa", fontSize: 11, fontFamily: "'JetBrains Mono',monospace" }}>| , ; TAB</code>
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
                {loading ? "Detecting…" : "Detect Columns →"}
              </button>
            </div>
          )}

          {step === 2 && preview && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <p style={{ fontSize: 13, color: "var(--muted)", margin: 0 }}>Map columns to drop fields. First row shown as example.</p>
              <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid var(--border)" }}>
                <table className="tbl">
                  <thead>
                    <tr>
                      {mapping.map((_, i) => (
                        <th key={i} style={{ fontWeight: "normal" }}>
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
                            {cell || <span style={{ color: "var(--muted)" }}>—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div style={{ display: "flex", gap: 12 }}>
                <button onClick={() => setStep(1)} className="btn btn-ghost">← Back</button>
                <button
                  onClick={handleImport}
                  disabled={loading}
                  className="btn btn-b"
                  style={{ flex: 1, opacity: loading ? 0.4 : 1 }}
                >
                  {loading ? "Importing…" : `Import ${preview.preview_rows.length} Rows →`}
                </button>
              </div>
            </div>
          )}

          {step === 3 && result && (
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                <div style={{
                  background: "rgba(74,222,128,0.08)", border: "1px solid rgba(74,222,128,0.2)",
                  borderRadius: 10, padding: 16, textAlign: "center",
                }}>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "#4ade80" }}>{result.parsed}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Imported</div>
                </div>
                <div style={{
                  background: "rgba(250,204,21,0.08)", border: "1px solid rgba(250,204,21,0.2)",
                  borderRadius: 10, padding: 16, textAlign: "center",
                }}>
                  <div style={{ fontSize: 32, fontWeight: 700, color: "#facc15" }}>{result.skipped}</div>
                  <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 4 }}>Skipped</div>
                </div>
              </div>
              {result.errors?.length > 0 && (
                <div style={{
                  background: "var(--surface)", borderRadius: 10, border: "1px solid var(--border)",
                  padding: 12, maxHeight: 160, overflowY: "auto",
                }}>
                  {result.errors.map((e, i) => (
                    <div key={i} style={{ fontSize: 12, color: "#f87171", fontFamily: "'JetBrains Mono',monospace", padding: "2px 0" }}>{e}</div>
                  ))}
                </div>
              )}
              <button
                onClick={() => { onDone(); onClose(); }}
                className="btn btn-g"
                style={{ width: "100%" }}
              >
                Done ✓
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
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 620, maxHeight: "75vh", display: "flex", flexDirection: "column" }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 24px", borderBottom: "1px solid var(--border)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <SearchCode size={18} style={{ color: "#facc15" }} />
            <span className="modal-title" style={{ margin: 0 }}>Duplicate Drops</span>
            <span style={{
              marginLeft: 8, fontSize: 11,
              background: "rgba(250,204,21,0.15)", color: "#facc15",
              padding: "2px 8px", borderRadius: 20,
            }}>{groups.length} groups</span>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          {groups.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 0", color: "var(--muted)" }}>
              <CheckCircle2 size={40} style={{ margin: "0 auto 12px", color: "rgba(74,222,128,0.4)" }} />
              <p style={{ margin: 0 }}>No duplicate addresses found</p>
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
                    <span style={{ fontSize: 13, color: "var(--text)" }}>{d.recipient_name}</span>
                    <span style={{ fontSize: 11, color: "var(--muted)", marginLeft: 8 }}>profile: {shortId(d.profile_id)}</span>
                  </div>
                  <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono',monospace", color: "var(--muted)" }}>{d.phone || "—"}</span>
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
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 620, maxHeight: "75vh", display: "flex", flexDirection: "column" }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 24px", borderBottom: "1px solid var(--border)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Layers size={18} style={{ color: "#fb923c" }} />
            <span className="modal-title" style={{ margin: 0 }}>Duplicate Profiles</span>
            <span style={{
              marginLeft: 8, fontSize: 11,
              background: "rgba(251,146,60,0.15)", color: "#fb923c",
              padding: "2px 8px", borderRadius: 20,
            }}>{groups.length} groups</span>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ overflowY: "auto", padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          {groups.length === 0 ? (
            <div style={{ textAlign: "center", padding: "48px 0", color: "var(--muted)" }}>
              <CheckCircle2 size={40} style={{ margin: "0 auto 12px", color: "rgba(74,222,128,0.4)" }} />
              <p style={{ margin: 0 }}>No duplicate profiles found</p>
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
                  <span style={{ fontSize: 12, fontFamily: "'JetBrains Mono',monospace", color: "var(--text)" }}>{shortId(p.id)}</span>
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>{p.drop_count} drops · {p.order_count} orders</span>
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
function ProfileDetailPanel({ profileId, onRefresh }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editNotes, setEditNotes] = useState(false);
  const [notes, setNotes] = useState("");
  const [addingDrop, setAddingDrop] = useState(false);
  const [editingDrop, setEditingDrop] = useState(null);
  const [showImport, setShowImport] = useState(false);
  const [showDupDrops, setShowDupDrops] = useState(false);
  const [dupDropGroups, setDupDropGroups] = useState([]);
  const { toast } = useToast();
  const { confirm } = useConfirm();

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
    const ok = await confirm(`Delete drop for ${drop.recipient_name}?`, { danger: true });
    if (!ok) return;
    try {
      await invoke("delete_drop", { id: drop.id, profileId });
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
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "48px 0" }}>
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
    <div style={{ borderTop: "1px solid var(--border)", background: "rgba(11,13,20,0.6)" }}>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", borderTop: "none" }}>

        {/* ── Card info ── */}
        <div style={{ padding: 20, borderRight: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
            <CreditCard size={14} style={{ color: "#60a5fa" }} />
            <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted)" }}>Card</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {[
              ["Number", card.card_number ? `${card.bin || ""}••••••••${card.last4 || ""}` : "—"],
              ["Expiry", card.expiry_date || "—"],
              ["CVV", "•••"],
              ["Holder", card.holder_name || "—"],
              ["Bank", card.bank_name || "—"],
              ["Type", card.card_type || "—"],
              ["Level", card.card_level || "—"],
              ["Country", card.country || "—"],
              ["Status", card.status || "—"],
            ].map(([label, val]) => (
              <div key={label} style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontSize: 11, color: "var(--muted)" }}>{label}</span>
                <span style={{
                  fontSize: 12, fontFamily: "'JetBrains Mono',monospace",
                  color: label === "Status" ? (STATUS_COLOR_MAP[card.status] || "var(--muted)") : "var(--text)",
                }}>
                  {val}
                </span>
              </div>
            ))}
          </div>
          {/* Notes */}
          <div style={{ paddingTop: 16, marginTop: 16, borderTop: "1px solid var(--border)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
              <span style={{ fontSize: 11, color: "var(--muted)" }}>Notes</span>
              {!editNotes && (
                <button
                  onClick={() => setEditNotes(true)}
                  style={{ background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 2 }}
                >
                  <Edit2 size={12} />
                </button>
              )}
            </div>
            {editNotes ? (
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
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
                <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
                  <button onClick={() => setEditNotes(false)} className="btn btn-ghost btn-sm">Cancel</button>
                  <button onClick={saveNotes} className="btn btn-b btn-sm">Save</button>
                </div>
              </div>
            ) : (
              <p style={{ fontSize: 12, color: "var(--muted)", fontStyle: "italic", margin: 0 }}>{notes || "No notes"}</p>
            )}
          </div>
        </div>

        {/* ── Drops ── */}
        <div style={{ padding: 20, borderRight: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <MapPin size={14} style={{ color: "#4ade80" }} />
              <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted)" }}>Shipping Addresses</span>
            </div>
            <div style={{ display: "flex", gap: 4 }}>
              <button
                onClick={handleFindDupDrops}
                title="Find duplicate drops"
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  padding: 6, borderRadius: 6, color: "var(--muted)",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#facc15"; e.currentTarget.style.background = "rgba(250,204,21,0.1)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--muted)"; e.currentTarget.style.background = "none"; }}
              >
                <SearchCode size={13} />
              </button>
              <button
                onClick={() => setShowImport(true)}
                title="Import drops"
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  padding: 6, borderRadius: 6, color: "var(--muted)",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#c084fc"; e.currentTarget.style.background = "rgba(192,132,252,0.1)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--muted)"; e.currentTarget.style.background = "none"; }}
              >
                <Import size={13} />
              </button>
              <button
                onClick={() => { setAddingDrop(true); setEditingDrop(null); }}
                title="Add drop"
                style={{
                  background: "none", border: "none", cursor: "pointer",
                  padding: 6, borderRadius: 6, color: "var(--muted)",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.color = "#4ade80"; e.currentTarget.style.background = "rgba(74,222,128,0.1)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.color = "var(--muted)"; e.currentTarget.style.background = "none"; }}
              >
                <Plus size={13} />
              </button>
            </div>
          </div>

          {addingDrop && (
            <DropForm onSave={handleAddDrop} onCancel={() => setAddingDrop(false)} />
          )}

          <div style={{ display: "flex", flexDirection: "column", gap: 8, maxHeight: 288, overflowY: "auto", paddingRight: 4 }}>
            {drops.length === 0 && !addingDrop && (
              <div style={{ textAlign: "center", padding: "24px 0", color: "var(--muted)", fontSize: 12 }}>
                <MapPin size={24} style={{ margin: "0 auto 8px", opacity: 0.3, display: "block" }} />
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
                    <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
                          {drop.is_primary && <Star size={11} style={{ color: "#4ade80", fill: "#4ade80", flexShrink: 0 }} />}
                          <span style={{ fontSize: 12, fontWeight: 500, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {drop.recipient_name}
                          </span>
                        </div>
                        <p style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.5, margin: 0 }}>
                          {drop.address}, {drop.city}{drop.state ? `, ${drop.state}` : ""} {drop.zip}, {drop.country}
                        </p>
                        {drop.phone && <p style={{ fontSize: 11, color: "var(--muted)", marginTop: 2, marginBottom: 0 }}>{drop.phone}</p>}
                      </div>
                      <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                        {!drop.is_primary && (
                          <button
                            onClick={() => handleSetPrimary(drop)}
                            title="Set primary"
                            style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "var(--muted)" }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = "#4ade80"; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = "var(--muted)"; }}
                          >
                            <StarOff size={12} />
                          </button>
                        )}
                        <button
                          onClick={() => setEditingDrop(drop)}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "var(--muted)" }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = "#60a5fa"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--muted)"; }}
                        >
                          <Edit2 size={12} />
                        </button>
                        <button
                          onClick={() => handleDeleteDrop(drop)}
                          style={{ background: "none", border: "none", cursor: "pointer", padding: 4, color: "var(--muted)" }}
                          onMouseEnter={(e) => { e.currentTarget.style.color = "#f87171"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.color = "var(--muted)"; }}
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
        <div style={{ padding: 20 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Package size={14} style={{ color: "#c084fc" }} />
              <span style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "var(--muted)" }}>Recent Orders</span>
            </div>
            <button className="btn btn-ghost btn-sm" style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <ShoppingCart size={12} /> New Order
            </button>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 0, maxHeight: 288, overflowY: "auto", paddingRight: 4 }}>
            {orders.length === 0 && (
              <div style={{ textAlign: "center", padding: "24px 0", color: "var(--muted)", fontSize: 12 }}>
                <Package size={24} style={{ margin: "0 auto 8px", opacity: 0.3, display: "block" }} />
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
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
                    <span className={`st ${ORDER_STATUS_CSS[o.status] ?? "st-archive"}`}>
                      {o.status}
                    </span>
                    <span style={{ fontSize: 12, color: "var(--text)" }}>{o.shop_name || "—"}</span>
                  </div>
                  {o.tracking_number && (
                    <p style={{ fontSize: 10, fontFamily: "'JetBrains Mono',monospace", color: "var(--muted)", margin: 0 }}>{o.tracking_number}</p>
                  )}
                </div>
                <div style={{ textAlign: "right" }}>
                  {o.total_amount != null && (
                    <p style={{ fontSize: 12, color: "var(--text)", margin: 0 }}>${o.total_amount.toFixed(2)}</p>
                  )}
                  <p style={{ fontSize: 10, color: "var(--muted)", margin: 0 }}>{o.created_at?.slice(0, 10)}</p>
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
function CreateProfileModal({ onCreated, onClose }) {
  const [cardId, setCardId] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleCreate = async () => {
    const id = parseInt(cardId, 10);
    if (!id) { toast("Enter a valid card ID", "warn"); return; }
    setLoading(true);
    try {
      const p = await invoke("create_profile", { cardId: id, notes });
      toast("Profile created", "success");
      onCreated(p);
      onClose();
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 400 }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 24px", borderBottom: "1px solid var(--border)",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <User size={16} style={{ color: "#60a5fa" }} />
            <span className="modal-title" style={{ margin: 0 }}>New Profile</span>
          </div>
          <button className="modal-close" onClick={onClose}><X size={18} /></button>
        </div>
        <div style={{ padding: 24, display: "flex", flexDirection: "column", gap: 16 }}>
          <div className="form-group">
            <label className="form-label">Card ID *</label>
            <input
              type="number"
              value={cardId}
              onChange={(e) => setCardId(e.target.value)}
              placeholder="Card database ID (must be 'free')"
              className="form-input"
            />
          </div>
          <div className="form-group">
            <label className="form-label">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Optional notes…"
              className="form-input"
              style={{ resize: "none" }}
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={loading || !cardId}
            className="btn btn-b"
            style={{ width: "100%", opacity: (loading || !cardId) ? 0.4 : 1 }}
          >
            {loading ? "Creating…" : "Create Profile"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Pagination helper ────────────────────────────────────────
function buildPageNumbers(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages = [1];
  if (current > 3) pages.push("…");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) pages.push(p);
  if (current < total - 2) pages.push("…");
  pages.push(total);
  return pages;
}

// ─── Main ProfileList ─────────────────────────────────────────
export default function ProfileList({ onNavigate, activeTab = "list", openCreate: initOpenCreate = false }) {
  const [profiles, setProfiles] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState({ has_drop: null, search: "", card_status: null });
  const [expanded, setExpanded] = useState(null);
  const [hoveredProfile, setHoveredProfile] = useState(null);
  const hoverTimer = useRef(null);
  const [showCreate, setShowCreate] = useState(initOpenCreate);
  const [showDupProfiles, setShowDupProfiles] = useState(false);
  const [dupProfileGroups, setDupProfileGroups] = useState([]);
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const PER_PAGE = 50;

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

  useEffect(() => { load(); }, []);

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

  const handleFilterDrop = (v) => {
    const f = { ...filter, has_drop: v };
    setFilter(f);
    setPage(1);
    load(1, f);
  };

  const handleSearch = (e) => {
    if (e.key === "Enter") {
      setPage(1);
      load(1, filter);
    }
  };

  const handleDelete = async (profile) => {
    const ok = await confirm(`Delete profile ${shortId(profile.id)}? This will free the card and delete all associated drops and orders.`, { danger: true });
    if (!ok) return;
    try {
      await invoke("delete_profile", { id: profile.id });
      toast("Profile deleted", "success");
      load();
    } catch (e) {
      if (e.includes?.("active_orders")) {
        const count = e.split(":")[1];
        toast(`Cannot delete: ${count} active order(s)`, "error");
      } else {
        toast(String(e), "error");
      }
    }
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

  // Copy helpers
  const copyProfile = (p) => {
    const lines = [
      `Card: [${p.bin || "?"}••••••••${p.last4 || "?"}] | [exp] | [cvv] | ${p.holder_masked || "—"}`,
      `Bank: ${p.bank_name || "—"} · ${p.country || "—"}`,
    ];
    copyText(lines.join("\n"));
    toast("Profile copied", "success");
  };

  const copyCard = (p) => {
    copyText(`[card_num]|[exp]|[cvv]|${p.holder_masked || ""}|[email]|[phone]|[address]|[city]|[state]|${p.country || ""}|[zip]`);
    toast("Card format copied", "success");
  };

  const totalPages = Math.ceil(total / PER_PAGE);

  return (
    <div className="content">
      {/* Header */}
      <div className="ph">
        <div><div className="ph-title">👤 Profiles</div></div>
        <div className="ph-actions">
          <button className="btn btn-g" onClick={() => setShowCreate(true)}>+ Create Profile</button>
          <button className="btn btn-ghost btn-sm" onClick={handleFindDupProfiles}>Find Duplicates</button>
        </div>
      </div>

      {/* Filters */}
      <div className="filters">
        <button
          className={`flt${filter.card_status === null && filter.has_drop === null ? " active" : ""}`}
          onClick={() => { const f = { ...filter, card_status: null, has_drop: null }; setFilter(f); setPage(1); load(1, f); }}
        >All</button>
        <button
          className={`flt${filter.card_status === "active" ? " active" : ""}`}
          onClick={() => { const f = { ...filter, card_status: "active" }; setFilter(f); setPage(1); load(1, f); }}
        >Active</button>
        <button
          className={`flt${filter.card_status === "dead" ? " active" : ""}`}
          onClick={() => { const f = { ...filter, card_status: "dead" }; setFilter(f); setPage(1); load(1, f); }}
        >Dead</button>
        <button
          className={`flt${filter.card_status === "archive" ? " active" : ""}`}
          onClick={() => { const f = { ...filter, card_status: "archive" }; setFilter(f); setPage(1); load(1, f); }}
        >Archive</button>
        <button
          className={`flt${filter.has_drop === false ? " active" : ""}`}
          onClick={() => { const f = { ...filter, has_drop: false, card_status: null }; setFilter(f); setPage(1); load(1, f); }}
        >⚠️ No Drop</button>
        <input
          className="search-box"
          placeholder="🔍  last4, BIN, holder..."
          value={filter.search}
          onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
          onKeyDown={handleSearch}
        />
      </div>

      {/* Table */}
      <div className="panel" style={{ padding: 0, overflowX: "auto" }}>
        <table className="tbl">
          <thead>
            <tr>
              <th></th>
              <th>Профиль</th>
              <th>Карта</th>
              <th>Тип</th>
              <th>Банк</th>
              <th>Страна</th>
              <th>Статус</th>
              <th>Дропов</th>
              <th>Заказов</th>
              <th>Notes</th>
              <th>Создан</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading && profiles.length === 0 && (
              <SkeletonRows count={6} cols={12} />
            )}
            {profiles.length === 0 && !loading && (
              <tr>
                <td colSpan={12} style={{ textAlign: "center", padding: "48px 0", color: "var(--muted)" }}>
                  No profiles found
                </td>
              </tr>
            )}
            {!loading && profiles.map((p) => {
              const hasDrops = p.drop_count > 0;
              const isExpanded = expanded === p.id;
              const cardStatus = p.card_status || (hasDrops ? "active" : "free");
              return (
                <>
                  <tr
                    key={p.id}
                    style={{ cursor: "pointer" }}
                    onClick={() => setExpanded(isExpanded ? null : p.id)}
                    onMouseEnter={(e) => {
                      const rect = e.currentTarget.getBoundingClientRect();
                      hoverTimer.current = setTimeout(() => setHoveredProfile({ p, rect }), 400);
                    }}
                    onMouseLeave={() => { clearTimeout(hoverTimer.current); setHoveredProfile(null); }}
                  >
                    <td style={{ color: "var(--muted)", fontSize: 12 }}>{isExpanded ? "▾" : "▸"}</td>
                    <td>
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: "var(--muted)" }}>{shortId(p.id)}</span>
                      {p.holder_masked && <div style={{ fontSize: 12 }}>{p.holder_masked}</div>}
                    </td>
                    <td>
                      <span style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 11 }}>
                        {p.bin ? p.bin.slice(0,4) : "••••"}••••{p.last4 || "????"}
                      </span>
                    </td>
                    <td style={{ fontSize: 11, color: "var(--text-2)" }}>{p.card_type || "—"}</td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{p.bank_name || "—"}</td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{p.country || "—"}</td>
                    <td><span className={`st st-${cardStatus}`}>{cardStatus}</span></td>
                    <td style={{ fontSize: 12, color: hasDrops ? "#4ade80" : "#eab308", fontWeight: 500 }}>{p.drop_count}</td>
                    <td style={{ fontSize: 12, color: "var(--muted)" }}>{p.order_count}</td>
                    <td style={{ fontSize: 11, color: "var(--muted)", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={p.notes ?? ""}>{p.notes || "—"}</td>
                    <td style={{ fontSize: 11, color: "var(--muted)", whiteSpace: "nowrap" }}>{p.created_at?.slice(0,10)}</td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="tbl-actions">
                        <button className="btn btn-ghost btn-sm" title="Copy profile" onClick={() => copyProfile(p)}>Copy</button>
                        <button className="btn btn-ghost btn-sm" title="Float window" onClick={() => invoke("open_float_window", { profileId: p.id }).catch(() => {})}>Float</button>
                        <button className="btn btn-ghost btn-sm" title="Duplicate" onClick={() => handleDuplicate(p)}>Dup</button>
                        <button className="btn btn-r btn-sm" title="Delete" onClick={() => handleDelete(p)}>Del</button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${p.id}-detail`}>
                      <td colSpan={12} style={{ padding: 0 }}>
                        <ProfileDetailPanel profileId={p.id} onRefresh={load} />
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
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 12 }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>{total} profiles</span>
          <div style={{ display: "flex", gap: 4 }}>
            {buildPageNumbers(page, totalPages).map((p, idx) =>
              p === "…" ? (
                <span key={`ellipsis-${idx}`} style={{ padding: "4px 8px", fontSize: 12, color: "var(--muted)" }}>…</span>
              ) : (
                <button
                  key={p}
                  onClick={() => { setPage(p); load(p, filter); }}
                  className={`btn btn-ghost btn-sm${page === p ? " active" : ""}`}
                  style={page === p ? { background: "var(--accent)", color: "#fff", borderColor: "var(--accent)" } : {}}
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
        <CreateProfileModal
          onCreated={() => load()}
          onClose={() => setShowCreate(false)}
        />
      )}
      {showDupProfiles && (
        <DuplicateProfilesModal groups={dupProfileGroups} onClose={() => setShowDupProfiles(false)} />
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
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <span style={{ fontFamily: "'JetBrains Mono',monospace", color: "var(--text)", fontSize: 13, fontWeight: 500 }}>
                ••••-{p.last4 || "????"}
              </span>
              <span style={{
                fontSize: 10, padding: "1px 6px", borderRadius: 4,
                background: p.drop_count > 0 ? "rgba(34,197,94,0.12)" : "rgba(234,179,8,0.12)",
                border: `1px solid ${p.drop_count > 0 ? "rgba(34,197,94,0.25)" : "rgba(234,179,8,0.25)"}`,
                color: p.drop_count > 0 ? "#22c55e" : "#eab308",
              }}>
                {p.drop_count > 0 ? "Ready" : "No Drop"}
              </span>
            </div>
            {p.holder_masked && <div style={{ color: "var(--muted)", fontSize: 12, marginBottom: 4 }}>{p.holder_masked}</div>}
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              {p.bin && <span style={{ color: "var(--muted)", fontSize: 11, fontFamily: "'JetBrains Mono',monospace" }}>BIN {p.bin}</span>}
              {p.bank_name && <span style={{ color: "var(--muted)", fontSize: 11 }}>· {p.bank_name}</span>}
            </div>
            {p.drop_count !== undefined && (
              <div style={{ marginTop: 5, color: "var(--muted)", fontSize: 11 }}>
                {p.drop_count} drop{p.drop_count !== 1 ? "s" : ""}
              </div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
