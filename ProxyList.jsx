import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Globe, ShieldOff, Shield, Trash2, Edit2, Plus,
  RefreshCw, X, Upload, Eye, EyeOff, Store, CheckCircle2
} from "lucide-react";
import { useLang } from "../hooks/useLang";
import { useToast } from "../hooks/useToast";
import { useConfirm } from "../hooks/useConfirm";

// ─── Helpers ──────────────────────────────────────────────────
const TYPE_COLORS = {
  http: "bg-blue-500/15 text-blue-400 border-blue-500/20",
  socks5: "bg-purple-500/15 text-purple-400 border-purple-500/20",
  socks4: "bg-indigo-500/15 text-indigo-400 border-indigo-500/20",
};

function TypeBadge({ type }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 text-[10px] font-mono rounded-full border ${TYPE_COLORS[type] || "bg-gray-500/15 text-gray-400 border-gray-500/20"}`}>
      {type?.toUpperCase()}
    </span>
  );
}

function StatusBadge({ proxy }) {
  const shopCount = proxy.shops_used?.length ?? 0;
  if (proxy.is_blocked) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full bg-red-500/15 text-red-400 border border-red-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-red-400" />Blocked
      </span>
    );
  }
  if (shopCount > 0) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full bg-yellow-500/15 text-yellow-300 border border-yellow-500/20">
        <span className="w-1.5 h-1.5 rounded-full bg-yellow-400" />Used in {shopCount}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full bg-green-500/15 text-green-400 border border-green-500/20">
      <span className="w-1.5 h-1.5 rounded-full bg-green-400" />Clean
    </span>
  );
}

function ShopsTooltip({ shops }) {
  const [show, setShow] = useState(false);
  if (!shops?.length) return <span className="text-gray-600 text-xs">—</span>;
  return (
    <div className="relative inline-block"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}>
      <span className="flex items-center gap-1 text-xs text-blue-400 cursor-default hover:text-blue-300 transition-colors">
        <Store size={11} />{shops.length} shop{shops.length !== 1 ? "s" : ""}
      </span>
      {show && (
        <div className="absolute left-0 top-full mt-1.5 z-30 min-w-[140px] bg-[#1a1d27] border border-[#2a2d3a] rounded-xl shadow-xl overflow-hidden">
          {shops.map((s) => (
            <div key={s.id} className="px-3 py-1.5 text-xs text-gray-300 hover:bg-[#2a2d3a] whitespace-nowrap transition-colors">
              {s.name}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Password field ───────────────────────────────────────────
function PasswordField({ value, onChange, placeholder = "Password" }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 pr-10 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors font-mono"
      />
      <button
        type="button"
        onClick={() => setShow((s) => !s)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
      >
        {show ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
    </div>
  );
}

// ─── ProxyForm modal ──────────────────────────────────────────
const EMPTY_PROXY = { host: "", port: "", proxy_type: "http", username: "", password: "", label: "", notes: "" };

function ProxyModal({ initial, onSave, onClose }) {
  const [form, setForm] = useState(initial
    ? { ...initial, port: String(initial.port), password: initial.password || "", username: initial.username || "", label: initial.label || "", notes: initial.notes || "" }
    : { ...EMPTY_PROXY }
  );
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  const isEdit = !!initial;

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const valid = form.host.trim() && form.port;

  const handleSave = async () => {
    if (!valid) return;
    setLoading(true);
    try {
      await onSave({ ...form, port: parseInt(form.port, 10) || 80 });
      onClose();
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-2xl w-[440px] shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a]">
          <div className="flex items-center gap-2">
            <Globe size={16} className="text-purple-400" />
            <span className="font-semibold text-gray-100">{isEdit ? "Edit Proxy" : "Add Proxy"}</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          {/* Host + Port */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">Host *</label>
              <input
                value={form.host}
                onChange={set("host")}
                placeholder="proxy.example.com"
                className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 font-mono transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">Port *</label>
              <input
                type="number"
                value={form.port}
                onChange={set("port")}
                placeholder="8080"
                className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 font-mono transition-colors"
              />
            </div>
          </div>

          {/* Type */}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">Type</label>
            <div className="flex rounded-lg overflow-hidden border border-[#2a2d3a]">
              {["http", "socks5", "socks4"].map((t) => (
                <button
                  key={t}
                  onClick={() => setForm((f) => ({ ...f, proxy_type: t }))}
                  className={`flex-1 py-2 text-xs font-mono transition-colors ${
                    form.proxy_type === t ? "bg-purple-600 text-white" : "text-gray-400 hover:text-gray-200 hover:bg-[#2a2d3a]"
                  }`}
                >
                  {t.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Auth */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">Username</label>
              <input
                value={form.username}
                onChange={set("username")}
                placeholder="user"
                className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 font-mono transition-colors"
              />
            </div>
            <div>
              <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">Password</label>
              <PasswordField value={form.password} onChange={set("password")} />
            </div>
          </div>

          {/* Label + Notes */}
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">Label</label>
            <input
              value={form.label}
              onChange={set("label")}
              placeholder="Residential US"
              className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 transition-colors"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">Notes</label>
            <textarea
              value={form.notes}
              onChange={set("notes")}
              rows={2}
              className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-2.5 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-blue-500/50 resize-none transition-colors"
            />
          </div>

          <button
            onClick={handleSave}
            disabled={!valid || loading}
            className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 disabled:cursor-not-allowed text-white text-sm font-medium transition-colors"
          >
            {loading ? "Saving…" : isEdit ? "Save Changes" : "Add Proxy"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Import modal ─────────────────────────────────────────────
function ImportModal({ onDone, onClose }) {
  const [raw, setRaw] = useState("");
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleImport = async () => {
    if (!raw.trim()) return;
    setLoading(true);
    try {
      const r = await invoke("import_proxies", { raw });
      setResult(r);
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-[#1a1d27] border border-[#2a2d3a] rounded-2xl w-[560px] shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a]">
          <div className="flex items-center gap-2">
            <Upload size={16} className="text-purple-400" />
            <span className="font-semibold text-gray-100">Import Proxies</span>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 transition-colors"><X size={18} /></button>
        </div>
        <div className="p-6 space-y-4">
          {!result ? (
            <>
              <div className="bg-[#0f1117] rounded-xl border border-[#2a2d3a] p-3 text-xs text-gray-500 space-y-1">
                <p className="text-gray-400 font-medium mb-2">Supported formats:</p>
                <p className="font-mono">host:port:user:pass</p>
                <p className="font-mono">socks5://user:pass@host:port</p>
                <p className="font-mono">http://host:port</p>
              </div>
              <textarea
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                rows={10}
                placeholder={"192.168.1.1:8080:user:pass\nsocks5://user:pass@proxy.com:1080\nhttp://10.0.0.1:3128"}
                className="w-full bg-[#0f1117] border border-[#2a2d3a] rounded-xl px-4 py-3 text-sm text-gray-200 font-mono placeholder-gray-700 focus:outline-none focus:border-purple-500/50 resize-none"
              />
              <button
                onClick={handleImport}
                disabled={!raw.trim() || loading}
                className="w-full py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white text-sm font-medium transition-colors"
              >
                {loading ? "Importing…" : "Import Proxies →"}
              </button>
            </>
          ) : (
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
                <div className="bg-[#0f1117] rounded-xl border border-[#2a2d3a] p-3 max-h-32 overflow-y-auto">
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

// ─── Main ProxyList ───────────────────────────────────────────
export default function ProxyList() {
  const [proxies, setProxies] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [filterBlocked, setFilterBlocked] = useState(null);
  const [filterType, setFilterType] = useState(null);
  const [modal, setModal] = useState(null); // null | "add" | "import" | Proxy
  const { toast } = useToast();
  const { confirm } = useConfirm();
  const PER_PAGE = 50;

  const load = useCallback(async (p = page, fb = filterBlocked, ft = filterType) => {
    setLoading(true);
    try {
      const r = await invoke("get_proxies", {
        filter: { is_blocked: fb, proxy_type: ft },
        page: p,
        perPage: PER_PAGE,
      });
      setProxies(r.items);
      setTotal(r.total);
    } catch (e) {
      toast(String(e), "error");
    } finally {
      setLoading(false);
    }
  }, [page, filterBlocked, filterType]);

  useEffect(() => { load(); }, []);

  const handleAdd = async (form) => {
    await invoke("add_proxy", { input: form });
    toast("Proxy added", "success");
    load();
  };

  const handleEdit = async (form) => {
    await invoke("update_proxy", { id: modal.id, input: form });
    toast("Proxy updated", "success");
    load();
  };

  const handleBlock = async (proxy) => {
    try {
      await invoke("block_proxy", { id: proxy.id, blocked: !proxy.is_blocked });
      toast(proxy.is_blocked ? "Proxy unblocked" : "Proxy blocked", "success");
      load();
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const handleDelete = async (proxy) => {
    const ok = await confirm(`Delete proxy ${proxy.host}:${proxy.port}?`, { danger: true });
    if (!ok) return;
    try {
      await invoke("delete_proxy", { id: proxy.id });
      toast("Proxy deleted", "success");
      load();
    } catch (e) {
      toast(String(e), "error");
    }
  };

  const cleanCount = proxies.filter((p) => !p.is_blocked && !p.shops_used?.length).length;
  const totalPages = Math.ceil(total / PER_PAGE);

  const applyBlockFilter = (v) => {
    const f = v === filterBlocked ? null : v;
    setFilterBlocked(f);
    setPage(1);
    load(1, f, filterType);
  };

  const applyTypeFilter = (v) => {
    const f = v === filterType ? null : v;
    setFilterType(f);
    setPage(1);
    load(1, filterBlocked, f);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a2d3a]">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-gray-100">Proxy Manager</h1>
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
            onClick={() => setModal("import")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-300 bg-[#2a2d3a] hover:bg-[#3a3d4a] rounded-lg transition-colors border border-[#3a3d4a]"
          >
            <Upload size={13} /> Import
          </button>
          <button
            onClick={() => setModal("add")}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors"
          >
            <Plus size={14} /> Add Proxy
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 px-6 py-3 border-b border-[#2a2d3a] bg-[#0f1117]/40">
        {/* Status filter */}
        <div className="flex rounded-lg overflow-hidden border border-[#2a2d3a]">
          {[[null, "All"], [false, "Clean"], [true, "Blocked"]].map(([val, label]) => (
            <button
              key={String(val)}
              onClick={() => applyBlockFilter(val)}
              className={`px-3 py-1.5 text-xs transition-colors ${filterBlocked === val ? "bg-blue-600 text-white" : "text-gray-400 hover:text-gray-200 hover:bg-[#2a2d3a]"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {/* Type filter */}
        <div className="flex rounded-lg overflow-hidden border border-[#2a2d3a]">
          {[["http", "HTTP"], ["socks5", "SOCKS5"], ["socks4", "SOCKS4"]].map(([val, label]) => (
            <button
              key={val}
              onClick={() => applyTypeFilter(val)}
              className={`px-3 py-1.5 text-xs font-mono transition-colors ${filterType === val ? "bg-purple-600 text-white" : "text-gray-400 hover:text-gray-200 hover:bg-[#2a2d3a]"}`}
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
              {["Label", "Host : Port", "Type", "Auth", "Used In", "Status", "Added", "Actions"].map((h) => (
                <th key={h} className="px-4 py-3 text-left text-[11px] uppercase tracking-widest text-gray-500 font-medium whitespace-nowrap">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {proxies.length === 0 && !loading && (
              <tr>
                <td colSpan={8} className="text-center py-20 text-gray-600">
                  <Globe size={36} className="mx-auto mb-3 opacity-30" />
                  <p className="text-sm">No proxies found</p>
                </td>
              </tr>
            )}
            {proxies.map((proxy) => (
              <tr
                key={proxy.id}
                className={`border-b border-[#2a2d3a] transition-colors group hover:bg-[#1a1d27] ${proxy.is_blocked ? "opacity-60" : ""}`}
              >
                <td className="px-4 py-3">
                  <span className="text-xs text-gray-300">{proxy.label || <span className="text-gray-600">—</span>}</span>
                </td>
                <td className="px-4 py-3">
                  <span className="font-mono text-xs text-gray-200">{proxy.host}<span className="text-gray-500">:</span>{proxy.port}</span>
                </td>
                <td className="px-4 py-3">
                  <TypeBadge type={proxy.proxy_type} />
                </td>
                <td className="px-4 py-3">
                  {proxy.username ? (
                    <span className="text-xs text-gray-400 font-mono">{proxy.username}</span>
                  ) : (
                    <span className="text-gray-600 text-xs">none</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <ShopsTooltip shops={proxy.shops_used} />
                </td>
                <td className="px-4 py-3">
                  <StatusBadge proxy={proxy} />
                </td>
                <td className="px-4 py-3">
                  <span className="text-xs text-gray-600">{proxy.created_at?.slice(0, 10)}</span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleBlock(proxy)}
                      title={proxy.is_blocked ? "Unblock" : "Block"}
                      className={`p-1.5 rounded transition-colors ${proxy.is_blocked ? "text-gray-500 hover:text-green-400 hover:bg-green-500/10" : "text-gray-500 hover:text-red-400 hover:bg-red-500/10"}`}
                    >
                      {proxy.is_blocked ? <Shield size={13} /> : <ShieldOff size={13} />}
                    </button>
                    <button
                      onClick={() => setModal(proxy)}
                      className="p-1.5 text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 rounded transition-colors"
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      onClick={() => handleDelete(proxy)}
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
          <span className="text-xs text-gray-500">{total} proxies</span>
          <div className="flex gap-1">
            {Array.from({ length: Math.min(totalPages, 7) }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => { setPage(p); load(p, filterBlocked, filterType); }}
                className={`w-8 h-8 text-xs rounded-lg transition-colors ${page === p ? "bg-blue-600 text-white" : "text-gray-500 hover:bg-[#2a2d3a] hover:text-gray-200"}`}
              >
                {p}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Modals */}
      {modal === "add" && (
        <ProxyModal onSave={handleAdd} onClose={() => setModal(null)} />
      )}
      {modal === "import" && (
        <ImportModal onDone={() => load()} onClose={() => setModal(null)} />
      )}
      {modal && modal !== "add" && modal !== "import" && (
        <ProxyModal initial={modal} onSave={handleEdit} onClose={() => setModal(null)} />
      )}
    </div>
  );
}
