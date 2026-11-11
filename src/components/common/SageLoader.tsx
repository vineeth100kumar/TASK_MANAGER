import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

// The loading screen: the Sage logo (the S with its arrow) draws itself on one
// stroke at a time, holds, rubs itself out, and draws again until the app's
// data is ready. It reads as a pen signing Sage rather than a spinner. Shown
// right after login over the app's own background so there is no white flash
// on either side of it.

// The mark as a few single strokes on a 24x24 grid, in the app's rounded line
// style. The same strokes run on the login page and the first-paint splash.
const LOGO = ['M11.9,5.7C8.1,5.1 5.7,7 5.9,9.4C6.1,12.5 9.9,14.7 13.7,14.5','M5.7,16.3C6.3,19.6 10.2,19.9 14,19.6C17.5,19.3 18.8,15.8 16.9,12.5C15.9,10.9 14.3,10.2 12.4,10.1L9.8,10.4','M12.7,9.8L18.4,4.1','M14.5,4.5L18.4,4.1L18.1,8.1'];

const QUOTES = ['Good things come to those who wait.','Great things take a little time.','Patience is bitter, but its fruit is sweet.','Slow and steady. Your day is coming together.','Almost there. Worth the wait.'];

const HOLD_MS = 1350;

export function SageLoader({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (error) return;
    const t = setInterval(() => setI(v => v + 1), HOLD_MS);
    return () => clearInterval(t);
  }, [error]);

  return (
    <motion.div
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-[var(--glow,transparent)] bg-white dark:bg-[#0a0a0b] text-gray-900 dark:text-gray-100"
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      role="status"
      aria-label={error ? 'Sage could not load' : 'Loading Sage'}
    >
      {/* Soft glow behind the mark, matching the login page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[28%] h-64 opacity-70"
        style={{ background: 'radial-gradient(40rem 18rem at 50% 0%, rgba(99,102,241,0.10), transparent 60%)' }}
      />

      {error ? (
        <ErrorMark message={error} onRetry={onRetry} />
      ) : (
        <>
          <svg width="88" height="88" viewBox="0 0 24 24" fill="none" className="relative">
            <AnimatePresence mode="wait">
              <motion.g
                key={i}
                initial={{ opacity: 1, rotate: -4, scale: 0.94 }}
                animate={{ opacity: 1, rotate: 0, scale: 1 }}
                exit={{ opacity: 1, rotate: 4, scale: 0.94 }}
                transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                style={{ transformOrigin: '12px 12px' }}
                stroke="currentColor"
                strokeWidth={1.6}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                {LOGO.map((d, k) => (
                  <motion.path
                    key={k}
                    d={d}
                    initial={{ pathLength: 0, opacity: 0 }}
                    animate={{ pathLength: 1, opacity: 1 }}
                    exit={{ pathLength: 0, opacity: 0 }}
                    transition={{
                      pathLength: { duration: 0.5, ease: 'easeInOut', delay: k * 0.05 },
                      opacity: { duration: 0.18, delay: k * 0.05 },
                    }}
                  />
                ))}
              </motion.g>
            </AnimatePresence>
          </svg>

          <div className="mt-7 flex flex-col items-center gap-2">
            <span className="text-[15px] font-semibold tracking-tight">Sage</span>
            <div className="h-1 w-24 overflow-hidden rounded-full bg-gray-200/70 dark:bg-white/10">
              <motion.div
                className="h-full w-1/2 rounded-full bg-gray-900 dark:bg-white"
                animate={{ x: ['-60%', '160%'] }}
                transition={{ duration: 1.1, ease: 'easeInOut', repeat: Infinity }}
              />
            </div>
            <AnimatePresence mode="wait">
              <motion.p
                key={Math.floor(i / 3) % QUOTES.length}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
                className="mt-3 max-w-[18rem] px-6 text-center font-serif text-[14px] italic leading-snug text-gray-500 dark:text-gray-400"
              >
                {QUOTES[Math.floor(i / 3) % QUOTES.length]}
              </motion.p>
            </AnimatePresence>
          </div>
        </>
      )}
    </motion.div>
  );
}

function ErrorMark({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="relative mx-6 max-w-sm text-center">
      <svg width="72" height="72" viewBox="0 0 24 24" fill="none" className="mx-auto mb-5 text-gray-900 dark:text-gray-100"
        stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z" />
        <path d="M12 8v5" />
        <path d="M12 16h.01" />
      </svg>
      <h1 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white">Sage didn't load</h1>
      <p className="mt-1.5 text-sm text-gray-500 dark:text-gray-400">{message}</p>
      <button
        onClick={() => (onRetry ? onRetry() : window.location.reload())}
        className="mt-5 h-10 rounded-2xl bg-gradient-to-b from-gray-800 to-gray-950 px-5 text-sm font-semibold text-white shadow-sm shadow-black/20 ring-1 ring-inset ring-white/10 transition-all active:scale-[0.97] dark:from-white dark:to-gray-200 dark:text-black dark:ring-black/5"
      >
        Reload
      </button>
    </div>
  );
}
