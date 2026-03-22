import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Copy, Check, KeyRound, ShieldCheck } from "lucide-react";
import { useLang } from "../hooks/useLang";

// Auto-format XXXX-XXXX-XXXX-XXXX as user types
function formatKey(raw) {
  const clean = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase().slice(0, 16);
  const parts = [];
  for (let i = 0; i < clean.length; i += 4) {
    parts.push(clean.slice(i, i + 4));
  }
  return parts.join("-");
}

export default function Activate({ onActivated }) {
  const { t } = useLang();
  const [challengeCode, setChallengeCode] = useState("");
  const [installationId, setInstallationId] = useState("");
  const [copied, setCopied] = useState(false);
  const [copiedId, setCopiedId] = useState(false);
  const [activationKey, setActivationKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    invoke("get_challenge_code")
      .then(setChallengeCode)
      .catch(() => setChallengeCode("????-????-????-????"));
    invoke("get_installation_id")
      .then(setInstallationId)
      .catch(() => {});
  }, []);

  const handleCopy = useCallback(() => {
    if (!challengeCode) return;
    navigator.clipboard.writeText(challengeCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [challengeCode]);

  const handleCopyId = useCallback(() => {
    if (!installationId) return;
    navigator.clipboard.writeText(installationId).then(() => {
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    });
  }, [installationId]);

  const handleKeyChange = (e) => {
    const formatted = formatKey(e.target.value);
    setActivationKey(formatted);
    setError("");
  };

  const handleActivate = async () => {
    const clean = activationKey.replace(/-/g, "");
    if (clean.length !== 16) {
      setError(t("activate_key_invalid") || "Enter a complete 16-character activation key.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      await invoke("activate_license", { activationKey });
      setSuccess(true);
      setTimeout(() => {
        if (onActivated) onActivated();
      }, 1500);
    } catch (err) {
      const map = {
        invalid_key: t("activate_err_invalid_key") || "Invalid activation key.",
        already_activated: t("activate_err_already") || "Already activated.",
        network_error: t("activate_err_network") || "Network error. Check your connection.",
      };
      setError(map[err] || `${t("activate_err_unknown") || "Error"}: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter") handleActivate();
  };

  return (
    <div className="auth-screen">
      <div className="auth-bg-glow" />
      <div className="auth-card" style={{ maxWidth: 440 }}>
        {/* Header */}
        <div className="auth-logo-wrap">
          <div className="auth-logo-icon" style={{ background: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.25)" }}>
            <ShieldCheck size={28} style={{ color: "#3b82f6" }} />
          </div>
          <h1 className="auth-title" style={{ fontSize: 18 }}>{t("activate_title") || "Activation Required"}</h1>
          <p className="auth-sub">{t("activate_subtitle") || "This copy of CC Manager must be activated."}</p>
        </div>

        {/* Installation Code Block */}
        <div style={{ background: "var(--inset)", border: "1px solid var(--border)", borderRadius: 10, padding: 16, marginBottom: 20 }}>
          <p style={{ fontSize: 11, color: "var(--muted)", marginBottom: 12 }}>
            {t("activate_your_code") || "Your installation code:"}
          </p>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
            <span style={{ flex: 1, textAlign: "center", fontSize: 18, fontFamily: "JetBrains Mono,monospace", fontWeight: 700, letterSpacing: "0.15em", color: "#3b82f6", userSelect: "all" }}>
              {challengeCode || t("msg_loading")}
            </span>
            <button
              onClick={handleCopy}
              className="btn btn-b btn-sm"
              style={{ background: copied ? "rgba(34,197,94,0.15)" : undefined, color: copied ? "#22c55e" : undefined, borderColor: copied ? "rgba(34,197,94,0.3)" : undefined }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? (t("copied") || "Copied") : (t("copy") || "Copy")}
            </button>
          </div>
          {installationId && (
            <div style={{ borderTop: "1px solid var(--border)", paddingTop: 10 }}>
              <p style={{ fontSize: 11, color: "var(--muted)", marginBottom: 6 }}>Installation ID:</p>
              <div className="flex items-center gap-2">
                <span className="mono" style={{ flex: 1, fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", userSelect: "all" }}>
                  {installationId}
                </span>
                <button onClick={handleCopyId} className="btn btn-ghost btn-sm shrink-0">
                  {copiedId ? <Check size={11} /> : <Copy size={11} />}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Instruction */}
        <p style={{ fontSize: 13, textAlign: "center", marginBottom: 20, lineHeight: 1.6, color: "var(--text-2)" }}>
          {t("activate_instruction") || "Send this code to your administrator to receive an activation key."}
        </p>

        {/* Key Input */}
        <div className="form-group">
          <label className="auth-label">{t("activate_key_label") || "Activation Key"}</label>
          <div className="relative">
            <KeyRound size={15} style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "var(--muted)" }} />
            <input
              type="text"
              value={activationKey}
              onChange={handleKeyChange}
              onKeyDown={handleKeyDown}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              maxLength={19}
              spellCheck={false}
              autoComplete="off"
              className="auth-input mono"
              style={{
                paddingLeft: 36, textAlign: "center", letterSpacing: "0.15em",
                border: `1px solid ${error ? "#ef4444" : "var(--border)"}`,
                caretColor: "#3b82f6",
              }}
              onFocus={(e) => (e.target.style.borderColor = error ? "#ef4444" : "#3b82f6")}
              onBlur={(e) => (e.target.style.borderColor = error ? "#ef4444" : "var(--border)")}
            />
          </div>
          {error && <p style={{ marginTop: 6, fontSize: 11, color: "#ef4444" }}>{error}</p>}
          {success && <p style={{ marginTop: 6, fontSize: 11, color: "#22c55e", fontWeight: 500 }}>{t("activate_success") || "Activated! Loading..."}</p>}
        </div>

        {/* Activate Button */}
        <button
          onClick={handleActivate}
          disabled={loading || success || activationKey.replace(/-/g, "").length !== 16}
          className="auth-btn"
          style={{
            background: loading || success ? "rgba(59,130,246,0.4)" : "#3b82f6",
            opacity: activationKey.replace(/-/g, "").length !== 16 && !loading ? 0.5 : 1,
          }}
        >
          {loading ? (t("activating") || "Activating…") : success ? (t("activate_success_btn") || "✓ Activated") : (t("activate_btn") || "Activate")}
        </button>
      </div>
    </div>
  );
}
