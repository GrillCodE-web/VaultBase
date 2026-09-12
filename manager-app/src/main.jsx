import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import { LangProvider } from './hooks/useLang.jsx'
import './styles/manager.css'

// 7rn: тема применяется до первого рендера (и до логина), чтобы не было
// вспышки тёмной темы у тех, кто выбрал светлую.
try {
  if (localStorage.getItem('vb-mgr-theme') === 'light') {
    document.documentElement.dataset.theme = 'light'
  }
} catch {
  /* localStorage недоступен — остаётся тёмная тема по умолчанию */
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <LangProvider>
      <App />
    </LangProvider>
  </React.StrictMode>
)
