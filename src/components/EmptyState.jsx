export function EmptyState({ icon, title, subtitle, action, colSpan }) {
  const inner = (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      justifyContent: "center", padding: "52px 20px", gap: 10,
    }}>
      <div style={{ fontSize: 38, opacity: 0.25, lineHeight: 1 }}>{icon}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", marginTop: 4 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 12, color: "var(--muted)", textAlign: "center", maxWidth: 260 }}>{subtitle}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );

  if (colSpan) {
    return <tr><td colSpan={colSpan} style={{ padding: 0 }}>{inner}</td></tr>;
  }
  return inner;
}
