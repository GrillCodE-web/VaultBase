import { useEffect, useState } from 'react'
import { useLang } from './hooks/useLang.jsx'
import { getAppState } from './api/server.js'
import Activate from './pages/Activate.jsx'
import SetupMaster from './pages/SetupMaster.jsx'
import Unlock from './pages/Unlock.jsx'
import Shell from './pages/Shell.jsx'

export default function App() {
  const { t } = useLang()
  const [state, setState] = useState(null)
  const [error, setError] = useState('')

  const load = () => {
    setError('')
    getAppState()
      .then(setState)
      .catch((e) => setError(String(e)))
  }

  useEffect(load, [])

  if (error) {
    return (
      <div className="center-screen">
        <div className="auth-card">
          <div className="error-box">{error}</div>
          <button className="btn primary" onClick={load}>{t('retry')}</button>
        </div>
      </div>
    )
  }

  if (!state) {
    return <div className="center-screen">{t('loading')}</div>
  }

  switch (state.phase) {
    case 'not_activated':
      return <Activate appState={state} onDone={load} />
    case 'needs_master':
      return <SetupMaster onDone={load} />
    case 'locked':
      return <Unlock onDone={load} />
    default:
      return <Shell appState={state} onLock={load} />
  }
}
