// PrintOptionsDialog - The last step before a print leaves for the printer:
// pick the quality (and black and white), one side or back to back, and copies.
// Quality is asked here, before anything prints, so ink isn't spent by surprise.

import { useEffect, useState } from 'react';
import { Printer, Layers, Square, X, Loader2 } from 'lucide-react';
import { QualityPicker, usePrintOptions } from './QualityPicker';
import type { PrintOptions } from '../../services/printing';

interface Props {
  printer: string;
  title: string;
  onPrint: (mode: 'single' | 'duplex', copies: number, opts: PrintOptions) => Promise<void>;
  onClose: () => void;
}

export function PrintOptionsDialog({ printer, title, onPrint, onClose }: Props) {
  const [opts, setOpts] = usePrintOptions();
  const [mode, setMode] = useState<'single' | 'duplex'>('single');
  const [copies, setCopies] = useState(1);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !busy) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, busy]);

  const go = async () => {
    setBusy(true);
    try { await onPrint(mode, copies, opts); } finally { setBusy(false); }
  };
  const chip = (on: boolean) => `flex-1 h-9 rounded-xl text-xs font-semibold flex items-center justify-center gap-1.5 transition ${on ? 'bg-blue-600 text-white' : 'bg-black/5 dark:bg-white/10 text-gray-700 dark:text-gray-200 hover:bg-black/10'}`;

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center p-4 bg-black/40" onClick={() => !busy && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="print-opts-title" onClick={e => e.stopPropagation()}
        className="w-full max-w-sm rounded-2xl bg-white dark:bg-neutral-900 border border-black/10 dark:border-white/10 p-5 shadow-xl space-y-4">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 grid place-items-center shrink-0"><Printer size={17} /></div>
          <div className="min-w-0 flex-1">
            <h3 id="print-opts-title" className="text-base font-semibold text-gray-900 dark:text-white">Print options</h3>
            <p className="text-xs text-gray-500 truncate">{title} · {printer}</p>
          </div>
          <button onClick={onClose} disabled={busy} aria-label="Close" className="text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"><X size={16} /></button>
        </div>

        <QualityPicker value={opts} onChange={setOpts} />

        <div className="flex gap-2" role="radiogroup" aria-label="Sides">
          <button role="radio" aria-checked={mode === 'single'} className={chip(mode === 'single')} onClick={() => setMode('single')}><Square size={13} />One side</button>
          <button role="radio" aria-checked={mode === 'duplex'} className={chip(mode === 'duplex')} onClick={() => setMode('duplex')}><Layers size={13} />Back to back</button>
        </div>
        {mode === 'single' ? (
          <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">Copies
            <input type="number" min={1} max={20} value={copies} onChange={e => setCopies(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
              className="h-8 w-16 px-2 rounded-lg bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500" />
          </label>
        ) : (
          <p className="text-xs text-gray-500">One sheet at a time: Sage prints a side, you flip the sheet and press the button.</p>
        )}

        <button onClick={go} disabled={busy}
          className="w-full h-11 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 transition disabled:opacity-60 flex items-center justify-center gap-2">
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Printer size={16} />}{mode === 'duplex' ? 'Start back to back' : 'Print'}
        </button>
      </div>
    </div>
  );
}
