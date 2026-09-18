/** @type {import('tailwindcss').Config} */

/*
 * One palette, defined once.
 *
 * Semantic tokens (ground / surface / sunken / ink / hairline / accent / late /
 * done / danger) read from CSS custom properties declared in index.css, so day
 * and night are the same tokens resolving to different values rather than two
 * hand-written sets of overrides.
 *
 * The four ramps below replace the nine Tailwind colour families that had
 * accumulated in the app (stone, zinc, amber, rose, blue, emerald, indigo,
 * purple, red). Each old family is re-pointed at the ramp that carries its
 * meaning, so existing markup lands in the new system:
 *
 *   stone / zinc / gray / slate / neutral  -> neutral   (one grey, not two)
 *   amber / blue / indigo / purple / sky   -> accent    (Sage's blue)
 *   rose / red                             -> danger
 *   emerald / green / teal                 -> done
 *   yellow / orange                        -> late
 */

const token = (name) => `rgb(var(${name}) / <alpha-value>)`;

// Cool neutral — a grey with a slight blue bias, so it sits with the accent
// rather than fighting it.
const neutral = {
  50:  '#F6F6F8',
  100: '#ECECEF',
  200: '#DFDFE4',
  300: '#CBCCD3',
  400: '#A4A7AF',
  500: '#8E9199',
  600: '#6B6F78',
  700: '#4A4D54',
  800: '#2A2C32',
  900: '#1A1C20',
  950: '#0E0F12',
};

const accent = {
  50:  '#EAF2FF',
  100: '#D4E5FF',
  200: '#A9CBFF',
  300: '#7DB0FF',
  400: '#4D9BFF',
  500: '#0A6CFF',
  600: '#0A5FE0',
  700: '#0B4EB4',
  800: '#0B3F8D',
  900: '#0A3169',
  950: '#071F42',
};

const danger = {
  50:  '#FEF0EF',
  100: '#FDDCDA',
  200: '#FBB9B4',
  300: '#F5877F',
  400: '#EB5A4F',
  500: '#D93A2D',
  600: '#B3261E',
  700: '#8F1D17',
  800: '#6B1712',
  900: '#4D110E',
  950: '#2B0907',
};

const done = {
  50:  '#E9F7EF',
  100: '#CCEEDD',
  200: '#9CDCBB',
  300: '#6BC898',
  400: '#4CC98A',
  500: '#1C7A4A',
  600: '#17683E',
  700: '#125431',
  800: '#0E4126',
  900: '#0A2E1B',
  950: '#05190E',
};

const late = {
  50:  '#FDF4E7',
  100: '#FAE6C8',
  200: '#F2CC93',
  300: '#E7B063',
  400: '#D9A05B',
  500: '#A8641B',
  600: '#8C5215',
  700: '#6F4111',
  800: '#53310D',
  900: '#3A2209',
  950: '#1F1205',
};

export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        // The system face, at every role. Nothing to download.
        sans: [
          '-apple-system', 'BlinkMacSystemFont', 'SF Pro Text', 'Segoe UI',
          'Roboto', 'Helvetica', 'Arial', 'sans-serif',
        ],
        mono: [
          'ui-monospace', 'SF Mono', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace',
        ],
      },

      fontSize: {
        // Four sizes and a caption floor at 11px. Nothing smaller ships.
        'caption': ['11px', { lineHeight: '15px', letterSpacing: '0.005em' }],
        'meta':    ['13px', { lineHeight: '18px' }],
        'body':    ['16px', { lineHeight: '22px', letterSpacing: '-0.011em' }],
        'lead':    ['17px', { lineHeight: '23px', letterSpacing: '-0.015em' }],
        'title':   ['22px', { lineHeight: '27px', letterSpacing: '-0.021em' }],
        'display': ['31px', { lineHeight: '34px', letterSpacing: '-0.028em' }],
      },

      colors: {
        // --- semantic tokens (preferred in new code) ---
        ground:   token('--c-ground'),
        surface:  token('--c-surface'),
        sunken:   token('--c-sunken'),
        hairline: token('--c-hairline'),
        ink: {
          DEFAULT: token('--c-ink'),
          2:       token('--c-ink-2'),
          3:       token('--c-ink-3'),

          // Compatibility with the names the existing views already use, so
          // markup that has not been rewritten yet still resolves.
          base:    token('--c-ink'),
          primary: token('--c-ink'),
          muted:   token('--c-ink-2'),
          faint:   token('--c-ink-3'),
          rule:    token('--c-hairline'),
          danger:  token('--c-danger'),
          success: token('--c-done'),
          amber:   token('--c-late'),
        },
        paper: {
          base:   token('--c-surface'),
          cream:  token('--c-surface'),
          white:  token('--c-surface'),
          light:  token('--c-surface'),
          aged:   token('--c-sunken'),
          board:  token('--c-ground'),
          dark:   token('--c-ground'),
        },

        // --- ramps ---
        accent,
        danger,
        done,
        late,

        // --- re-pointed Tailwind families ---
        stone:   neutral,
        zinc:    neutral,
        gray:    neutral,
        slate:   neutral,
        neutral: neutral,

        amber:   accent,
        blue:    accent,
        indigo:  accent,
        purple:  accent,
        violet:  accent,
        sky:     accent,

        rose:    danger,
        red:     danger,

        emerald: done,
        green:   done,
        teal:    done,

        yellow:  late,
        orange:  late,
      },

      borderRadius: {
        // One radius for surfaces, one for controls. Spent by role, not stamped
        // on everything.
        'surface': '14px',
        'control': '10px',
      },

      spacing: {
        // Apple's 44pt minimum tap target, available as a class.
        'tap': '44px',
        'safe-top': 'env(safe-area-inset-top)',
        'safe-bottom': 'env(safe-area-inset-bottom)',
      },

      transitionTimingFunction: {
        // Motion that settles rather than bounces.
        'settle': 'cubic-bezier(0.32, 0.72, 0, 1)',
      },
    },
  },
  plugins: [],
};
