import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { QuickCapture } from './components/QuickCapture'
// Geist and Geist Mono ship with the app: no network, the same look offline.
import '@fontsource-variable/geist'
import '@fontsource-variable/geist-mono'
import '@fontsource/ibm-plex-mono/400.css'
import '@fontsource/ibm-plex-mono/500.css'
import '@fontsource/ibm-plex-mono/600.css'
import './tokens.css'
import { initTheme } from './lib/theme'
import { ErrorBoundary, logPageErrors } from './components/ErrorBoundary'

logPageErrors()

// The quick capture box is its own little window (main's capture.ts): the same page, just the box.
const capture = location.hash === '#capture'
if (capture) document.documentElement.style.background = 'transparent'

// The theme goes on before the first render, so the page never flashes another one.
window.api.prefs
  .get()
  .then((p) => initTheme(p.theme))
  .catch(() => initTheme('dark'))
  .finally(() =>
    ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
      <React.StrictMode>
        <ErrorBoundary what="Switchyard">{capture ? <QuickCapture /> : <App />}</ErrorBoundary>
      </React.StrictMode>
    )
  )
