export function ColumnPicker({ visible, onChange, _onClose, allColumns, t }) {
  return (
    <div style={{
      position: "absolute", right: 0, top: 38, zIndex: 20,
      background: "var(--card)", border: "1px solid var(--border)",
      borderRadius: 10, boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
      padding: 10, minWidth: 180,
    }}>
      <p className="ptitle mb-2 pl-1" >{t("cc_columns")}</p>
      <button
        className="btn btn-ghost btn-sm w-full mb-2 text-[11px]"
        onClick={() => onChange(["card_number","expiry","cvv","holder","billing","zip","city","state","country","phone","status","actions"])}
      >
        {t("cards_carder_view")}
      </button>
      {allColumns.filter(c => c.id !== "actions").map(col => (
        <label key={col.id} style={{
          display: "flex", alignItems: "center", gap: 8,
          padding: "5px 8px", borderRadius: 6, cursor: "pointer",
          fontSize: 12, color: "var(--muted)",
        }}>
          <input
            type="checkbox"
            checked={visible.includes(col.id)}
            onChange={e => {
              if (e.target.checked) onChange([...visible, col.id]);
              else onChange(visible.filter(v => v !== col.id));
            }}
            className="accent-accent"
          />
          {t(col.label)}
        </label>
      ))}
    </div>
  );
}
