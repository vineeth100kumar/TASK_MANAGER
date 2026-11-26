// QualityPicker - Draft / Normal / High, and black and white, for a print job.
// Draft and black and white save ink. The choice is remembered on this device.

import { useState } from 'react';
import { Droplet } from 'lucide-react';
import { loadPrintOptions, savePrintOptions, type PrintOptions, type Quality } from '../../services/printing';

const CHOICES: { id: Quality; label: string; hint: string }[] = [
  { id: 'draft', label: 'Draft', hint: 'Least ink' },
  { id: 'normal', label: 'Normal', hint: 'Everyday' },
  { id: 'high', label: 'High', hint: 'Most ink' },
];

/** Keeps the print options in state and remembers them. */
export function usePrintOptions(): [PrintOptions, (o: PrintOptions) => void] {
  const [opts, setOpts] = useState<PrintOptions>(loadPrintOptions);
  return [opts, (o: PrintOptions) => { setOpts(o); savePrintOptions(o); }];
}

export function QualityPicker({ value, onChange, compact }: { value: PrintOptions; onChange: (o: PrintOptions) => void; compact?: boolean }) {
  return (
    <div className={compact ? 'px-2.5 py-1.5 space-y-2' : 'space-y-2'}>
      <div className="flex items-center gap-1.5 text-[11.5px] font-semibold text-gray-500"><Droplet size={12} />Print quality</div>
      <div role="radiogroup" aria-label="Print quality" className="flex p-0.5 rounded-xl bg-black/[0.05] dark:bg-white/[0.08]">
        {CHOICES.map(c => (
          <button key={c.id} type="button" role="radio" aria-checked={value.quality === c.id} title={c.hint}
            onClick={() => onChange({ ...value, quality: c.id })}
            className={`flex-1 h-7 rounded-[10px] text-xs font-semibold transition ${value.quality === c.id ? 'bg-white dark:bg-[#3a3a3c] text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}>
            {c.label}
          </button>
        ))}
      </div>
      <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 cursor-pointer">
        <input type="checkbox" checked={value.mono} onChange={e => onChange({ ...value, mono: e.target.checked })} />Black and white only
      </label>
    </div>
  );
}
