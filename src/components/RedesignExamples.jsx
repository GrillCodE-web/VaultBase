// ═══════════════════════════════════════════════════════════
// EXAMPLE COMPONENTS — Cyber-Financial Terminal
// React components using the redesigned styles
// ═══════════════════════════════════════════════════════════

import { useState } from 'react'
import {
  CreditCard,
  AlertTriangle,
  CheckCircle,
  X,
  Search,
  Filter,
  Download,
  Upload,
  MoreVertical,
} from 'lucide-react'

// ─── Dashboard Stat Card ────────────────────────────────────
export function StatCard({ label, value, change, trend, color = 'cg' }) {
  return (
    <div className={`sc ${color} stagger-item`}>
      <div className="sc-lbl">{label}</div>
      <div className="sc-val">{value}</div>
      {change && <div className={`sc-sub ${trend === 'up' ? 'up' : 'dn'}`}>{change}</div>}
    </div>
  )
}

// Usage:
// <StatCard
//   label="Total Revenue"
//   value="$24.5k"
//   change="+12.5% from last month"
//   trend="up"
//   color="cg"
// />

// ─── Card Row Component ─────────────────────────────────────
export function CardRow({ card, selected, onSelect, onAction }) {
  const [showMenu, setShowMenu] = useState(false)

  const getHealthBadge = () => {
    if (card.status === 'dead') {
      return (
        <span className="card-health burned">
          <span className="card-health-dot"></span>
          Burned
        </span>
      )
    }
    if (card.status === 'in_use') {
      return (
        <span className="card-health used">
          <span className="card-health-dot"></span>
          Used
        </span>
      )
    }
    return (
      <span className="card-health fresh">
        <span className="card-health-dot"></span>
        Fresh
      </span>
    )
  }

  return (
    <tr className={`card-row ${selected ? 'selected' : ''}`}>
      <td>
        <input
          type="checkbox"
          className="checkbox"
          checked={selected}
          onChange={() => onSelect(card.id)}
        />
      </td>
      <td>
        <div className="card-number">
          <span className="card-number-masked">****</span>
          <span className="card-number-last4">{card.last4}</span>
        </div>
      </td>
      <td>{getHealthBadge()}</td>
      <td>
        <span className="network-badge visa">{card.network}</span>
      </td>
      <td>
        <span className="card-expiry valid">{card.expiry}</span>
      </td>
      <td>{card.bank}</td>
      <td>
        <span className="font-mono">{card.orders_count}</span>
      </td>
      <td>
        <div style={{ position: 'relative' }}>
          <button className="icon-btn" onClick={() => setShowMenu(!showMenu)}>
            <MoreVertical size={16} />
          </button>
          {showMenu && (
            <div className="card-actions-menu">
              <div className="card-actions-group">
                <button className="card-action-item" onClick={() => onAction('view')}>
                  <CreditCard className="card-action-icon" size={16} />
                  View Details
                </button>
                <button className="card-action-item" onClick={() => onAction('copy')}>
                  <CheckCircle className="card-action-icon" size={16} />
                  Copy Data
                </button>
              </div>
              <div className="card-actions-group">
                <button className="card-action-item danger" onClick={() => onAction('delete')}>
                  <X className="card-action-icon" size={16} />
                  Mark as Dead
                </button>
              </div>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

// ─── Filter Bar Component ───────────────────────────────────
export function FilterBar({ filters, onFilterChange, onClear }) {
  return (
    <div className="filters-bar">
      <div className="filter-group">
        <span className="filter-label">Status</span>
        <select
          className="filter-select"
          value={filters.status}
          onChange={e => onFilterChange('status', e.target.value)}
        >
          <option value="all">All Cards</option>
          <option value="free">Fresh</option>
          <option value="in_use">In Use</option>
          <option value="dead">Burned</option>
        </select>
      </div>

      <div className="filter-group">
        <span className="filter-label">Bank</span>
        <select
          className="filter-select"
          value={filters.bank}
          onChange={e => onFilterChange('bank', e.target.value)}
        >
          <option value="all">All Banks</option>
          <option value="chase">Chase</option>
          <option value="bofa">Bank of America</option>
          <option value="wells">Wells Fargo</option>
        </select>
      </div>

      <div className="filter-search">
        <input
          type="text"
          className="filter-search-input"
          placeholder="Search cards..."
          value={filters.search}
          onChange={e => onFilterChange('search', e.target.value)}
        />
        <Search className="filter-search-icon" size={16} />
      </div>

      <div className="filter-actions">
        <button className="filter-clear" onClick={onClear}>
          <X size={14} />
          Clear
        </button>
      </div>
    </div>
  )
}

// ─── Bulk Actions Toolbar ───────────────────────────────────
export function BulkActionsBar({ selectedCount, onExport, onDelete, onDeselect }) {
  return (
    <div className="bulk-actions-bar">
      <div className="bulk-actions-text">
        <span className="bulk-actions-count">{selectedCount}</span>
        cards selected
      </div>
      <div className="bulk-actions-buttons">
        <button className="btn btn-sm btn-b btn-icon" onClick={onExport}>
          <Download size={14} />
          Export
        </button>
        <button className="btn btn-sm btn-r btn-icon" onClick={onDelete}>
          <X size={14} />
          Mark Dead
        </button>
        <button className="btn btn-sm btn-ghost" onClick={onDeselect}>
          Clear
        </button>
      </div>
    </div>
  )
}

// ─── Info Panel Component ───────────────────────────────────
export function InfoPanel({ type = 'info', title, message, icon: Icon }) {
  return (
    <div className={`info-panel ${type}`}>
      <div className="info-panel-icon">{Icon && <Icon size={20} />}</div>
      <div className="info-panel-content">
        <div className="info-panel-title">{title}</div>
        <div className="info-panel-text">{message}</div>
      </div>
    </div>
  )
}

// Usage:
// <InfoPanel
//   type="success"
//   title="Cards Imported"
//   message="Successfully imported 150 cards from CSV file."
//   icon={CheckCircle}
// />

// ─── Modal Component ────────────────────────────────────────
export function Modal({ isOpen, onClose, title, children, footer }) {
  if (!isOpen) return null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-title">
          <span>{title}</span>
          <button className="modal-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

// Usage:
// <Modal
//   isOpen={showModal}
//   onClose={() => setShowModal(false)}
//   title="Add New Card"
//   footer={
//     <>
//       <button className="btn btn-ghost" onClick={() => setShowModal(false)}>
//         Cancel
//       </button>
//       <button className="btn btn-accent" onClick={handleSave}>
//         Save Card
//       </button>
//     </>
//   }
// >
//   <form>...</form>
// </Modal>

// ─── Toast Notification ─────────────────────────────────────
export function Toast({ type = 'info', title, message }) {
  const icons = {
    success: CheckCircle,
    error: AlertTriangle,
    warning: AlertTriangle,
    info: AlertTriangle,
  }

  const Icon = icons[type]

  return (
    <div className={`toast ${type}`}>
      <Icon className="toast-icon" size={20} />
      <div className="toast-content">
        <div className="toast-title">{title}</div>
        <div className="toast-message">{message}</div>
      </div>
      <div className="toast-progress"></div>
    </div>
  )
}

// ─── Page Header Component ──────────────────────────────────
export function PageHeader({ title, subtitle, actions }) {
  return (
    <div className="page-header">
      <div>
        <h1 className="page-title">{title}</h1>
        {subtitle && <p className="page-subtitle">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

// Usage:
// <PageHeader
//   title="Credit Cards"
//   subtitle="Manage your card inventory"
//   actions={
//     <>
//       <button className="btn btn-ghost btn-icon">
//         <Filter size={16} />
//         Filters
//       </button>
//       <button className="btn btn-accent btn-icon">
//         <Upload size={16} />
//         Import
//       </button>
//     </>
//   }
// />

// ─── Side Panel Component ───────────────────────────────────
export function SidePanel({ isOpen, onClose, title, children, footer }) {
  if (!isOpen) return null

  return (
    <>
      <div className="side-panel-overlay" onClick={onClose} />
      <div className="side-panel">
        <div className="side-panel-header">
          <h2 className="side-panel-title">{title}</h2>
          <button className="side-panel-close" onClick={onClose}>
            <X size={20} />
          </button>
        </div>
        <div className="side-panel-body">{children}</div>
        {footer && <div className="side-panel-footer">{footer}</div>}
      </div>
    </>
  )
}

// ─── Complete Page Example ──────────────────────────────────
export function CardsPageExample() {
  const [selectedCards, setSelectedCards] = useState([])
  const [filters, setFilters] = useState({
    status: 'all',
    bank: 'all',
    search: '',
  })

  const cards = [
    {
      id: 1,
      last4: '4242',
      status: 'free',
      network: 'VISA',
      expiry: '12/26',
      bank: 'Chase',
      orders_count: 0,
    },
    {
      id: 2,
      last4: '8888',
      status: 'in_use',
      network: 'MC',
      expiry: '03/27',
      bank: 'BofA',
      orders_count: 3,
    },
    {
      id: 3,
      last4: '1234',
      status: 'dead',
      network: 'AMEX',
      expiry: '08/25',
      bank: 'Wells',
      orders_count: 12,
    },
  ]

  return (
    <div className="content-main">
      <PageHeader
        title="Credit Cards"
        subtitle="Manage your card inventory"
        actions={
          <>
            <button className="btn btn-ghost btn-icon">
              <Filter size={16} />
              Filters
            </button>
            <button className="btn btn-accent btn-icon">
              <Upload size={16} />
              Import
            </button>
          </>
        }
      />

      <FilterBar
        filters={filters}
        onFilterChange={(key, value) => setFilters({ ...filters, [key]: value })}
        onClear={() => setFilters({ status: 'all', bank: 'all', search: '' })}
      />

      {selectedCards.length > 0 && (
        <BulkActionsBar
          selectedCount={selectedCards.length}
          onExport={() => {
            /* Export action */
          }}
          onDelete={() => {
            /* Delete action */
          }}
          onDeselect={() => setSelectedCards([])}
        />
      )}

      <div className="panel">
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: '40px' }}></th>
              <th>Card Number</th>
              <th>Status</th>
              <th>Network</th>
              <th>Expiry</th>
              <th>Bank</th>
              <th>Orders</th>
              <th style={{ width: '60px' }}></th>
            </tr>
          </thead>
          <tbody>
            {cards.map(card => (
              <CardRow
                key={card.id}
                card={card}
                selected={selectedCards.includes(card.id)}
                onSelect={id => {
                  setSelectedCards(prev =>
                    prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
                  )
                }}
                onAction={() => {
                  /* Handle action */
                }}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export default {
  StatCard,
  CardRow,
  FilterBar,
  BulkActionsBar,
  InfoPanel,
  Modal,
  Toast,
  PageHeader,
  SidePanel,
  CardsPageExample,
}
