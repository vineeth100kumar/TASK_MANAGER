import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'

// Serves Excalidraw's fonts (used by the Canvas view) from the app itself, so
// drawings look right on a Pi with no internet. The Chinese/Japanese font is
// 13 MB and left out; Excalidraw fetches it from its CDN when it's needed.
function excalidrawFonts(): Plugin {
  const src = path.resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts')
  const skip = (name: string) => name === 'Xiaolai'
  let outDir = 'dist'
  return {
    name: 'excalidraw-fonts',
    configResolved(config) { outDir = config.build.outDir },
    configureServer(server) {
      server.middlewares.use('/excalidraw-assets/fonts', (req, res, next) => {
        const file = path.join(src, decodeURIComponent((req.url || '').split('?')[0]))
        if (!file.startsWith(src) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next()
        res.setHeader('Content-Type', 'font/woff2')
        fs.createReadStream(file).pipe(res)
      })
    },
    closeBundle() {
      const dest = path.resolve(outDir, 'excalidraw-assets/fonts')
      for (const name of fs.readdirSync(src)) {
        if (!skip(name)) fs.cpSync(path.join(src, name), path.join(dest, name), { recursive: true })
      }
    },
  }
}

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
    plugins: [react(), excalidrawFonts()],
    define,
  }
})
