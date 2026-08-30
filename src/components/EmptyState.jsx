// REDESIGN-05-2: пустое состояние переведено с инлайн/Tailwind-литералов
// на семантические классы empty-state* (components.css). Визуал тот же.
export function EmptyState({ icon, title, subtitle, action, colSpan }) {
  const inner = (
    <div className="empty-state">
      {icon && <div className="empty-state-icon">{icon}</div>}
      <div className="empty-state-title">{title}</div>
      {subtitle && <div className="empty-state-text">{subtitle}</div>}
      {action && <div className="empty-state-action">{action}</div>}
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
