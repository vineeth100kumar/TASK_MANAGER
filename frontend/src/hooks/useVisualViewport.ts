import { useState, useEffect } from 'react';

export interface VisualViewportState {
  viewportHeight: number;
  keyboardOffset: number;
  isKeyboardOpen: boolean;
}

export function useVisualViewport(): VisualViewportState {
  const [state, setState] = useState<VisualViewportState>(() => {
    if (typeof window === 'undefined' || !window.visualViewport) {
      return {
        viewportHeight: typeof window !== 'undefined' ? window.innerHeight : 800,
        keyboardOffset: 0,
        isKeyboardOpen: false
      };
    }
    const vv = window.visualViewport;
    const keyboardOffset = Math.max(0, window.innerHeight - vv.height);
    return {
      viewportHeight: vv.height,
      keyboardOffset,
      isKeyboardOpen: keyboardOffset > 100
    };
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.visualViewport) return;

    const vv = window.visualViewport;

    const handleResize = () => {
      const keyboardOffset = Math.max(0, window.innerHeight - vv.height);
      const isKeyboardOpen = keyboardOffset > 100;

      setState({
        viewportHeight: vv.height,
        keyboardOffset,
        isKeyboardOpen
      });

      // Update CSS custom properties on documentElement for responsive CSS styling
      document.documentElement.style.setProperty('--keyboard-offset', `${keyboardOffset}px`);
      document.documentElement.style.setProperty('--viewport-height', `${vv.height}px`);
    };

    vv.addEventListener('resize', handleResize);
    vv.addEventListener('scroll', handleResize);

    return () => {
      vv.removeEventListener('resize', handleResize);
      vv.removeEventListener('scroll', handleResize);
      document.documentElement.style.removeProperty('--keyboard-offset');
      document.documentElement.style.removeProperty('--viewport-height');
    };
  }, []);

  return state;
}
