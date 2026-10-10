import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
// Imported from JS so Vite rewrites the font file URLs; an @import inside
// index.css is inlined by Tailwind and its relative url()s break.
import '@fontsource-variable/inter'
import './index.css'
import { registerServiceWorker } from './services/pushNotifications'

registerServiceWorker()

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
