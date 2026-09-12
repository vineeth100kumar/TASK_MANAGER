/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class',
  theme: {
    extend: {
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
