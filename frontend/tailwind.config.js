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
        }
      },
      padding: {
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
      }
    },
  },
  plugins: [],
}
