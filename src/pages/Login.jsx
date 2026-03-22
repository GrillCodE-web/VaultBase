import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CreditCard, Eye, EyeOff, Lock, Check, X } from "lucide-react";
import { useLang } from "../hooks/useLang.jsx";

// ─── Password strength calculator ──────────────────────────────────────────

function calcStrength(password) {
  if (!password) return 0;
  let score = 0;
  if (password.length >= 12) score++;
  if (password.length >= 16) score++;
  if (/[A-Z]/.test(password)) score++;
  if (/[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(4, score);
}

const STRENGTH_META = [
  { color: "bg-accent-red",    label: "auth_strength_weak"   },
  { color: "bg-accent-red",    label: "auth_strength_weak"   },
  { color: "bg-accent-yellow", label: "auth_strength_fair"   },
  { color: "bg-green-400",     label: "auth_strength_good"   },
  { color: "bg-accent-green",  label: "auth_strength_strong" },
];

// ─── Password input with show/hide toggle ─────────────────────────────────

function PasswordInput({ value, onChange, placeholder, onKeyDown, autoFocus, id }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        id={id}
        type={show ? "text" : "password"}
        value={value}
        onChange={e => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        className="auth-input"
        style={{ paddingRight: 44 }}
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow(v => !v)}
        style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", cursor: "pointer", color: "var(--muted)", padding: 0 }}
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

// ─── Requirement row ───────────────────────────────────────────────────────

function Req({ met, label }) {
  return (
    <div className={met ? "auth-req-row auth-req-ok" : "auth-req-row auth-req-no"}>
      {met ? <Check size={12} className="shrink-0" /> : <X size={12} className="shrink-0" />}
      <span>{label}</span>
    </div>
  );
}

// ─── Main Login component ─────────────────────────────────────────────────

export default function Login({ onUnlocked }) {
  const { t } = useLang();

  const [mode, setMode]           = useState("loading"); // loading | setup | unlock
  const [password, setPassword]   = useState("");
  const [confirm, setConfirm]     = useState("");
  const [error, setError]         = useState("");
  const [loading, setLoading]     = useState(false);

  // Check initial state
  useEffect(() => {
    invoke("is_password_set")
      .then(val => setMode(val ? "unlock" : "setup"))
      .catch(() => setMode("setup"));
  }, []);

  // Derived requirement states
  const reqs = {
    length:  password.length >= 12,
    upper:   /[A-Z]/.test(password),
    lower:   /[a-z]/.test(password),
    digit:   /\d/.test(password),
    special: /[^a-zA-Z0-9]/.test(password),
  };
  const reqsMet = Object.values(reqs).every(Boolean);
  const strength = calcStrength(password);
  const sm = STRENGTH_META[strength] ?? STRENGTH_META[0];

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleSubmit();
  };

  const handleSubmit = async () => {
    setError("");

    if (mode === "setup") {
      if (!reqsMet) { setError(t("auth_err_too_weak")); return; }
      if (password !== confirm) { setError(t("auth_err_mismatch")); return; }

      setLoading(true);
      try {
        await invoke("setup_password", { password });
        onUnlocked();
      } catch (e) {
        setError(parseError(e, t));
      } finally {
        setLoading(false);
      }
    } else {
      if (!password) return;
      setLoading(true);
      try {
        await invoke("unlock", { password });
        onUnlocked();
      } catch (e) {
        setError(parseError(e, t));
      } finally {
        setLoading(false);
      }
    }
  };

  if (mode === "loading") {
    return (
      <div style={{ width: "100vw", height: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ width: 24, height: 24, border: "2px solid #3b82f6", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      </div>
    );
  }

  return (
    <div className="auth-screen">
      <div className="auth-bg-glow" />
      <div style={{ position: "relative", width: "100%", maxWidth: 400, margin: "0 16px" }}>
        {/* Logo */}
        <div className="auth-logo-wrap">
          <div className="auth-logo-icon">
            {mode === "unlock" ? <Lock size={24} className="text-white" /> : <CreditCard size={24} className="text-white" />}
          </div>
          <h1 className="auth-title">{t(mode === "setup" ? "auth_setup_title" : "auth_unlock_title")}</h1>
          <p className="auth-sub">{t(mode === "setup" ? "auth_setup_subtitle" : "auth_unlock_subtitle")}</p>
        </div>

        {/* Card */}
        <div className="auth-card">

          {/* Password field */}
          <div className="form-group">
            <label className="auth-label">{t("auth_password_label")}</label>
            <PasswordInput
              id="password"
              value={password}
              onChange={v => { setPassword(v); setError(""); }}
              placeholder="••••••••••••"
              onKeyDown={mode === "unlock" ? handleKeyDown : undefined}
              autoFocus
            />
          </div>

          {/* Strength bar (setup only) */}
          {mode === "setup" && password.length > 0 && (
            <div className="form-group">
              <div className="auth-strength-bar">
                {[0,1,2,3].map(i => {
                  const colors = ["#ef4444","#ef4444","#eab308","#4ade80","#22c55e"];
                  return (
                    <div
                      key={i}
                      className="auth-strength-seg"
                      style={{ background: i < strength ? colors[strength] : "var(--border)" }}
                    />
                  );
                })}
              </div>
              <p style={{ fontSize: 11, color: ["#ef4444","#ef4444","#eab308","#4ade80","#22c55e"][strength] }}>
                {t(sm.label)}
              </p>
            </div>
          )}

          {/* Requirements (setup only) */}
          {mode === "setup" && (
            <div className="auth-reqs form-group">
              <p style={{ fontSize: 11, color: "var(--muted)", marginBottom: 8 }}>{t("auth_req_title")}</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                <Req met={reqs.length}  label={t("auth_req_length")}  />
                <Req met={reqs.upper}   label={t("auth_req_upper")}   />
                <Req met={reqs.lower}   label={t("auth_req_lower")}   />
                <Req met={reqs.digit}   label={t("auth_req_digit")}   />
                <Req met={reqs.special} label={t("auth_req_special")} />
              </div>
            </div>
          )}

          {/* Confirm password (setup only) */}
          {mode === "setup" && (
            <div className="form-group">
              <label className="auth-label">{t("auth_confirm_label")}</label>
              <PasswordInput
                id="confirm"
                value={confirm}
                onChange={v => { setConfirm(v); setError(""); }}
                placeholder="••••••••••••"
                onKeyDown={handleKeyDown}
              />
            </div>
          )}

          {/* Error */}
          {error && <div className="auth-error">{error}</div>}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={loading || (mode === "setup" && (!reqsMet || password !== confirm))}
            className="auth-btn"
          >
            {loading && <div className="auth-spinner" style={{ display: "inline-block", marginRight: 8, verticalAlign: "middle" }} />}
            {loading
              ? t(mode === "setup" ? "auth_btn_creating" : "auth_btn_unlocking")
              : t(mode === "setup" ? "auth_btn_create"   : "auth_btn_unlock")}
          </button>

          {/* No-recovery warning (setup only) */}
          {mode === "setup" && (
            <div className="auth-warning">{t("auth_warning_no_recovery")}</div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Error message resolver ────────────────────────────────────────────────

function parseError(err, t) {
  const msg = typeof err === "string" ? err : String(err);
  if (msg.includes("wrong_password"))      return t("auth_err_wrong");
  if (msg.includes("password_too_weak"))   return t("auth_err_too_weak");
  if (msg.includes("password_already_set")) return t("auth_err_already_set");
  if (msg.includes("mismatch"))            return t("auth_err_mismatch");
  if (msg.includes("database_locked"))     return t("auth_err_locked");
  return t("auth_err_generic");
}
