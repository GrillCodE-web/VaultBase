import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Inbox, Plus, Trash2, Edit2, RefreshCw, ToggleLeft, ToggleRight,
  Mail, CheckCircle, AlertCircle, Package, X,
} from "lucide-react";
import { useLang } from "../hooks/useLang";
import { useToast } from "../hooks/useToast";
import { useConfirm } from "../hooks/useConfirm";
import { SkeletonRows } from "../components/SkeletonRow.jsx";

// ─── Status badge ─────────────────────────────────────────────
function ActionBadge({ action }) {
  if (!action) return null;
  const cls = {
    shipped:    "st-transit",
    delivered:  "st-delivered",
    cancelled:  "st-cancelled",
    processing: "st-processing",
  }[action] ?? "st-pending";
  return <span className={`st ${cls}`}>{action}</span>;
}

// ─── IMAP provider auto-config ───────────────────────────────
const IMAP_PROVIDERS = {
  "gmail.com":        { host: "imap.gmail.com",         port: 993 },
  "googlemail.com":   { host: "imap.gmail.com",         port: 993 },
  "yahoo.com":        { host: "imap.mail.yahoo.com",    port: 993 },
  "ymail.com":        { host: "imap.mail.yahoo.com",    port: 993 },
  "yahoo.co.uk":      { host: "imap.mail.yahoo.com",    port: 993 },
  "outlook.com":      { host: "outlook.office365.com",  port: 993 },
  "hotmail.com":      { host: "outlook.office365.com",  port: 993 },
  "live.com":         { host: "outlook.office365.com",  port: 993 },
  "msn.com":          { host: "outlook.office365.com",  port: 993 },
  "icloud.com":       { host: "imap.mail.me.com",       port: 993 },
  "me.com":           { host: "imap.mail.me.com",       port: 993 },
  "mac.com":          { host: "imap.mail.me.com",       port: 993 },
  "aol.com":          { host: "imap.aol.com",           port: 993 },
  "zoho.com":         { host: "imap.zoho.com",          port: 993 },
  "protonmail.com":   { host: "127.0.0.1",              port: 1143 },
  "proton.me":        { host: "127.0.0.1",              port: 1143 },
  "mail.com":         { host: "imap.mail.com",          port: 993 },
  "gmx.com":          { host: "imap.gmx.com",           port: 993 },
  "gmx.net":          { host: "imap.gmx.net",           port: 993 },
  "rambler.ru":       { host: "imap.rambler.ru",        port: 993 },
  "mail.ru":          { host: "imap.mail.ru",           port: 993 },
  "yandex.ru":        { host: "imap.yandex.ru",         port: 993 },
  "yandex.com":       { host: "imap.yandex.com",        port: 993 },
};

function detectImapConfig(email) {
  const domain = email.split("@")[1]?.toLowerCase();
  return domain ? (IMAP_PROVIDERS[domain] ?? null) : null;
}

