import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// Imported from JS so Vite rewrites the font file URLs; an @import inside
// index.css is inlined by Tailwind and its relative url()s break.
import '@fontsource-variable/inter'
import '@fontsource-variable/fredoka'
import './index.css'
import { registerServiceWorker } from './services/pushNotifications'
import { applyLook, savedLook } from './utils/look'

// Before the first render, so the saved look doesn't flash in.
applyLook(savedLook())

registerServiceWorker()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
