import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
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
  const [copied, setCopied] = useState(false);
  const [activationKey, setActivationKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    invoke("get_challenge_code")
      .then(setChallengeCode)
      .catch(() => setChallengeCode("????-????-????-????"));
  }, []);

  const handleCopy = useCallback(() => {
    if (!challengeCode) return;
    navigator.clipboard.writeText(challengeCode).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [challengeCode]);

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
    <div
      className="min-h-screen flex items-center justify-center"
      style={{ backgroundColor: "#0f1117" }}
    >
      <div
        className="w-full max-w-md rounded-2xl p-8 shadow-2xl"
        style={{ backgroundColor: "#1a1d27", border: "1px solid #2a2d3a" }}
      >
        {/* Header */}
        <div className="flex flex-col items-center mb-8">
          <div
            className="w-14 h-14 rounded-xl flex items-center justify-center mb-4"
            style={{ backgroundColor: "rgba(59,130,246,0.12)" }}
          >
            <ShieldCheck size={28} style={{ color: "#3b82f6" }} />
          </div>
          <h1 className="text-xl font-semibold text-white">
            {t("activate_title") || "Activation Required"}
          </h1>
          <p className="text-sm mt-1" style={{ color: "#6b7280" }}>
            {t("activate_subtitle") || "This copy of CC Manager must be activated."}
          </p>
        </div>

        {/* Installation Code Block */}
        <div
          className="rounded-xl p-4 mb-6"
          style={{ backgroundColor: "#111318", border: "1px solid #2a2d3a" }}
        >
          <p className="text-xs font-medium mb-3" style={{ color: "#6b7280" }}>
            {t("activate_your_code") || "Your installation code:"}
          </p>

          <div className="flex items-center gap-3">
            <span
              className="flex-1 text-center text-lg font-mono font-bold tracking-widest select-all"
              style={{ color: "#3b82f6", letterSpacing: "0.15em" }}
            >
              {challengeCode || "Loading..."}
            </span>

            <button
              onClick={handleCopy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              style={{
                backgroundColor: copied ? "rgba(34,197,94,0.15)" : "rgba(59,130,246,0.12)",
                color: copied ? "#22c55e" : "#3b82f6",
                border: `1px solid ${copied ? "rgba(34,197,94,0.3)" : "rgba(59,130,246,0.3)"}`,
              }}
              title="Copy to clipboard"
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? (t("copied") || "Copied") : (t("copy") || "Copy")}
            </button>
          </div>
        </div>

        {/* Instruction */}
        <p
          className="text-sm text-center mb-6 leading-relaxed"
          style={{ color: "#9ca3af" }}
        >
          {t("activate_instruction") ||
            "Send this code to your administrator to receive an activation key."}
        </p>

        {/* Key Input */}
        <div className="mb-4">
          <label className="block text-xs font-medium mb-2" style={{ color: "#6b7280" }}>
            {t("activate_key_label") || "Activation Key"}
          </label>
          <div className="relative">
            <KeyRound
              size={15}
              className="absolute left-3 top-1/2 -translate-y-1/2"
              style={{ color: "#6b7280" }}
            />
            <input
              type="text"
              value={activationKey}
              onChange={handleKeyChange}
              onKeyDown={handleKeyDown}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              maxLength={19}
              spellCheck={false}
              autoComplete="off"
              className="w-full pl-9 pr-4 py-3 rounded-xl text-sm font-mono text-center tracking-widest outline-none transition-all"
              style={{
                backgroundColor: "#111318",
                border: `1px solid ${error ? "#ef4444" : "#2a2d3a"}`,
                color: "#ffffff",
                caretColor: "#3b82f6",
              }}
              onFocus={(e) =>
                (e.target.style.borderColor = error ? "#ef4444" : "#3b82f6")
              }
              onBlur={(e) =>
                (e.target.style.borderColor = error ? "#ef4444" : "#2a2d3a")
              }
            />
          </div>

          {/* Error / Success messages */}
          {error && (
            <p className="mt-2 text-xs" style={{ color: "#ef4444" }}>
              {error}
            </p>
          )}
          {success && (
            <p className="mt-2 text-xs font-medium" style={{ color: "#22c55e" }}>
              {t("activate_success") || "Activated! Loading..."}
            </p>
          )}
        </div>

        {/* Activate Button */}
        <button
          onClick={handleActivate}
          disabled={loading || success || activationKey.replace(/-/g, "").length !== 16}
          className="w-full py-3 rounded-xl text-sm font-semibold transition-all"
          style={{
            backgroundColor:
              loading || success ? "rgba(59,130,246,0.4)" : "#3b82f6",
            color: "#ffffff",
            cursor:
              loading || success || activationKey.replace(/-/g, "").length !== 16
                ? "not-allowed"
                : "pointer",
            opacity:
              activationKey.replace(/-/g, "").length !== 16 && !loading ? 0.5 : 1,
          }}
        >
          {loading
            ? (t("activating") || "Activating…")
            : success
            ? (t("activate_success_btn") || "✓ Activated")
            : (t("activate_btn") || "Activate")}
        </button>
      </div>
    </div>
  );
}
