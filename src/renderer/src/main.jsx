import ReactDOM from 'react-dom/client'
import App from './App'
import './app.css'

// Forward any uncaught renderer error to the main-process diagnostics log so a
// blank/broken screen during the demo leaves a trace that can be collected.
function reportToMain(source, message, extra) {
  try {
    window.api?.logDiagnostic?.({ level: 'ERROR', source, message, extra })
  } catch {
    /* diagnostics must never break the app */
  }
}

window.addEventListener('error', (event) => {
  reportToMain('window.onerror', event.message, {
    stack: event.error?.stack,
    filename: event.filename,
    lineno: event.lineno,
    colno: event.colno
  })
})

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason
  reportToMain('unhandledrejection', reason?.message || String(reason), { stack: reason?.stack })
})

ReactDOM.createRoot(document.getElementById('root')).render(<App />)
