/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        masthead: ['Cinzel', 'Times New Roman', 'serif'],
        editorial: ['Newsreader', 'Georgia', 'serif'],
        ledger: ['"JetBrains Mono"', 'Menlo', 'monospace'],
      },
      colors: {
        apple: {
          gray: '#1c1c1e',
          card: '#2c2c2e',
          border: '#38383a',
          blue: '#0a84ff',
          green: '#30d158',
          orange: '#ff9f0a',
          red: '#ff453a',
          purple: '#bf5af2'
        },
        news: {
          ink: '#edece8',
          muted: '#9e9d96',
          paper: '#0d0d0f',
          surface: '#121216',
          card: '#16161a',
          rule: '#2a2a2f',
          accent: '#d97706',
          seal: '#c2410c'
        },
        paper: {
          base:   '#F5F1E8',   // main clipping background
          aged:   '#EDE3C8',   // yellowed clippings
          cream:  '#F7F2E5',   // slightly off-white
          white:  '#FAFAF8',   // freshest clippings
          board:  '#E8E0D0',   // cork board / background canvas
          dark:   '#1C1A16',   // night edition base
        },
        ink: {
          primary:  '#1A1814',
          muted:    '#5A5650',
          faint:    '#8A8780',
          rule:     '#C0B898',
          danger:   '#8B1A1A',
          success:  '#1A4A1A',
          amber:    '#8B5E00',
        }
      },
      borderRadius: {
        'clip': '1px',
      },
      padding: {
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
      }
    },
  },
  plugins: [],
}
