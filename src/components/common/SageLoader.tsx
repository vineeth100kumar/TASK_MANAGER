import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

// The loading screen: one line that draws itself into a Sage icon, rubs itself
// out, and redraws as the next — tasks, a list, a plan, a note, focus, an idea,
// a habit. It reads as a single pen sketching what Sage does, rather than a
// spinner. Shown right after login until the app's data is ready, over the
// app's own background so there is no white flash on either side of it.

// Each icon is a few single strokes on a 24x24 grid, in the app's rounded line
// style. Kept deliberately simple so the draw-on / draw-off stays legible.
const ICONS: { label: string; paths: string[] }[] = [
  // A ticked task
  { label: 'done', paths: ['M4 7a3 3 0 0 1 3-3h10a3 3 0 0 1 3 3v10a3 3 0 0 1-3 3H7a3 3 0 0 1-3-3z', 'M8.5 12.5l2.5 2.5 5-5.5'] },
  // A list of tasks
  { label: 'tasks', paths: ['M9 7h11', 'M9 12h11', 'M9 17h11', 'M4 7h.01', 'M4 12h.01', 'M4 17h.01'] },
  // A calendar / plan
  { label: 'plan', paths: ['M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z', 'M4 10h16', 'M8 3v4', 'M16 3v4'] },
  // A note
  { label: 'note', paths: ['M6 3h8l4 4v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z', 'M14 3v4h4', 'M8 12h7', 'M8 16h5'] },
  // Focus (a target)
  { label: 'focus', paths: ['M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z', 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', 'M12 11.5a.5.5 0 1 0 0 1 .5.5 0 0 0 0-1z'] },
  // An idea
  { label: 'idea', paths: ['M12 3a6 6 0 0 1 4 10.5c-.7.7-1 1.2-1 2.5H9c0-1.3-.3-1.8-1-2.5A6 6 0 0 1 12 3z', 'M9.5 19h5', 'M10.5 21.5h3'] },
  // A habit / streak
  { label: 'habit', paths: ['M20 7a8 8 0 1 0 1.5 6', 'M20 3v4h-4'] },
];

const HOLD_MS = 900;

export function SageLoader({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  const [i, setI] = useState(0);

  useEffect(() => {
    if (error) return;
    const t = setInterval(() => setI(v => (v + 1) % ICONS.length), HOLD_MS);
    return () => clearInterval(t);
  }, [error]);

  const icon = ICONS[i];

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
                {icon.paths.map((d, k) => (
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
