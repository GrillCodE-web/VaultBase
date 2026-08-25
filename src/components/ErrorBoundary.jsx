import React from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'
import { HEX_COLORS } from '../constants/colors.js'

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

  componentDidUpdate(prevProps) {
    // Смена страницы (resetKey) сбрасывает застрявший экран ошибки — иначе
    // после падения одной страницы error-экран остаётся на всех остальных.
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null, errorInfo: null })
    }
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
        <div className="min-h-screen flex items-center justify-center bg-bg p-5">
          <div className="w-full card text-center" style={{ maxWidth: '500px', padding: '32px' }}>
            {/* Icon */}
            <div
              className="flex items-center justify-center mx-auto mb-5"
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '12px',
                background: 'var(--color-error-bg)',
              }}
            >
              <AlertTriangle size={32} style={{ color: HEX_COLORS.red }} />
            </div>

            {/* Title */}
            <h1 className="text-lg font-semibold text-text mb-2">Something went wrong</h1>

            {/* Description */}
            <p className="text-sm text-text-2 mb-6" style={{ lineHeight: 1.6 }}>
              An unexpected error occurred. You can try reloading the page or return to the
              dashboard.
            </p>

            {/* Error details (collapsed by default) */}
            {this.state.error && (
              <details
                className="mb-6 text-left bg-surface card-pad"
                style={{ borderRadius: '8px', padding: '12px' }}
              >
                <summary className="cursor-pointer text-xs text-muted font-medium">
                  Error details
                </summary>
                <pre
                  className="mt-3 text-xs text-text-2 mono"
                  style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}
                >
                  {this.state.error.toString()}
                  {this.state.errorInfo && this.state.errorInfo.componentStack}
                </pre>
              </details>
            )}

            {/* Action buttons */}
            <div className="flex gap-3 justify-center">
              <button onClick={this.handleReload} className="btn btn-b flex items-center gap-1.5">
                <RefreshCw size={14} />
                Reload
              </button>
              <button
                onClick={this.handleGoToDashboard}
                className="btn btn-ghost flex items-center gap-1.5"
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
