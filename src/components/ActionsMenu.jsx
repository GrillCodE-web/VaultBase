import { useState, useRef, useEffect } from "react";
import { MoreHorizontal } from "lucide-react";

/**
 * ActionsMenu — contextual ⋮ dropdown for table row actions.
 *
 * Props:
 *   items: Array<{ label, icon: LucideComponent, onClick, danger?, divider? }>
 *   align: "left" | "right" (default "right")
 */
export function ActionsMenu({ items = [], align = "right" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const btnRef = useRef(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const toggle = (e) => {
    e.stopPropagation();
    if (!open && btnRef.current) {
      const rect = btnRef.current.getBoundingClientRect();
      setPos({
        top: rect.bottom + 4,
        left: align === "right" ? rect.right - 160 : rect.left,
      });
    }
    setOpen((v) => !v);
  };

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block" }}>
      <button
        ref={btnRef}
        onClick={toggle}
        className="btn btn-ghost btn-sm btn-icon-only"
        title="Actions"
        style={{ width: 26, height: 26 }}
      >
        <MoreHorizontal size={14} />
      </button>

      {open && (
        <div
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            width: 160,
            background: "var(--card-hi)",
            border: "1px solid var(--border-hi)",
            borderRadius: "var(--r-md)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.5)",
            zIndex: 9999,
            overflow: "hidden",
          }}
        >
          {items.map((item, i) => {
            if (item.divider) {
              return <div key={i} style={{ height: 1, background: "var(--border)", margin: "3px 0" }} />;
            }
            const Icon = item.icon;
            return (
              <button
                key={i}
                onClick={(e) => { e.stopPropagation(); setOpen(false); item.onClick?.(); }}
                style={{
                  width: "100%", padding: "7px 12px", border: "none", background: "transparent",
                  textAlign: "left", cursor: "pointer", fontSize: 12, fontFamily: "'DM Sans', sans-serif",
                  display: "flex", alignItems: "center", gap: 8,
                  color: item.danger ? "var(--red-t)" : "var(--text)",
                  transition: "background var(--t-fast)",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--hover)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                {Icon && <Icon size={13} style={{ flexShrink: 0, opacity: 0.8 }} />}
                {item.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
