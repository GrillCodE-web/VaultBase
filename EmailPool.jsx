import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Mail, MailCheck, ShieldOff, Shield, Trash2, Edit2, Plus,
  RefreshCw, Search, X, Check, Filter, Store, Info
} from "lucide-react";
import { useLang } from "../hooks/useLang";
import { useToast } from "../hooks/useToast";
import { useConfirm } from "../hooks/useConfirm";

// ─── Status badge ─────────────────────────────────────────────
function StatusBadge({ entry }) {
  const shopCount = entry.shops_used?.length ?? 0;
  if (entry.is_blocked) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full bg-red-500/15 text-red-400 border border-red-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
        Blocked
      </span>
    );
  }
  if (shopCount > 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full bg-yellow-500/15 text-yellow-300 border border-yellow-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />
        Used in {shopCount}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full bg-green-500/15 text-green-400 border border-green-500/20">
      <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
      Clean
    </span>
  );
}

// ─── Shops tooltip ────────────────────────────────────────────
function ShopsTooltip({ shops }) {
  const [show, setShow] = useState(false);
  const ref = useRef(null);

  if (!shops?.length) return <span className="text-gray-600 text-xs">—</span>;

  return (
    <div className="relative inline-block" ref={ref}
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}>
      <span className="flex items-center gap-1 text-xs text-blue-400 cursor-default hover:text-blue-300 transition-colors">
        <Store size={11} />
        {shops.length} shop{shops.length !== 1 ? "s" : ""}
      </span>
      {show && (
        <div className="absolute left-0 top-full mt-1.5 z-30 min-w-[140px] bg-[#1a1d27] border border-[#2a2d3a] rounded-xl shadow-xl overflow-hidden">
          {shops.map((s) => (
            <div key={s.id} className="px-3 py-1.5 text-xs text-gray-300 hover:bg-[#2a2d3a] transition-colors whitespace-nowrap">
              {s.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Add / Edit modal ────────────────────────────────────────
function EmailModal({ initial, onSave, onClose }) {
  const [form, setForm] = useState(
    initial
      ? { email: initial.email, label: initial.label || "", notes: initial.notes || "" }
      : { email: "", label: "", notes: "" }
  );
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const isEdit = !!initial;

  const valid = form.email.includes("@");

  const handleSave = async () => {
    if (!valid) return;
    setLoading(true);
    try {
      await onSave(form);
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
            <Mail size={16} className="text-blue-400" />
            <span className="font-semibold text-gray-100">{isEdit ? "Edit Email" : "Add Email"}</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="p-6 space-y-4">
          {[
            ["Email *", "email", "email", "user@example.com"],
            ["Label", "text", "label", "Main account"],
            ["Notes", "text", "notes", "Optional notes…"],
          ].map(([label, type, key, placeholder]) => (
            <div key={key}>
              <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">{label}</label>
              {key === "notes" ? (
                <textarea
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  rows={2}
                  placeholder={placeholder}
                  disabled={isEdit && key === "email"}
                  className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 resize-none transition-colors disabled:opacity-50"
                />
              ) : (
                <input
                  type={type}
                  value={form[key]}
                  onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                  placeholder={placeholder}
                  disabled={isEdit && key === "email"}
                  onKeyDown={(e) => e.key === "Enter" && handleSave()}
                  className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors disabled:opacity-50"
                />
              )}
            </div>
          ))}
          <button
            onClick={handleSave}
            disabled={!valid || loading}
            className="w-full py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
          >
            {loading ? "Saving…" : isEdit ? "Save Changes" : "Add Email"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main EmailPool ───────────────────────────────────────────
export default function EmailPool() {
  const [emails, setEmails] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filterBlocked, setFilterBlocked] = useState(null); // null | true | false
  const [modal, setModal] = useState(null); // null | "add" | EmailPoolEntry
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const PER_PAGE = 50;

  const load = useCallback(async (p = page, fb = filterBlocked) => {
    setLoading(true);
    try {
      const r = await invoke("get_emails", {
        filter: { is_blocked: fb },
        page: p,
        perPage: PER_PAGE,
      });
      setEmails(r.items);
      setTotal(r.total);
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  }, [page, filterBlocked]);

  useEffect(() => { load(); }, []);

  const handleAdd = async (form) => {
    await invoke("add_email", { email: form.email, label: form.label, notes: form.notes });
    toast("Email added", "success");
    load();
  };

  const handleEdit = async (form) => {
    await invoke("update_email", { id: modal.id, label: form.label, notes: form.notes });
    toast("Email updated", "success");
    load();
  };

  const handleBlock = async (entry) => {
    try {
      await invoke("block_email", { id: entry.id, blocked: !entry.is_blocked });
      toast(entry.is_blocked ? "Email unblocked" : "Email blocked", "success");
      load();
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const handleDelete = async (entry) => {
    const ok = await confirm(`Delete ${entry.email}?`, { danger: true });
    if (!ok) return;
    try {
      await invoke("delete_email", { id: entry.id });
      toast("Email deleted", "success");
      load();
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const cleanCount = emails.filter((e) => !e.is_blocked && !e.shops_used?.length).length;
  const totalPages = Math.ceil(total / PER_PAGE);

  const applyFilter = (v) => {
    const f = v === filterBlocked ? null : v;
    setFilterBlocked(f);
    setPage(1);
    load(1, f);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a]">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-gray-100">Email Pool</h1>
          <span className="text-xs bg-green-500/15 text-green-400 border border-green-500/20 px-2 py-0.5 rounded-full">
            {cleanCount} clean
          </span>
          <span className="text-xs bg-[#2a2d3a] text-gray-400 px-2 py-0.5 rounded-full">
            {total} total
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => load()}
            className="p-1.5 text-gray-500 hover:text-gray-300 rounded-lg border border-[#2a2d3a] hover:border-[#3a3d4a] transition-colors"
          >
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
          <button
            onClick={() => setModal("add")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-blue-600 hover:bg-blue-500 rounded-lg transition-colors"
          >
            <Plus size={14} /> Add Email
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-[#2a2d3a] bg-[#0f1117]/40">
        <div className="flex rounded-lg overflow-hidden border border-[#2a2d3a]">
          {[
            [null, "All"],
            [false, "Clean"],
            [true, "Blocked"],
          ].map(([val, label]) => (
            <button
              key={String(val)}
              onClick={() => applyFilter(val)}
              className={`px-3 py-1.5 text-xs transition-colors ${
                filterBlocked === val ? "bg-blue-600 text-white" : "text-gray-400 hover:text-gray-200 hover:bg-[#2a2d3a]"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-[#0f1117] z-10">
            <tr className="border-b border-[#2a2d3a]">
              {["Email", "Label", "IMAP", "Used In", "Status", "Added", "Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[11px] uppercase tracking-widest text-gray-500 font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {emails.length === 0 && !loading && (
              <tr>
                <td colSpan={7} className="text-center py-20 text-gray-600">
                  <Mail size={36} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No emails in pool</p>
                </td>
              </tr>
            )}
            {emails.map((entry) => (
              <tr
                key={entry.id}
                className={`border-b border-[#2a2d3a] transition-colors group hover:bg-[#1a1d27] ${
                  entry.is_blocked ? "opacity-60" : ""
                }`}
              >
                <td className="px-4 py-3">
                  <span className="font-mono text-xs text-gray-200">{entry.email}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-gray-400">{entry.label || <span className="text-gray-600">—</span>}</span>
                </td>
                <td className="px-4 py-3">
                  {entry.imap_account_id ? (
                    <span title="IMAP linked" className="text-blue-400">
                      <MailCheck size={14} />
                    </span>
                  ) : (
                    <span className="text-gray-700"><Mail size={14} /></span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <ShopsTooltip shops={entry.shops_used} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge entry={entry} />
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-gray-600">{entry.created_at?.slice(0, 10)}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleBlock(entry)}
                      title={entry.is_blocked ? "Unblock" : "Block"}
                      className={`p-1.5 rounded transition-colors ${
                        entry.is_blocked
                          ? "text-gray-500 hover:text-green-400 hover:bg-green-500/10"
                          : "text-gray-500 hover:text-red-400 hover:bg-red-500/10"
                      }`}
                    >
                      {entry.is_blocked ? <Shield size={13} /> : <ShieldOff size={13} />}
                    </button>
                    <button
                      onClick={() => setModal(entry)}
                      title="Edit"
                      className="p-1.5 text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 rounded transition-colors"
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      onClick={() => handleDelete(entry)}
                      title="Delete"
                      className="p-1.5 text-gray-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-6 py-3 border-t border-[#2a2d3a] bg-[#0f1117]/60">
          <span className="text-xs text-gray-500">{total} emails</span>
          <div className="flex gap-1">
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => { setPage(p); load(p, filterBlocked); }}
                className={`w-8 h-8 text-xs rounded-lg transition-colors ${
                  page === p ? "bg-blue-600 text-white" : "text-gray-500 hover:bg-[#2a2d3a] hover:text-gray-200"
                }`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Modal */}
      {modal === "add" && (
        <EmailModal onSave={handleAdd} onClose={() => setModal(null)} />
      )}
      {modal && modal !== "add" && (
        <EmailModal initial={modal} onSave={handleEdit} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
