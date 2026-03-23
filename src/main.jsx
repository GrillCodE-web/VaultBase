import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { HEX_COLORS } from './constants/colors.js'
import './index.css'

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }
  static getDerivedStateFromError(error) {
    return { error }
  }
  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            minHeight: '100vh',
            backgroundColor: 'var(--bg)',
            color: HEX_COLORS.red,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '2rem',
            fontFamily: 'monospace',
          }}
        >
          <div style={{ fontSize: 14, marginBottom: 8, color: 'var(--text)' }}>
            ⚠ App crashed — check devtools console
          </div>
          <pre
            style={{ fontSize: 12, color: HEX_COLORS.red, whiteSpace: 'pre-wrap', maxWidth: 700 }}
          >
            {String(this.state.error)}
          </pre>
        </div>
      )
    }
    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
)
