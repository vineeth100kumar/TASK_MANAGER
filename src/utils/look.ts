// The app's visual style, separate from light/dark. "classic" is the original
// navy-and-glass look; "coral" is the bold rounded one (Fredoka, coral, yellow).
export type Look = 'classic' | 'coral';

export const LOOKS: { id: Look; label: string }[] = [
  { id: 'classic', label: 'Classic' },
  { id: 'coral', label: 'Coral' },
];

export function savedLook(): Look {
  try {
    return localStorage.getItem('sage-look') === 'coral' ? 'coral' : 'classic';
  } catch { return 'classic'; }
}

// Sets the look on <html> so CSS (and the `coral:` Tailwind variant) can follow it.
export function applyLook(look: Look) {
  document.documentElement.dataset.look = look;
  try { localStorage.setItem('sage-look', look); } catch { /* storage unavailable */ }
}

// Colour for the browser/OS chrome around the app.
export function chromeColor(look: Look, dark: boolean) {
  if (look === 'coral') return dark ? '#070707' : '#f8f8f8';
  return dark ? '#0a0a0b' : '#ffffff';
}
