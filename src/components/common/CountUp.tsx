import { useEffect, useRef, useState } from 'react';

const reduceMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// A number that rolls to its new value instead of jumping, so a count going
// up after you finish something reads as progress. `from` rolls it on arrival.
export function CountUp({ value, from, duration = 520 }: { value: number; from?: number; duration?: number }) {
  const [shown, setShown] = useState(() => (reduceMotion() ? value : from ?? value));
  const current = useRef(shown);
  current.current = shown;

  useEffect(() => {
    const start = current.current;
    if (start === value || reduceMotion()) { setShown(value); return; }
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setShown(Math.round(start + (value - start) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return <>{shown}</>;
}
