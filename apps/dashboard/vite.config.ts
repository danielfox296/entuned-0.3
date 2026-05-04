import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dashboard is served from app.entuned.co root, so base must be '/' (not './')
// — react-router-dom needs absolute asset paths to handle deep links cleanly.
//
// Port 5179: server=3000, player=5177, admin=5178, dashboard=5179.
// Follows the existing 51xx convention for v0.3 web apps.
export default defineConfig({
  plugins: [react()],
  base: '/',
  server: { port: 5179, strictPort: true },
})
