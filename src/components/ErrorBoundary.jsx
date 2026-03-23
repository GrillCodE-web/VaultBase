import React from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'

/**
 * Error Boundary component to catch React errors and prevent white screen
 * Shows user-friendly error UI with recovery options
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    }
  }

  static getDerivedStateFromError(_error) {
    return { hasError: true }
  }

  componentDidCatch(error, errorInfo) {
    // Log error for debugging
    console.error('ErrorBoundary caught an error:', error, errorInfo)

    this.setState({
      error,
      errorInfo,
    })
  }

  handleReload = () => {
    window.location.reload()
  }

  handleGoToDashboard = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
    if (this.props.onReset) {
      this.props.onReset()
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--bg)',
            padding: '20px',
          }}
        >
          <div
            style={{
              maxWidth: '500px',
              width: '100%',
              background: 'var(--card)',
              border: '1px solid var(--border)',
              borderRadius: '14px',
              padding: '32px',
              textAlign: 'center',
            }}
          >
            {/* Icon */}
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '12px',
                background: 'rgba(239, 68, 68, 0.12)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 20px',
              }}
            >
              <AlertTriangle size={32} style={{ color: '#ef4444' }} />
            </div>

            {/* Title */}
            <h1
              style={{
                fontSize: '18px',
                fontWeight: 600,
                color: 'var(--text)',
                marginBottom: '8px',
              }}
            >
              Something went wrong
            </h1>

            {/* Description */}
            <p
              style={{
                fontSize: '13px',
                color: 'var(--text-2)',
                lineHeight: 1.6,
                marginBottom: '24px',
              }}
            >
              An unexpected error occurred. You can try reloading the page or return to the
              dashboard.
            </p>

            {/* Error details (collapsed by default) */}
            {this.state.error && (
              <details
                style={{
                  marginBottom: '24px',
                  textAlign: 'left',
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '8px',
                  padding: '12px',
                }}
              >
                <summary
                  style={{
                    cursor: 'pointer',
                    fontSize: '12px',
                    color: 'var(--muted)',
                    fontWeight: 500,
                  }}
                >
                  Error details
                </summary>
                <pre
                  style={{
                    marginTop: '12px',
                    fontSize: '11px',
                    color: 'var(--text-2)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    fontFamily: 'JetBrains Mono, monospace',
                  }}
                >
                  {this.state.error.toString()}
                  {this.state.errorInfo && this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}

            {/* Action buttons */}
            <div
              style={{
                display: 'flex',
                gap: '12px',
                justifyContent: 'center',
              }}
            >
              <button
                onClick={this.handleReload}
                className="btn btn-b"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <RefreshCw size={14} />
                Reload
              </button>
              <button
                onClick={this.handleGoToDashboard}
                className="btn btn-ghost"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                }}
              >
                <Home size={14} />
                Go to Dashboard
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

export default ErrorBoundary
