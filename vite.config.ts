import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env }
  const usesPi = Boolean((env.VITE_PI_BACKEND_URL || '').trim())
  const define: Record<string, string> = {}

  // Every VITE_ value ends up in the JavaScript anyone who opens the app can read.
  if (usesPi) {
    // The browser talks only to the Pi, which forwards backups to Apps Script
    // itself, so the Apps Script key has no business in this build.
    define['import.meta.env.VITE_GAS_AUTH_KEY'] = JSON.stringify('')
    if (env.VITE_PI_API_KEY) {
      console.warn('\n[sage] VITE_PI_API_KEY is set, so the Pi server key is readable by anyone who can load the app. Leave it empty and enter the key under Settings instead.\n')
    }
  }

  return {
    plugins: [react()],
    define,
  }
})
