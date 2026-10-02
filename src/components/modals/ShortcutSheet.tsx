import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useEscapeKey } from '../../hooks/useEscapeKey';

interface ShortcutSheetProps {
  onClose: () => void;
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || '');
const mod = isMac ? '⌘' : 'Ctrl';

const GROUPS: { title: string; rows: { keys: string[]; what: string }[] }[] = [
  {
    title: 'Anywhere',
    rows: [
      { keys: ['N'], what: 'New item' },
      { keys: ['C'], what: 'New item (same as N)' },
      { keys: ['/'], what: 'Search' },
      { keys: [mod, 'K'], what: 'Search' },
      { keys: ['?'], what: 'This sheet' },
      { keys: ['Esc'], what: 'Close a panel, or clear the search' },
    ],
  },
  {
    title: 'Sorting the Inbox (triage)',
    rows: [
      { keys: ['F'], what: 'Put it in Focus' },
      { keys: ['S'], what: 'Schedule it' },
      { keys: ['W'], what: 'Waiting on someone' },
      { keys: ['X'], what: 'Delete it' },
      { keys: ['Space'], what: 'Skip for now' },
    ],
  },
  {
    title: 'Adding an item',
    rows: [
      { keys: ['Enter'], what: 'Add it' },
      { keys: ['Esc'], what: 'Cancel' },
    ],
  },
];

export function ShortcutSheet({ onClose }: ShortcutSheetProps) {
  useEscapeKey(onClose);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 font-sans" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <div className="absolute inset-0 scrim" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, scale: 0.97, y: 8 }} animate={{ opacity: 1, scale: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
        className="relative w-full max-w-md rounded-3xl bg-white dark:bg-[#1c1c1e] border border-black/5 dark:border-white/10 shadow-2xl p-6 space-y-5"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold tracking-tight text-gray-900 dark:text-white">Keyboard shortcuts</h2>
          <button onClick={onClose} className="p-1.5 -m-1.5 rounded-lg text-gray-400 hover:text-gray-700 dark:hover:text-white" aria-label="Close"><X size={18} /></button>
        </div>
        {GROUPS.map(group => (
          <div key={group.title} className="space-y-2">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{group.title}</h3>
            {group.rows.map(row => (
              <div key={row.what + row.keys.join('')} className="flex items-center justify-between gap-4 text-[13px]">
                <span className="text-gray-700 dark:text-gray-300">{row.what}</span>
                <span className="flex items-center gap-1 shrink-0">
                  {row.keys.map(k => <kbd key={k} className="kbd">{k}</kbd>)}
                </span>
              </div>
            ))}
          </div>
        ))}
      </motion.div>
    </div>
  );
}
