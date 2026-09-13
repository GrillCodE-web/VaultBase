import { Component } from 'react'

// ErrorBoundary (мастер-план §9): падение одной страницы не должно давать
// белый экран всего приложения. resetKey (текущая страница) сбрасывает
// застрявший error-экран при навигации.
// SPEC-B (bd4): паритет с воркером — свёрнутые детали ошибки (message +
// componentStack) и 2 кнопки восстановления.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null, errorInfo: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null, errorInfo: null })
    }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info)
    this.setState({ error, errorInfo: info })
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null, errorInfo: null })
    this.props.onReset?.()
  }

  handleReload = () => {
    window.location.reload()
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="panel" style={{ margin: 24 }}>
        <h3>{this.props.title || 'Что-то пошло не так'}</h3>
        <div className="error-box">
          {String(this.state.error?.message || this.state.error || 'unknown error')}
        </div>
        {this.state.error && (
          <details className="error-details">
            <summary>Детали ошибки</summary>
            <pre>
              {this.state.error.toString()}
              {this.state.errorInfo?.componentStack || ''}
            </pre>
          </details>
        )}
        <div className="error-actions">
          <button className="btn" onClick={this.handleRetry}>
            Попробовать снова
          </button>
          <button className="btn btn-ghost" onClick={this.handleReload}>
            Перезагрузить
          </button>
        </div>
      </div>
    )
  }
}
