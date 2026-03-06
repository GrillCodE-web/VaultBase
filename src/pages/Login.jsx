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
        className="w-full bg-[#0f1117] border border-[#2d3148] rounded-lg
                   px-4 py-3 pr-11 text-sm text-[#e2e8f0] placeholder-[#4b5563]
                   focus:outline-none focus:border-[#a855f7] focus:ring-1 focus:ring-[#a855f7]
                   transition-colors"
      />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setShow(v => !v)}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#4b5563]
                   hover:text-[#94a3b8] transition-colors"
      >
        {show ? <EyeOff size={16} /> : <Eye size={16} />}
      </button>
    </div>
  );
}

// ─── Requirement row ───────────────────────────────────────────────────────

function Req({ met, label }) {
  return (
    <div className={`flex items-center gap-2 text-xs transition-colors
                     ${met ? "text-[#22c55e]" : "text-[#6b7280]"}`}>
      {met
        ? <Check size={12} className="shrink-0" />
        : <X size={12} className="shrink-0" />}
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
    invoke("get_config", { key: "master_password_hash" })
      .then(val => setMode(val ? "unlock" : "setup"))
      .catch(() => setMode("setup"));
  }, []);

  // Derived requirement states
  const reqs = {
    length: password.length >= 12,
    upper:  /[A-Z]/.test(password),
    lower:  /[a-z]/.test(password),
    digit:  /\d/.test(password),
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
      <div className="w-screen h-screen bg-[#0f1117] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-[#a855f7] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="w-screen h-screen bg-[#0f1117] flex items-center justify-center">
      {/* Background subtle grid */}
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_#1a1d2740_0%,_transparent_70%)]" />

      <div className="relative w-full max-w-md mx-4">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#a855f7] to-[#7c3aed]
                          flex items-center justify-center mb-4 shadow-lg shadow-purple-900/30">
            {mode === "unlock"
              ? <Lock size={24} className="text-white" />
              : <CreditCard size={24} className="text-white" />}
          </div>
          <h1 className="text-2xl font-bold text-[#e2e8f0] tracking-tight">
            {t(mode === "setup" ? "auth_setup_title" : "auth_unlock_title")}
          </h1>
          <p className="text-sm text-[#6b7280] mt-1 text-center">
            {t(mode === "setup" ? "auth_setup_subtitle" : "auth_unlock_subtitle")}
          </p>
        </div>

        {/* Card */}
        <div className="bg-[#1a1d27] border border-[#2d3148] rounded-2xl p-6 shadow-2xl">

          {/* Password field */}
          <div className="mb-4">
            <label className="block text-xs font-medium text-[#94a3b8] mb-1.5">
              {t("auth_password_label")}
            </label>
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
            <div className="mb-4">
              <div className="flex gap-1 mb-1">
                {[0,1,2,3].map(i => (
                  <div
                    key={i}
                    className={`h-1 flex-1 rounded-full transition-all duration-300
                                ${i < strength ? sm.color : "bg-[#2d3148]"}`}
                  />
                ))}
              </div>
              <p className={`text-xs ${sm.color.replace("bg-", "text-")}`}>
                {t(sm.label)}
              </p>
            </div>
          )}

          {/* Requirements (setup only) */}
          {mode === "setup" && (
            <div className="mb-4 p-3 bg-[#0f1117] rounded-lg">
              <p className="text-xs text-[#6b7280] mb-2">{t("auth_req_title")}</p>
              <div className="grid grid-cols-2 gap-1.5">
                <Req met={reqs.length} label={t("auth_req_length")} />
                <Req met={reqs.upper}  label={t("auth_req_upper")}  />
                <Req met={reqs.lower}  label={t("auth_req_lower")}  />
                <Req met={reqs.digit}  label={t("auth_req_digit")}  />
              </div>
            </div>
          )}

          {/* Confirm password (setup only) */}
          {mode === "setup" && (
            <div className="mb-4">
              <label className="block text-xs font-medium text-[#94a3b8] mb-1.5">
                {t("auth_confirm_label")}
              </label>
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
          {error && (
            <div className="mb-4 px-3 py-2 bg-[#ef444420] border border-[#ef4444] rounded-lg
                            text-sm text-[#ef4444]">
              {error}
            </div>
          )}

          {/* Submit */}
          <button
            onClick={handleSubmit}
            disabled={loading || (mode === "setup" && (!reqsMet || password !== confirm))}
            className="w-full py-3 rounded-lg text-sm font-semibold text-white
                       bg-gradient-to-r from-[#a855f7] to-[#7c3aed]
                       hover:from-[#b366f8] hover:to-[#8b45f0]
                       disabled:opacity-40 disabled:cursor-not-allowed
                       transition-all duration-200 flex items-center justify-center gap-2"
          >
            {loading && (
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
            )}
            {loading
              ? t(mode === "setup" ? "auth_btn_creating" : "auth_btn_unlocking")
              : t(mode === "setup" ? "auth_btn_create"   : "auth_btn_unlock")}
          </button>

          {/* No-recovery warning (setup only) */}
          {mode === "setup" && (
            <div className="mt-4 px-3 py-2.5 bg-[#eab30815] border border-[#eab30840]
                            rounded-lg text-xs text-[#eab308] leading-relaxed">
              {t("auth_warning_no_recovery")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Error message resolver ────────────────────────────────────────────────

function parseError(err, t) {
  const msg = typeof err === "string" ? err : String(err);
  if (msg.includes("wrong_password"))    return t("auth_err_wrong");
  if (msg.includes("password_too_weak")) return t("auth_err_too_weak");
  if (msg.includes("mismatch"))          return t("auth_err_mismatch");
  if (msg.includes("database_locked"))   return t("auth_err_locked");
  return t("auth_err_generic");
}
