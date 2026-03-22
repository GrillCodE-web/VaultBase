import { MapPin, Users, ArrowRight } from "lucide-react";
import { useLang } from "../hooks/useLang";

export default function Drops() {
  const { t } = useLang();
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: "100%", gap: 20, textAlign: "center", padding: "0 32px" }}>
      <div style={{ width: 64, height: 64, borderRadius: 16, backgroundColor: "var(--accent-dim)", border: "1px solid var(--accent-border)", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <MapPin size={26} className="text-blue-t" />
      </div>
      <div className="flex flex-col gap-1.5">
        <h1 style={{ fontSize: 15, fontWeight: 600, color: "var(--text)" }}>{t("drops_managed_in_profiles")}</h1>
        <p style={{ fontSize: 13, maxWidth: 300, lineHeight: 1.6, color: "var(--muted)" }}>
          {t("drops_description")}
        </p>
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px", borderRadius: 10, backgroundColor: "var(--card)", border: "1px solid var(--border)", fontSize: 13, color: "var(--muted)" }}>
        <Users size={14} className="text-blue-t" />
        <span className="text-text">{t("nav_profiles")}</span>
        <ArrowRight size={12} />
        <span className="text-text">{t("drops_expand_row")}</span>
        <ArrowRight size={12} />
        <span className="text-text">{t("nav_drops_tab")}</span>
      </div>
    </div>
  );
}
