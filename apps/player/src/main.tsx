import React from 'react'
import ReactDOM from 'react-dom/client'
import { App } from './App.js'
import { registerServiceWorker } from './lib/sw-register.js'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)

// Register the service worker after React mounts so the initial paint is never
// gated on SW activation. The registration handles push subscription, audio
// app-shell precaching, and auto-update on new deploys.
void registerServiceWorker()
