import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  User, CreditCard, MapPin, Plus, Copy, Trash2, Star, StarOff,
  ChevronDown, ChevronRight, Search, RefreshCw, AlertTriangle,
  Package, ExternalLink, Layers, Import, CheckCircle2, XCircle,
  Edit2, Check, X, Filter, MoreHorizontal, Maximize2, ClipboardCopy,
  ShoppingCart, ScanSearch
} from "lucide-react";
import { useLang } from "../hooks/useLang";
import { useToast } from "../hooks/useToast";
import { useConfirm } from "../hooks/useConfirm";

// ─── helpers ─────────────────────────────────────────────────
const STATUS_COLORS = {
  active: "text-green-400",
  free: "text-green-400",
  in_use: "text-blue-400",
  dead: "text-red-400",
  blocked: "text-red-400",
};

const ORDER_STATUS_COLOR = {
  pending: "bg-yellow-500/20 text-yellow-300",
  processing: "bg-blue-500/20 text-blue-300",
  shipped: "bg-purple-500/20 text-purple-300",
  delivered: "bg-green-500/20 text-green-300",
  cancelled: "bg-gray-500/20 text-gray-400",
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

// ─── FloatWindow stub ─────────────────────────────────────────
function FloatWindowStub({ profile, onClose }) {
  return (
    <div className="fixed bottom-6 right-6 w-72 bg-[#1a1d27] border border-[#2a2d3a] rounded-xl shadow-2xl z-50 overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#2a2d3a] bg-[#141720]">
        <div className="flex items-center gap-2 text-sm font-medium text-gray-200">
          <Maximize2 size={14} className="text-purple-400" />
          Float · {shortId(profile.id)}
        </div>
        <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
          <X size={14} />
        </button>
      </div>
      <div className="p-4 text-xs text-gray-400 space-y-1">
        <p className="text-gray-500 italic">Float Window — coming in M04</p>
        <p className="font-mono text-blue-400">{maskedCard(profile.last4, profile.bin)}</p>
        {profile.holder_masked && <p className="text-gray-300">{profile.holder_masked}</p>}
      </div>
    </div>
  );
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
    <div className="bg-[#0f1117] rounded-lg border border-[#2a2d3a] p-4 mt-2">
      <div className="grid grid-cols-2 gap-3">
        {fields.map(([key, label, span]) => (
          <div key={key} className={span === 2 ? "col-span-2" : ""}>
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">{label}</label>
            <input
              value={form[key]}
              onChange={set(key)}
              className="w-full bg-[#1a1d27] border border-[#2a2d3a] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500/50 transition-colors"
            />
          </div>
        ))}
      </div>
      <div className="flex justify-end gap-2 mt-3">
        <button onClick={onCancel} className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 transition-colors">
          Cancel
        </button>
        <button
          onClick={() => valid && onSave(form)}
          disabled={!valid}
          className="px-4 py-1.5 text-xs rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
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
      // remap to drop columns
      const remapped = cols.map((c) =>
        DROP_COLUMNS.includes(c) ? c : "skip"
      );
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-2xl w-[680px] max-h-[80vh] overflow-hidden shadow-2xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a]">
          <div className="flex items-center gap-3">
            <Import size={18} className="text-purple-400" />
            <span className="font-semibold text-gray-100">Import Drops</span>
          </div>
          <div className="flex gap-2">
            {[1, 2, 3].map((s) => (
              <div key={s} className={`w-6 h-1.5 rounded-full transition-colors ${step >= s ? "bg-purple-500" : "bg-[#2a2d3a]"}`} />
            ))}
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {step === 1 && (
            <div className="space-y-4">
              <p className="text-sm text-gray-400">Paste raw drop data below. Supported delimiters: <code className="text-blue-400 text-xs">| , ; TAB</code></p>
              <textarea
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                rows={12}
                placeholder="John Doe | 123 Main St | New York | NY | 10001 | US | +1-555-0100"
                className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-3 text-sm text-gray-200 font-mono focus:outline-none focus:border-purple-500/50 resize-none"
              />
              <button
                onClick={handlePreview}
                disabled={!raw.trim() || loading}
                className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
              >
                {loading ? "Detecting…" : "Detect Columns →"}
              </button>
            </div>
          )}

          {step === 2 && preview && (
            <div className="space-y-4">
              <p className="text-sm text-gray-400">Map columns to drop fields. First row shown as example.</p>
              <div className="overflow-x-auto rounded-xl border border-[#2a2d3a]">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-[#0f1117]">
                      {mapping.map((_, i) => (
                        <th key={i} className="px-3 py-2 text-left">
                          <select
                            value={mapping[i]}
                            onChange={(e) => {
                              const m = [...mapping];
                              m[i] = e.target.value;
                              setMapping(m);
                            }}
                            className="bg-[#1a1d27] border border-[#2a2d3a] rounded-lg px-2 py-1 text-gray-300 text-xs focus:outline-none w-full"
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
                      <tr key={ri} className="border-t border-[#2a2d3a] hover:bg-[#1a1d27]/50">
                        {row.map((cell, ci) => (
                          <td key={ci} className={`px-3 py-2 font-mono ${mapping[ci] === "skip" ? "text-gray-600" : "text-gray-300"}`}>
                            {cell || <span className="text-gray-600">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setStep(1)} className="px-4 py-2 text-sm text-gray-400 hover:text-gray-200 transition-colors">
                  ← Back
                </button>
                <button
                  onClick={handleImport}
                  disabled={loading}
                  className="flex-1 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
                >
                  {loading ? "Importing…" : `Import ${preview.preview_rows.length} Rows →`}
                </button>
              </div>
            </div>
          )}

          {step === 3 && result && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="bg-green-500/10 border border-green-500/20 rounded-xl p-4 text-center">
                  <div className="text-3xl font-bold text-green-400">{result.parsed}</div>
                  <div className="text-xs text-gray-400 mt-1">Imported</div>
                </div>
                <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl p-4 text-center">
                  <div className="text-3xl font-bold text-yellow-400">{result.skipped}</div>
                  <div className="text-xs text-gray-400 mt-1">Skipped</div>
                </div>
              </div>
              {result.errors?.length > 0 && (
                <div className="bg-[#0f1117] rounded-xl border border-[#2a2d3a] p-3 max-h-40 overflow-y-auto">
                  {result.errors.map((e, i) => (
                    <div key={i} className="text-xs text-red-400 font-mono py-0.5">{e}</div>
                  ))}
                </div>
              )}
              <button
                onClick={() => { onDone(); onClose(); }}
                className="w-full py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-medium transition-colors"
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-2xl w-[620px] max-h-[75vh] overflow-hidden shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a]">
          <div className="flex items-center gap-2">
            <ScanSearch size={18} className="text-yellow-400" />
            <span className="font-semibold text-gray-100">Duplicate Drops</span>
            <span className="ml-2 text-xs bg-yellow-500/20 text-yellow-300 px-2 py-0.5 rounded-full">{groups.length} groups</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-6 space-y-4">
          {groups.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <CheckCircle2 size={40} className="mx-auto mb-3 text-green-500/40" />
              <p>No duplicate addresses found</p>
            </div>
          ) : groups.map((group, gi) => (
            <div key={gi} className="border border-yellow-500/20 rounded-xl overflow-hidden">
              <div className="bg-yellow-500/5 px-4 py-2 text-xs text-yellow-400 font-medium border-b border-yellow-500/20">
                {group[0].address}, {group[0].city}, {group[0].country} — {group.length} duplicates
              </div>
              {group.map((d) => (
                <div key={d.id} className="px-4 py-2 flex items-center justify-between border-t border-[#2a2d3a] first:border-0">
                  <div>
                    <span className="text-sm text-gray-200">{d.recipient_name}</span>
                    <span className="text-xs text-gray-500 ml-2">profile: {shortId(d.profile_id)}</span>
                  </div>
                  <span className="text-xs font-mono text-gray-500">{d.phone || "—"}</span>
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-2xl w-[620px] max-h-[75vh] overflow-hidden shadow-2xl flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a]">
          <div className="flex items-center gap-2">
            <Layers size={18} className="text-orange-400" />
            <span className="font-semibold text-gray-100">Duplicate Profiles</span>
            <span className="ml-2 text-xs bg-orange-500/20 text-orange-300 px-2 py-0.5 rounded-full">{groups.length} groups</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors"><X size={18} /></button>
        </div>
        <div className="overflow-y-auto p-6 space-y-4">
          {groups.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <CheckCircle2 size={40} className="mx-auto mb-3 text-green-500/40" />
              <p>No duplicate profiles found</p>
            </div>
          ) : groups.map((group, gi) => (
            <div key={gi} className="border border-orange-500/20 rounded-xl overflow-hidden">
              <div className="bg-orange-500/5 px-4 py-2 text-xs text-orange-400 font-medium border-b border-orange-500/20">
                Card {group[0].bin}••••{group[0].last4} — {group.length} profiles
              </div>
              {group.map((p) => (
                <div key={p.id} className="px-4 py-2 flex items-center justify-between border-t border-[#2a2d3a] first:border-0">
                  <span className="text-xs font-mono text-gray-300">{shortId(p.id)}</span>
                  <span className="text-xs text-gray-500">{p.drop_count} drops · {p.order_count} orders</span>
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
      <div className="flex items-center justify-center py-12">
        <div className="w-6 h-6 border-2 border-blue-500/40 border-t-blue-500 rounded-full animate-spin" />
      </div>
    );
  }
  if (!detail) return null;

  const { card, drops, orders } = detail;
  const primaryDrop = drops.find((d) => d.is_primary);

  return (
    <div className="border-t border-[#2a2d3a] bg-[#0f1117]/60">
      <div className="grid grid-cols-12 gap-0 divide-x divide-[#2a2d3a]">
        {/* ── Card info ── */}
        <div className="col-span-4 p-5 space-y-4">
          <div className="flex items-center gap-2 mb-3">
            <CreditCard size={14} className="text-blue-400" />
            <span className="text-xs uppercase tracking-widest text-gray-500">Card</span>
          </div>
          <div className="space-y-2">
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
              <div key={label} className="flex items-center justify-between">
                <span className="text-[11px] text-gray-500">{label}</span>
                <span className={`text-xs font-mono ${label === "Status" ? STATUS_COLORS[card.status] || "text-gray-400" : "text-gray-300"}`}>
                  {val}
                </span>
              </div>
            ))}
          </div>
          {/* Notes */}
          <div className="pt-3 border-t border-[#2a2d3a]">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] text-gray-500">Notes</span>
              {!editNotes && (
                <button onClick={() => setEditNotes(true)} className="text-gray-600 hover:text-gray-300 transition-colors">
                  <Edit2 size={12} />
                </button>
              )}
            </div>
            {editNotes ? (
              <div className="space-y-2">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  className="w-full bg-[#1a1d27] border border-[#2a2d3a] rounded-lg px-3 py-2 text-xs text-gray-200 focus:outline-none focus:border-blue-500/50 resize-none"
                />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setEditNotes(false)} className="text-xs text-gray-500 hover:text-gray-300 transition-colors">Cancel</button>
                  <button onClick={saveNotes} className="text-xs text-blue-400 hover:text-blue-300 transition-colors">Save</button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">{notes || "No notes"}</p>
            )}
          </div>
        </div>

        {/* ── Drops ── */}
        <div className="col-span-4 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <MapPin size={14} className="text-green-400" />
              <span className="text-xs uppercase tracking-widest text-gray-500">Shipping Addresses</span>
            </div>
            <div className="flex gap-1">
              <button
                onClick={handleFindDupDrops}
                title="Find duplicate drops"
                className="p-1.5 text-gray-600 hover:text-yellow-400 rounded-lg hover:bg-yellow-400/10 transition-colors"
              >
                <ScanSearch size={13} />
              </button>
              <button
                onClick={() => setShowImport(true)}
                title="Import drops"
                className="p-1.5 text-gray-600 hover:text-purple-400 rounded-lg hover:bg-purple-400/10 transition-colors"
              >
                <Import size={13} />
              </button>
              <button
                onClick={() => { setAddingDrop(true); setEditingDrop(null); }}
                title="Add drop"
                className="p-1.5 text-gray-600 hover:text-green-400 rounded-lg hover:bg-green-400/10 transition-colors"
              >
                <Plus size={13} />
              </button>
            </div>
          </div>

          {addingDrop && (
            <DropForm onSave={handleAddDrop} onCancel={() => setAddingDrop(false)} />
          )}

          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {drops.length === 0 && !addingDrop && (
              <div className="text-center py-6 text-gray-600 text-xs">
                <MapPin size={24} className="mx-auto mb-2 opacity-30" />
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
                  <div className={`rounded-xl p-3 border transition-colors ${drop.is_primary ? "border-green-500/30 bg-green-500/5" : "border-[#2a2d3a] bg-[#1a1d27]/50"}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5 mb-1">
                          {drop.is_primary && <Star size={11} className="text-green-400 fill-green-400 flex-shrink-0" />}
                          <span className="text-xs font-medium text-gray-200 truncate">{drop.recipient_name}</span>
                        </div>
                        <p className="text-[11px] text-gray-400 leading-relaxed">
                          {drop.address}, {drop.city}{drop.state ? `, ${drop.state}` : ""} {drop.zip}, {drop.country}
                        </p>
                        {drop.phone && <p className="text-[11px] text-gray-500 mt-0.5">{drop.phone}</p>}
                      </div>
                      <div className="flex gap-1 flex-shrink-0">
                        {!drop.is_primary && (
                          <button onClick={() => handleSetPrimary(drop)} title="Set primary" className="p-1 text-gray-600 hover:text-green-400 transition-colors">
                            <StarOff size={12} />
                          </button>
                        )}
                        <button onClick={() => setEditingDrop(drop)} className="p-1 text-gray-600 hover:text-blue-400 transition-colors">
                          <Edit2 size={12} />
                        </button>
                        <button onClick={() => handleDeleteDrop(drop)} className="p-1 text-gray-600 hover:text-red-400 transition-colors">
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
        <div className="col-span-4 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Package size={14} className="text-purple-400" />
              <span className="text-xs uppercase tracking-widest text-gray-500">Recent Orders</span>
            </div>
            <button className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300 transition-colors">
              <ShoppingCart size={12} /> New Order
            </button>
          </div>
          <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
            {orders.length === 0 && (
              <div className="text-center py-6 text-gray-600 text-xs">
                <Package size={24} className="mx-auto mb-2 opacity-30" />
                No orders yet
              </div>
            )}
            {orders.map((o) => (
              <div key={o.id} className="flex items-center justify-between py-2 border-b border-[#2a2d3a] last:border-0">
                <div>
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${ORDER_STATUS_COLOR[o.status] || "bg-gray-500/20 text-gray-400"}`}>
                      {o.status}
                    </span>
                    <span className="text-xs text-gray-300">{o.shop_name || "—"}</span>
                  </div>
                  {o.tracking_number && (
                    <p className="text-[10px] font-mono text-gray-500">{o.tracking_number}</p>
                  )}
                </div>
                <div className="text-right">
                  {o.total_amount != null && (
                    <p className="text-xs text-gray-300">${o.total_amount.toFixed(2)}</p>
                  )}
                  <p className="text-[10px] text-gray-600">{o.created_at?.slice(0, 10)}</p>
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
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-2xl w-96 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a]">
          <div className="flex items-center gap-2">
            <User size={16} className="text-blue-400" />
            <span className="font-semibold text-gray-100">New Profile</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">Card ID *</label>
            <input
              type="number"
              value={cardId}
              onChange={(e) => setCardId(e.target.value)}
              placeholder="Card database ID (must be 'free')"
              className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500/50 transition-colors"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Optional notes…"
              className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 focus:outline-none focus:border-blue-500/50 resize-none transition-colors"
            />
          </div>
          <button
            onClick={handleCreate}
            disabled={loading || !cardId}
            className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
          >
            {loading ? "Creating…" : "Create Profile"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main ProfileList ─────────────────────────────────────────
export default function ProfileList() {
  const [profiles, setProfiles] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState({ has_drop: null, search: "" });
  const [expanded, setExpanded] = useState(null);
  const [showCreate, setShowCreate] = useState(false);
  const [showDupProfiles, setShowDupProfiles] = useState(false);
  const [dupProfileGroups, setDupProfileGroups] = useState([]);
  const [floatProfile, setFloatProfile] = useState(null);
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const PER_PAGE = 50;

  const load = useCallback(async (p = page, f = filter) => {
    setLoading(true);
    try {
      const result = await invoke("get_profiles", {
        filter: { has_drop: f.has_drop, search: f.search || null },
        page: p,
        perPage: PER_PAGE,
      });
      setProfiles(result.items);
      setTotal(result.total);
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  }, [page, filter]);

  useEffect(() => { load(); }, []);

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
    <div className="flex flex-col h-full">
      {/* ── Header ── */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a]">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-gray-100">Profiles</h1>
          <span className="text-xs bg-[#2a2d3a] text-gray-400 px-2 py-0.5 rounded-full">{total}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleFindDupProfiles}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-400 hover:text-yellow-400 border border-[#2a2d3a] hover:border-yellow-500/30 rounded-lg transition-colors"
          >
            <Layers size={13} /> Find Duplicates
          </button>
          <button
            onClick={() => load()}
            className="p-1.5 text-gray-500 hover:text-gray-300 rounded-lg border border-[#2a2d3a] hover:border-[#3a3d4a] transition-colors"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
          >
            <Plus size={14} /> New Profile
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-[#2a2d3a] bg-[#0f1117]/40">
        <div className="flex rounded-lg overflow-hidden border border-[#2a2d3a]">
          {[
            [null, "All"],
            [false, "No Drop"],
            [true, "Has Drop"],
          ].map(([val, label]) => (
            <button
              key={String(val)}
              onClick={() => handleFilterDrop(val)}
              className={`px-3 py-1.5 text-xs transition-colors ${filter.has_drop === val ? "bg-blue-600 text-white" : "text-gray-400 hover:text-gray-200 hover:bg-[#2a2d3a]"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex-1 relative max-w-xs">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            value={filter.search}
            onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
            onKeyDown={handleSearch}
            placeholder="Search last4, BIN… (Enter)"
            className="w-full bg-[#1a1d27] border border-[#2a2d3a] rounded-lg pl-8 pr-4 py-1.5 text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
          />
        </div>
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#0f1117] z-10">
            <tr className="border-b border-[#2a2d3a]">
              <th className="w-8" />
              {["Profile ID", "Holder", "Card", "Bank", "Country", "Drops", "Orders", "Status", "Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[11px] uppercase tracking-widest text-gray-500 font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {profiles.length === 0 && !loading && (
              <tr>
                <td colSpan={10} className="text-center py-20 text-gray-600">
                  <User size={36} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No profiles found</p>
                </td>
              </tr>
            )}
            {profiles.map((p) => {
              const hasDrops = p.drop_count > 0;
              const isExpanded = expanded === p.id;
              return (
                <>
                  <tr
                    key={p.id}
                    className={`border-b transition-colors cursor-pointer group ${
                      !hasDrops
                        ? "border-yellow-500/10 bg-yellow-500/5 hover:bg-yellow-500/10"
                        : "border-[#2a2d3a] hover:bg-[#1a1d27]"
                    } ${isExpanded ? "bg-[#1a1d27]" : ""}`}
                    onClick={() => setExpanded(isExpanded ? null : p.id)}
                  >
                    <td className="pl-4 py-3">
                      <span className={`transition-transform inline-block text-gray-600 ${isExpanded ? "rotate-90" : ""}`}>
                        <ChevronRight size={14} />
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-gray-400">{shortId(p.id)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-gray-200 text-xs">{p.holder_masked || "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="font-mono text-xs text-gray-300">{maskedCard(p.last4, p.bin)}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-400">{p.bank_name || "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-400">{p.country || "—"}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium ${p.drop_count > 0 ? "text-green-400" : "text-yellow-400"}`}>
                        {p.drop_count}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs text-gray-400">{p.order_count}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${hasDrops ? "bg-green-400" : "bg-yellow-400"}`} />
                        <span className={`text-xs ${hasDrops ? "text-green-400" : "text-yellow-400"}`}>
                          {hasDrops ? "Ready" : "No Drop"}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button title="Copy profile" onClick={() => copyProfile(p)} className="p-1.5 text-gray-500 hover:text-gray-300 hover:bg-[#2a2d3a] rounded transition-colors">
                          <Copy size={12} />
                        </button>
                        <button title="Copy card" onClick={() => copyCard(p)} className="p-1.5 text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 rounded transition-colors">
                          <CreditCard size={12} />
                        </button>
                        <button title="Float window" onClick={() => setFloatProfile(p)} className="p-1.5 text-gray-500 hover:text-purple-400 hover:bg-purple-500/10 rounded transition-colors">
                          <Maximize2 size={12} />
                        </button>
                        <button title="Duplicate" onClick={() => handleDuplicate(p)} className="p-1.5 text-gray-500 hover:text-yellow-400 hover:bg-yellow-500/10 rounded transition-colors">
                          <Layers size={12} />
                        </button>
                        <button title="New order" className="p-1.5 text-gray-500 hover:text-green-400 hover:bg-green-500/10 rounded transition-colors">
                          <ShoppingCart size={12} />
                        </button>
                        <button title="Delete" onClick={() => handleDelete(p)} className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors">
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </td>
                  </tr>
                  {isExpanded && (
                    <tr key={`${p.id}-detail`}>
                      <td colSpan={10} className="p-0">
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

      {/* ── Pagination ── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-[#2a2d3a] bg-[#0f1117]/60">
          <span className="text-xs text-gray-500">{total} profiles</span>
          <div className="flex gap-1">
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => { setPage(p); load(p, filter); }}
                className={`w-8 h-8 text-xs rounded-lg transition-colors ${page === p ? "bg-blue-600 text-white" : "text-gray-500 hover:bg-[#2a2d3a] hover:text-gray-200"}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── Modals / Float ── */}
      {showCreate && (
        <CreateProfileModal
          onCreated={() => load()}
          onClose={() => setShowCreate(false)}
        />
      )}
      {showDupProfiles && (
        <DuplicateProfilesModal groups={dupProfileGroups} onClose={() => setShowDupProfiles(false)} />
      )}
      {floatProfile && (
        <FloatWindowStub profile={floatProfile} onClose={() => setFloatProfile(null)} />
      )}
    </div>
  );
}
