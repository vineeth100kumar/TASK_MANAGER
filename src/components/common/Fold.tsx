import React from 'react';
import { motion } from 'framer-motion';

// A list row that folds its height away when it leaves, and unfolds into
// place when it arrives after the list is already showing (wrap the list in
// AnimatePresence initial={false}, so rows there on first paint don't).
// The gap lives inside the row so it folds too.
export function Fold({ children, gap = 8 }: { children: React.ReactNode; gap?: number }) {
  return (
    <motion.div
      // A row with an open menu sits above the rows after it.
      className="relative has-[[aria-expanded=true]]:z-30"
      layout="position"
      initial={{ opacity: 0, height: 0, overflow: 'hidden' }}
      animate={{ opacity: 1, height: 'auto', transitionEnd: { overflow: 'visible' } }}
      transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      exit={{ opacity: 0, height: 0, overflow: 'hidden', transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } }}
    >
      <div style={{ paddingBottom: gap }}>{children}</div>
    </motion.div>
  );
}
