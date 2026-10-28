import { defineConfig, loadEnv, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'

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

// Writes a .br and .gz copy beside each script and stylesheet, which the Pi
// sends instead of the original to browsers that take them
// (raspberry_pi/web_files.py). About 1 MB of startup code becomes about 0.2 MB,
// and the Pi does no compressing per request. One file at a time, so a build on
// the Pi stays inside its memory cap.
function precompress(): Plugin {
  let outDir = 'dist'
  return {
    name: 'precompress',
    apply: 'build',
    configResolved(config) { outDir = config.build.outDir },
    closeBundle() {
      const dir = path.resolve(outDir, 'assets')
      if (!fs.existsSync(dir)) return
      for (const name of fs.readdirSync(dir)) {
        if (!/\.(js|css|svg|json)$/.test(name)) continue
        const file = path.join(dir, name)
        const raw = fs.readFileSync(file)
        if (raw.length < 1024) continue
        const br = zlib.brotliCompressSync(raw, { params: {
          [zlib.constants.BROTLI_PARAM_QUALITY]: 9,
          [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
        } })
        const gz = zlib.gzipSync(raw, { level: 9 })
        if (br.length < raw.length) fs.writeFileSync(file + '.br', br)
        if (gz.length < raw.length) fs.writeFileSync(file + '.gz', gz)
      }
    },
  }
}

// A stylesheet in <head> holds back every paint until it arrives, so after the
// password the window stayed blank (white or black) while ~200 kB of CSS
// downloaded. Moved to the end of <body>, after the splash and its animation,
// the splash (styled inline) paints and moves at once. The app's script moves with it and stays after it, so it
// still runs only once the stylesheet is in.
function splashFirst(): Plugin {
  return {
    name: 'splash-first',
    apply: 'build',
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        if (!html.includes('</body>')) return html
        const moved: string[] = []
        const take = (re: RegExp) => { html = html.replace(re, m => { moved.push(m.trim()); return '' }) }
        take(/\s*<link rel="stylesheet"[^>]*>/g)
        take(/\s*<script type="module"[^>]*><\/script>/g)
        if (!moved.length) return html
        const spot = html.lastIndexOf('</body>')
        return html.slice(0, spot) + moved.join('\n    ') + '\n    ' + html.slice(spot)
      },
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
    plugins: [react(), excalidrawFonts(), precompress(), splashFirst()],
    define,
  }
})
