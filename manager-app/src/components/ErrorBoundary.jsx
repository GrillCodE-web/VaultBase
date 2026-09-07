import { Component } from 'react'

// ErrorBoundary (мастер-план §9): падение одной страницы не должно давать
// белый экран всего приложения. resetKey (текущая страница) сбрасывает
// застрявший error-экран при навигации.
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidUpdate(prevProps) {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false, error: null })
    }
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="panel" style={{ margin: 24 }}>
        <h3>{this.props.title || 'Что-то пошло не так'}</h3>
        <div className="error-box">
          {String(this.state.error?.message || this.state.error || 'unknown error')}
        </div>
        <button className="btn" onClick={() => this.setState({ hasError: false, error: null })}>
          Попробовать снова
        </button>
      </div>
    )
  }
}
