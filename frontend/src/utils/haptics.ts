// Safe, resilient haptics utility for touch-enabled devices
export const haptics = {
  light: () => {
    try {
      if (typeof window !== 'undefined' && 'navigator' in window && 'vibrate' in navigator) {
        navigator.vibrate(10);
      }
    } catch {
      // Ignore vibration errors on unsupported browsers/iOS
    }
  },

  medium: () => {
    try {
      if (typeof window !== 'undefined' && 'navigator' in window && 'vibrate' in navigator) {
        navigator.vibrate(25);
      }
    } catch {
      // Ignore
    }
  },

  warning: () => {
    try {
      if (typeof window !== 'undefined' && 'navigator' in window && 'vibrate' in navigator) {
        navigator.vibrate([40, 30, 40]);
      }
    } catch {
      // Ignore
    }
  },

  celebrate: () => {
    try {
      if (typeof window !== 'undefined' && 'navigator' in window && 'vibrate' in navigator) {
        navigator.vibrate([30, 50, 30, 50, 80]);
      }
    } catch {
      // Ignore
    }
  }
};
