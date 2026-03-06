// ============================================================
// PATCH — add this LicenseSection component to Settings.jsx
// and render it as a section block inside the Settings page.
// ============================================================

import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ShieldCheck, ShieldAlert, WifiOff, RefreshCw, Copy, Check } from "lucide-react";
import { useLang } from "../hooks/useLang";
import { useToast } from "../hooks/useToast";

export function LicenseSection() {
  const { t } = useLang();
  const { showToast } = useToast();

  const [status, setStatus] = useState(null); // "active" | "revoked" | "offline" | "not_activated"
  const [installId, setInstallId] = useState("");
  const [showId, setShowId] = useState(false);
  const [copied, setCopied] = useState(false);
  const [retrying, setRetrying] = useState(false);

  const loadStatus = () => {
    invoke("get_license_status")
      .then((s) => setStatus(s))
      .catch(() => setStatus("offline"));
    invoke("get_installation_id")
      .then(setInstallId)
      .catch(() => {});
  };

  useEffect(loadStatus, []);

  const handleRetry = async () => {
    setRetrying(true);
    try {
      const s = await invoke("retry_license_connection");
      setStatus(s);
      if (s === "active") {
        showToast(t("license_verified") || "License verified.", "success");
      }
    } catch (_) {
      setStatus("offline");
    } finally {
      setRetrying(false);
    }
  };

  const handleCopyId = () => {
    navigator.clipboard.writeText(installId).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const statusMeta = {
    active:        { label: t("license_active")  || "Active",       color: "#22c55e", Icon: ShieldCheck },
    revoked:       { label: t("license_revoked") || "Revoked",      color: "#ef4444", Icon: ShieldAlert },
    offline:       { label: t("license_offline") || "Offline",      color: "#eab308", Icon: WifiOff    },
    not_activated: { label: t("license_none")    || "Not Activated", color: "#6b7280", Icon: ShieldAlert },
  };

  const meta = statusMeta[status] || statusMeta["offline"];
  const { label, color, Icon } = meta;

  return (
    <div
      className="rounded-xl p-5"
      style={{ backgroundColor: "#111318", border: "1px solid #2a2d3a" }}
    >
      <h3 className="text-sm font-semibold text-white mb-4">
        {t("settings_license") || "License"}
      </h3>

      {/* Status row */}
      <div className="flex items-center justify-between mb-4">
        <span className="text-sm" style={{ color: "#9ca3af" }}>
          {t("settings_license_status") || "Status"}
        </span>
        <div className="flex items-center gap-2">
          <Icon size={14} style={{ color }} />
          <span className="text-sm font-medium" style={{ color }}>
            {label}
          </span>
        </div>
      </div>

      {/* Installation ID row */}
      <div className="flex items-start justify-between gap-4 mb-4">
        <span className="text-sm pt-0.5" style={{ color: "#9ca3af" }}>
          {t("settings_installation_id") || "Installation ID"}
        </span>

        <div className="flex items-center gap-2">
          {showId ? (
            <span
              className="text-xs font-mono px-2 py-1 rounded-lg select-all"
              style={{ backgroundColor: "#1a1d27", color: "#9ca3af", maxWidth: 200, wordBreak: "break-all" }}
            >
              {installId || "—"}
            </span>
          ) : (
            <span className="text-sm" style={{ color: "#6b7280" }}>••••••••</span>
          )}

          <button
            onClick={() => setShowId((v) => !v)}
            className="text-xs px-2 py-1 rounded-lg transition-colors"
            style={{ color: "#6b7280", backgroundColor: "#1a1d27" }}
          >
            {showId ? (t("hide") || "Hide") : (t("show") || "Show")}
          </button>

          {showId && installId && (
            <button
              onClick={handleCopyId}
              className="p-1 rounded-lg transition-colors"
              style={{ color: copied ? "#22c55e" : "#6b7280", backgroundColor: "#1a1d27" }}
              title={t("copy") || "Copy"}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
            </button>
          )}
        </div>
      </div>

      {/* Retry button — only in offline mode */}
      {status === "offline" && (
        <button
          onClick={handleRetry}
          disabled={retrying}
          className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors"
          style={{
            backgroundColor: "rgba(234,179,8,0.1)",
            color: "#eab308",
            border: "1px solid rgba(234,179,8,0.25)",
            opacity: retrying ? 0.6 : 1,
            cursor: retrying ? "not-allowed" : "pointer",
          }}
        >
          <RefreshCw size={13} className={retrying ? "animate-spin" : ""} />
          {retrying
            ? (t("license_retrying") || "Retrying…")
            : (t("license_retry") || "Retry Connection")}
        </button>
      )}
    </div>
  );
}

// ── Usage inside Settings.jsx ────────────────────────────────
// Import and drop this anywhere in your Settings page render:
//
//   import { LicenseSection } from "../components/LicenseSection";
//   ...
//   <LicenseSection />
//
// Or paste the component directly into Settings.jsx if preferred.
