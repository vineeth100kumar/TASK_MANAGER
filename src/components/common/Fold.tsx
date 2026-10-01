import React from 'react';
import { motion } from 'framer-motion';

// A list row that folds its height away when it leaves (wrap the list in
// AnimatePresence). The gap lives inside the row so it folds away too.
export function Fold({ children, gap = 8 }: { children: React.ReactNode; gap?: number }) {
  return (
    <motion.div
      layout="position"
      initial={false}
      exit={{ opacity: 0, height: 0, overflow: 'hidden', transition: { duration: 0.3, ease: [0.16, 1, 0.3, 1] } }}
    >
      <div style={{ paddingBottom: gap }}>{children}</div>
    </motion.div>
  );
}
