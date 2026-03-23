export function EmptyState({ icon, title, subtitle, action, colSpan }) {
  const inner = (
    <div className="flex flex-col items-center justify-center gap-2.5 py-[52px] px-5">
      <div style={{ fontSize: 38, lineHeight: 1 }} className="opacity-25">
        {icon}
      </div>
      <div className="text-[14px] font-semibold text-text mt-1">{title}</div>
      {subtitle && (
        <div className="text-[12px] text-muted text-center" style={{ maxWidth: 260 }}>
          {subtitle}
        </div>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  )

  if (colSpan) {
    return (
      <tr>
        <td colSpan={colSpan} className="p-0">
          {inner}
        </td>
      </tr>
    )
  }
  return inner
}
