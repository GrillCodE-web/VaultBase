import { useState } from 'react'
import { handleError } from '../utils/errorHandler.js'
import { invoke } from '@tauri-apps/api/core'
import { CreditCard, Mail, User, ShoppingCart, CheckCircle, ChevronRight } from 'lucide-react'

const STEPS = [
  {
    id: 'cards',
    icon: CreditCard,
    title: 'Import Cards',
    desc: 'Import your first credit cards to get started',
    page: 'cards',
    checkFn: async () => {
      const r = await invoke('get_cards', { page: 1, perPage: 1 })
      return r.total > 0
    },
  },
  {
    id: 'imap',
    icon: Mail,
    title: 'Add Email Account',
    desc: 'Connect an IMAP email account for order confirmations',
    page: 'imap',
    checkFn: async () => {
      const r = await invoke('get_imap_accounts', {})
      return r.length > 0
    },
  },
  {
    id: 'profile',
    icon: User,
    title: 'Create Profile',
    desc: 'Create a buyer profile with billing & shipping info',
    page: 'profiles',
    checkFn: async () => {
      const r = await invoke('get_profiles', { page: 1, perPage: 1 })
      return r.total > 0
    },
  },
  {
    id: 'order',
    icon: ShoppingCart,
    title: 'Make First Order',
    desc: 'Create your first order',
    page: 'orders',
    checkFn: async () => {
      const r = await invoke('get_orders', { page: 1, perPage: 1 })
      return r.total > 0
    },
  },
]

export default function Onboarding({ onComplete, onNavigate }) {
  const [completed, setCompleted] = useState({})
  const [checking, setChecking] = useState(false)

  const checkStep = async step => {
    setChecking(true)
    try {
      const done = await step.checkFn()
      if (done) setCompleted(prev => ({ ...prev, [step.id]: true }))
    } catch (e) {
      handleError(e)
      // Step check failed, ignore
    }
    setChecking(false)
  }

  const completedCount = Object.keys(completed).length
  const allDone = completedCount >= STEPS.length

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-10 gap-8 bg-bg">
      <div className="text-center">
        <h1 className="text-28 font-bold mb-2 text-text">Welcome to VaultBase</h1>
        <p className="text-muted text-14">Complete these steps to get started</p>
      </div>

      <div className="w-full max-w-[480px] bg-surface rounded-xl overflow-hidden border">
        {/* Progress bar */}
        <div className="h-1 bg-surface">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${(completedCount / STEPS.length) * 100}%` }}
          />
        </div>
        <div className="p-[12px_20px] text-12 text-muted border-b">
          Setup: {completedCount}/{STEPS.length} steps
        </div>

        {STEPS.map(step => {
          const done = completed[step.id]
          const Icon = step.icon
          return (
            <div
              key={step.id}
              className="flex items-center gap-4 p-[16px_20px] border-b"
              style={{ opacity: done ? 0.7 : 1 }}
            >
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
                style={{ background: done ? 'var(--accent)' : 'var(--surface)' }}
              >
                {done ? (
                  <CheckCircle size={18} color="var(--bg)" />
                ) : (
                  <Icon size={18} color="var(--text-3)" />
                )}
              </div>
              <div className="flex-1">
                <div className="font-semibold text-14 mb-0.5 text-text">{step.title}</div>
                <div className="text-12 text-muted">{step.desc}</div>
              </div>
              {!done && (
                <div className="flex gap-2">
                  <button className="btn btn-s" onClick={() => checkStep(step)} disabled={checking}>
                    Check
                  </button>
                  <button
                    className="btn btn-b btn-s flex items-center gap-1"
                    onClick={() => onNavigate(step.page)}
                  >
                    Go <ChevronRight size={12} />
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {allDone && (
        <div className="text-center">
          <p className="text-accent mb-4 font-semibold">All steps complete!</p>
          <button className="btn btn-b" onClick={onComplete}>
            Start Using VaultBase
          </button>
        </div>
      )}
      {!allDone && (
        <button
          className="text-muted bg-transparent border-none cursor-pointer text-13"
          onClick={onComplete}
        >
          Skip setup
        </button>
      )}
    </div>
  )
}