// ─── Account Form Modal ───────────────────────────────────────
function AccountModal({ account, onSave, onClose }) {
  const [form, setForm] = useState({
    label:         account?.label         ?? "",
    host:          account?.host          ?? "",
    port:          account?.port          ?? 993,
    login:         account?.login         ?? "",
    password:      "",
    poll_interval: account?.poll_interval ?? 60,
  });
  const [autoDetected, setAutoDetected] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const { success: toastOk, error: toastErr } = useToast();
  const isEdit = !!account;

  const set = (k, v) => setForm((p) => ({ ...p, [k]: v }));

  const handleLoginChange = (email) => {
    set("login", email);
    // Auto-fill label if empty
    if (!form.label) set("label", email.split("@")[0]);
    // Auto-detect host/port
    const cfg = detectImapConfig(email);
    if (cfg && !isEdit) {
      setForm(p => ({ ...p, login: email, label: p.label || email.split("@")[0], host: cfg.host, port: cfg.port }));
      setAutoDetected(cfg.host);
    } else {
      setAutoDetected(null);
    }
  };

  // test_imap_connection(id) — only works for saved accounts
  const handleTest = async () => {
    if (!isEdit) {
      setTestResult({ ok: false, msg: "Save the account first, then test the connection" });
      return;
    }
    setTesting(true);
    setTestResult(null);
    try {
      const msg = await invoke("test_imap_connection", { id: account.id });
      setTestResult({ ok: true, msg });
    } catch (e) {
      setTestResult({ ok: false, msg: String(e) });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!form.label || !form.host || !form.login) {
      toastErr("Label, host and login are required");
      return;
    }
    setSaving(true);
    try {
      await onSave(form);
      onClose();
    } catch (e) {
      toastErr(String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 420 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 18 }}>
          <div className="modal-title">{account ? "Edit IMAP Account" : "Add IMAP Account"}</div>
          <button onClick={onClose} className="modal-close"><X size={16} /></button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {/* Login — triggers auto-detect */}
          <div className="form-group">
            <label className="form-label">Login (email) *</label>
            <input
              type="text"
              value={form.login}
              onChange={(e) => handleLoginChange(e.target.value)}
              placeholder="user@yahoo.com"
              className="form-input"
            />
            {autoDetected && (
              <div style={{ marginTop: 4, fontSize: 11, color: "#4ade80" }}>
                ✓ Auto-configured: {autoDetected}:{form.port} — use App Password
              </div>
            )}
          </div>

          {[
            { label: "Label", key: "label", type: "text", placeholder: "Yahoo work" },
            { label: "Host", key: "host", type: "text", placeholder: "imap.mail.yahoo.com" },
            { label: "Port", key: "port", type: "number", placeholder: "993" },
            { label: "App Password *", key: "password", type: "password", placeholder: account ? "Leave blank to keep" : "App password (not web password!)" },
            { label: "Poll interval (sec)", key: "poll_interval", type: "number", placeholder: "60" },
          ].map(({ label, key, type, placeholder }) => (
            <div className="form-group" key={key}>
              <label className="form-label">{label}</label>
              <input
                type={type}
                value={form[key]}
                onChange={(e) => set(key, type === "number" ? Number(e.target.value) : e.target.value)}
                placeholder={placeholder}
                className="form-input"
              />
            </div>
          ))}
        </div>

        {testResult && (
          <div style={{
            marginTop: 12,
            padding: "10px 12px",
            borderRadius: 8,
            fontSize: 12,
            display: "flex",
            alignItems: "center",
            gap: 8,
            backgroundColor: testResult.ok ? "rgba(34,197,94,0.08)" : "rgba(239,68,68,0.08)",
            border: `1px solid ${testResult.ok ? "rgba(34,197,94,0.2)" : "rgba(239,68,68,0.2)"}`,
            color: testResult.ok ? "#22c55e" : "#f87171",
          }}>
            {testResult.ok ? <CheckCircle size={13} /> : <AlertCircle size={13} />}
            {testResult.msg}
          </div>
        )}

        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <button onClick={handleTest} disabled={testing} className="btn btn-b btn-sm">
            {testing ? <RefreshCw size={13} style={{ animation: "spin 1s linear infinite" }} /> : <CheckCircle size={13} />}
            Test
          </button>
          <div style={{ flex: 1 }} />
          <button onClick={onClose} className="btn btn-ghost btn-sm">Cancel</button>
          <button onClick={handleSave} disabled={saving} className="btn btn-b btn-sm">
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Page ───────────────────────────────────────────────
export default function Imap() {
  const { success: toastOk, error: toastErr } = useToast();
  const confirm = useConfirm();

  const [accounts, setAccounts] = useState([]);
  const [messages, setMessages] = useState([]);
  const [modal, setModal] = useState(null);
  const [checking, setChecking] = useState(false);
  const [loading, setLoading] = useState(false);

  const loadAccounts = useCallback(async () => {
    try {
      const list = await invoke("get_imap_accounts");
      setAccounts(list);
    } catch (e) {
      toastErr(String(e));
    }
  }, []);

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const res = await invoke("get_imap_messages", {
        filter: { account_id: null, processed: null, date_from: null, date_to: null },
        page: 1,
      });
      setMessages(res.items ?? []);
    } catch (e) {
      toastErr(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
    loadMessages();
  }, [loadAccounts, loadMessages]);

  const handleCheckAll = async () => {
    setChecking(true);
    try {
      const res = await invoke("imap_check_all");
      toastOk(`Checked ${res.accounts_checked} accounts, found ${res.messages_found} messages`);
      await loadAccounts();
      await loadMessages();
    } catch (e) {
      toastErr(String(e));
    } finally {
      setChecking(false);
    }
  };

  const handleLinkAll = async () => {
    try {
      const count = await invoke("link_all_imap_accounts");
      toastOk(`Linked ${count} IMAP accounts to Email Pool`);
    } catch (e) {
      toastErr(String(e));
    }
  };

  const handleSaveAccount = async (form) => {
    if (modal && modal !== "add") {
      await invoke("update_imap_account", { id: modal.id, input: form });
      toastOk("Account updated");
    } else {
      await invoke("add_imap_account", { input: form });
      toastOk("Account added");
    }
    await loadAccounts();
  };

  const handleToggle = async (acc) => {
    try {
      await invoke("toggle_imap_account", { id: acc.id, active: !acc.is_active });
      setAccounts((prev) => prev.map((a) => a.id === acc.id ? { ...a, is_active: !a.is_active } : a));
    } catch (e) {
      toastErr(String(e));
    }
  };

  const handleDelete = async (acc) => {
    const ok = await confirm(`Delete account "${acc.label}"?`, "Delete Account");
    if (!ok) return;
    try {
      await invoke("delete_imap_account", { id: acc.id });
      toastOk("Deleted");
      await loadAccounts();
    } catch (e) {
      toastErr(String(e));
    }
  };

  return (
    <div className="content">
      {/* Header */}
      <div className="ph">
        <div>
          <div className="ph-title">📬 IMAP / Email</div>
          <div className="ph-sub">{accounts.length} account{accounts.length !== 1 ? "s" : ""}</div>
        </div>
        <div className="ph-actions">
          <button onClick={handleLinkAll} className="btn btn-ghost btn-sm" title="Link all IMAP accounts to Email Pool">
            🔗 Link to Pool
          </button>
          <button onClick={handleCheckAll} disabled={checking} className="btn btn-b btn-sm">
            <RefreshCw size={13} style={{ animation: checking ? "spin 1s linear infinite" : "none" }} />
            Check Now
          </button>
          <button onClick={() => setModal("add")} className="btn btn-g">
            <Plus size={13} /> Add Account
          </button>
        </div>
      </div>

      <div className="grid2" style={{ alignItems: "start" }}>

        {/* LEFT: Accounts + Auto-parse */}
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

          {/* IMAP Accounts panel */}
          <div className="panel">
            <div className="ptitle">IMAP Accounts</div>
            {accounts.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "40px 0", gap: 12 }}>
                <Inbox size={38} style={{ color: "var(--border)", opacity: 0.5 }} />
                <p style={{ color: "var(--muted)", fontSize: 13, margin: 0 }}>No IMAP accounts configured</p>
                <button onClick={() => setModal("add")} className="btn btn-g btn-sm">
                  <Plus size={13} /> Add your first account
                </button>
              </div>
            ) : (
              <table className="tbl">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Server</th>
                    <th>Status</th>
                    <th>Last Check</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map((acc) => (
                    <tr key={acc.id}>
                      <td>
                        <div style={{ fontWeight: 500 }}>{acc.label}</div>
                        <div style={{ fontSize: 11, color: "var(--muted)" }}>{acc.login}</div>
                      </td>
                      <td className="mono" style={{ fontSize: 11 }}>{acc.host}:{acc.port}</td>
                      <td>
                        <span className={`st ${acc.is_active ? "st-active" : "st-pending"}`}>
                          {acc.is_active ? "active" : "paused"}
                        </span>
                      </td>
                      <td style={{ fontSize: 11, color: "var(--muted)" }}>
                        {acc.last_checked ? new Date(acc.last_checked).toLocaleString() : "—"}
                      </td>
                      <td>
                        <div className="tbl-actions">
                          <button onClick={() => handleToggle(acc)} className="btn btn-ghost btn-sm" title={acc.is_active ? "Pause" : "Resume"}>
                            {acc.is_active ? <ToggleRight size={15} style={{ color: "var(--accent)" }} /> : <ToggleLeft size={15} />}
                          </button>
                          <button onClick={() => setModal(acc)} className="btn btn-ghost btn-sm">Edit</button>
                          <button onClick={() => handleDelete(acc)} className="btn btn-r btn-sm">Del</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* Auto-parse settings */}
          <div className="panel">
            <div className="ptitle">Auto-parse Settings</div>
            <div className="setting-row">
              <div className="setting-info">
                <div className="setting-title">Check interval (sec)</div>
              </div>
              <input type="number" defaultValue={60} className="form-input" style={{ width: 80, textAlign: "right" }} />
            </div>
            <div className="setting-row">
              <div className="setting-info">
                <div className="setting-title">Auto-apply tracks</div>
                <div className="setting-desc">Automatically apply tracking numbers to orders</div>
              </div>
              <label className="toggle-wrap">
                <input type="checkbox" defaultChecked />
                <span className="track" />
              </label>
            </div>
            <div className="setting-row">
              <div className="setting-info">
                <div className="setting-title">Notifications</div>
                <div className="setting-desc">Show notifications for new events</div>
              </div>
              <label className="toggle-wrap">
                <input type="checkbox" />
                <span className="track" />
              </label>
            </div>
          </div>
        </div>

        {/* RIGHT: IMAP Event Log */}
        <div className="panel">
          <div className="ptitle">IMAP Event Log</div>
          {loading ? (
            <table className="tbl">
              <tbody><SkeletonRows count={5} cols={5} /></tbody>
            </table>
          ) : messages.length === 0 ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "60px 0", gap: 12, color: "var(--muted)" }}>
              <Mail size={38} style={{ opacity: 0.3 }} />
              <p style={{ fontSize: 13, margin: 0 }}>Events will appear here</p>
              <p style={{ fontSize: 11, margin: 0, color: "var(--dim)" }}>Click "Check Now" to fetch emails</p>
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {messages.map((msg) => (
                <div key={msg.id} style={{
                  display: "flex", alignItems: "flex-start", gap: 10,
                  padding: "8px 10px", borderRadius: 8,
                  backgroundColor: "rgba(255,255,255,0.02)",
                  border: "1px solid var(--border)",
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 7,
                    backgroundColor: "rgba(59,130,246,0.08)",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    flexShrink: 0,
                  }}>
                    <Mail size={13} style={{ color: "var(--accent)" }} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {msg.subject || "(no subject)"}
                      </span>
                      {msg.action_taken && <ActionBadge action={msg.action_taken} />}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2, flexWrap: "wrap" }}>
                      <span style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{msg.from_email}</span>
                      {msg.extracted_order_number && (
                        <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, color: "#a78bfa" }}>
                          <Package size={10} /> #{msg.extracted_order_number}
                        </span>
                      )}
                      {msg.extracted_tracking && (
                        <span className="mono" style={{ fontSize: 11, color: "var(--muted)", maxWidth: 110, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {msg.extracted_tracking}
                        </span>
                      )}
                    </div>
                  </div>
                  <span style={{ fontSize: 10, color: "var(--muted)", flexShrink: 0 }}>
                    {msg.received_at ? new Date(msg.received_at).toLocaleDateString() : ""}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {modal && (
        <AccountModal
          account={modal === "add" ? null : modal}
          onSave={handleSaveAccount}
          onClose={() => setModal(null)}
        />
      )}
    </div>
  );
}
