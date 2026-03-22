import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { CreditCard, Mail, User, ShoppingCart, CheckCircle, ChevronRight } from "lucide-react";

const STEPS = [
  {
    id: "cards",
    icon: CreditCard,
    title: "Import Cards",
    desc: "Import your first credit cards to get started",
    page: "cards",
    checkFn: async () => {
      const r = await invoke("get_cards", { page: 1, perPage: 1 });
      return r.total > 0;
    },
  },
  {
    id: "imap",
    icon: Mail,
    title: "Add Email Account",
    desc: "Connect an IMAP email account for order confirmations",
    page: "imap",
    checkFn: async () => {
      const r = await invoke("get_imap_accounts", {});
      return r.length > 0;
    },
  },
  {
    id: "profile",
    icon: User,
    title: "Create Profile",
    desc: "Create a buyer profile with billing & shipping info",
    page: "profiles",
    checkFn: async () => {
      const r = await invoke("get_profiles", { page: 1, perPage: 1 });
      return r.total > 0;
    },
  },
  {
    id: "order",
    icon: ShoppingCart,
    title: "Make First Order",
    desc: "Create your first order",
    page: "orders",
    checkFn: async () => {
      const r = await invoke("get_orders", { page: 1, perPage: 1 });
      return r.total > 0;
    },
  },
];

export default function Onboarding({ onComplete, onNavigate }) {
  const [completed, setCompleted] = useState({});
  const [checking, setChecking] = useState(false);

  const checkStep = async (step) => {
    setChecking(true);
    try {
      const done = await step.checkFn();
      if (done) setCompleted((prev) => ({ ...prev, [step.id]: true }));
    } catch {
      // Step check failed, ignore
    }
    setChecking(false);
  };

  const completedCount = Object.keys(completed).length;
  const allDone = completedCount >= STEPS.length;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh",
        padding: 40,
        gap: 32,
        background: "var(--bg)",
      }}
    >
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontSize: 28, fontWeight: 700, marginBottom: 8, color: "var(--text)" }}>
          Welcome to CC Manager
        </h1>
        <p style={{ color: "var(--muted)", fontSize: 14 }}>
          Complete these steps to get started
        </p>
      </div>

      <div
        style={{
          width: "100%",
          maxWidth: 480,
          background: "var(--surface)",
          borderRadius: 12,
          overflow: "hidden",
          border: "1px solid var(--border)",
        }}
      >
        {/* Progress bar */}
        <div style={{ height: 4, background: "var(--surface2)" }}>
          <div
            style={{
              height: "100%",
              width: `${(completedCount / STEPS.length) * 100}%`,
              background: "var(--accent)",
              transition: "width 0.3s",
            }}
          />
        </div>
        <div
          style={{
            padding: "12px 20px",
            fontSize: 12,
            color: "var(--muted)",
            borderBottom: "1px solid var(--border)",
          }}
        >
          Setup: {completedCount}/{STEPS.length} steps
        </div>

        {STEPS.map((step) => {
          const done = completed[step.id];
          const Icon = step.icon;
          return (
            <div
              key={step.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                padding: "16px 20px",
                borderBottom: "1px solid var(--border)",
                opacity: done ? 0.7 : 1,
              }}
            >
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: "50%",
                  background: done ? "var(--accent)" : "var(--surface2)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  flexShrink: 0,
                }}
              >
                {done ? (
                  <CheckCircle size={18} color="var(--bg)" />
                ) : (
                  <Icon size={18} color="var(--subtle)" />
                )}
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 2, color: "var(--text)" }}>
                  {step.title}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)" }}>{step.desc}</div>
              </div>
              {!done && (
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    className="btn btn-s"
                    onClick={() => checkStep(step)}
                    disabled={checking}
                  >
                    Check
                  </button>
                  <button
                    className="btn btn-b btn-s"
                    onClick={() => onNavigate(step.page)}
                    style={{ display: "flex", alignItems: "center", gap: 4 }}
                  >
                    Go <ChevronRight size={12} />
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {allDone && (
        <div style={{ textAlign: "center" }}>
          <p style={{ color: "var(--accent)", marginBottom: 16, fontWeight: 600 }}>
            All steps complete!
          </p>
          <button className="btn btn-b" onClick={onComplete}>
            Start Using CC Manager
          </button>
        </div>
      )}
      {!allDone && (
        <button
          style={{
            color: "var(--muted)",
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 13,
          }}
          onClick={onComplete}
        >
          Skip setup
        </button>
      )}
    </div>
  );
}
