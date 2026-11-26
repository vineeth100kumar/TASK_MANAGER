// PrinterSettings - Settings > Printers: find a printer on the network or USB,
// add it, pick the default, print a test page. The Pi does the work through CUPS
// (raspberry_pi/printing.py); notes, reports and thought maps print from Notes.

import { useState } from 'react';
import { Printer as PrinterIcon, Loader2, Search, Plus, Trash2, Star, FileCheck2, Usb, Wifi } from 'lucide-react';
import { usePrinters, type FoundPrinter } from '../../services/printing';
import { useToast } from '../../context/ToastContext';
import { QualityPicker, usePrintOptions } from '../print/QualityPicker';

const card = 'p-5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-4';
const smallButton = 'px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-white/10 border border-black/10 dark:border-white/10 text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-white/15 disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap';
const primaryButton = 'px-3.5 py-2 rounded-xl text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50 flex items-center gap-1.5 whitespace-nowrap';
const input = 'px-3 py-2 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500';

const suggestName = (f: FoundPrinter) => f.label.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'Printer';

export function PrinterSettings() {
  const pr = usePrinters();
  const { showToast } = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [found, setFound] = useState<FoundPrinter[] | null>(null);
  const [looking, setLooking] = useState(false);
  const [manual, setManual] = useState('');
  const [opts, setOpts] = usePrintOptions();
  const [names, setNames] = useState<Record<string, string>>({});

  const attempt = async (key: string, job: () => Promise<string | null>, done?: string) => {
    setBusy(key);
    const problem = await job();
    setBusy(null);
    if (problem) showToast(problem, 'error');
    else if (done) showToast(done);
    return !problem;
  };

  const look = async () => {
    setLooking(true);
    const res = await pr.discover();
    setLooking(false);
    if (res.error) showToast(res.error, 'error');
    setFound(res.found);
  };

  if (!pr.hasServer) {
    return <div className={card}><p className="text-xs text-gray-500">Printers are managed by the Sage server on your Pi. This copy of the app runs without it, so Print uses your browser's print dialog.</p></div>;
  }
  const state = pr.state;
  if (!state) {
    return <div className={`${card} flex items-center gap-2 text-xs text-gray-400`}>{pr.problem ? pr.problem : <><Loader2 size={14} className="animate-spin" />Asking the Pi…</>}</div>;
  }
  if (!state.available) {
    return (
      <div className={card}>
        <div className="flex items-center gap-2"><PrinterIcon size={16} className="text-gray-400" /><h4 className="font-semibold text-sm text-gray-900 dark:text-white">Printing isn't set up on the Pi</h4></div>
        <p className="text-xs text-gray-500">{state.reason}</p>
        <p className="text-xs text-gray-400">Until then, Print on a note opens your browser's print dialog, which can also save a PDF.</p>
      </div>
    );
  }

  const addFound = (f: FoundPrinter) => {
    const name = (names[f.uri] ?? suggestName(f)).trim();
    attempt(`add:${f.uri}`, () => pr.add(f.uri, name), `${name} added`).then(ok => ok && setFound(list => list && list.filter(x => x.uri !== f.uri)));
  };
  const addManual = () => {
    const uri = manual.trim();
    const host = uri.replace(/^[a-z]+:\/\//i, '').split(/[/:]/)[0] || 'Printer';
    const full = /^[a-z]+:\/\//i.test(uri) ? uri : `ipp://${uri}/ipp/print`;
    attempt('manual', () => pr.add(full, host.replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40)), 'Printer added').then(ok => ok && setManual(''));
  };

  return (
    <div className="space-y-6">
      {pr.problem && <div className="px-4 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300">{pr.problem}</div>}
      {!state.pdf && (
        <div className="px-4 py-2.5 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-xs text-amber-700 dark:text-amber-300">
          The Pi has no Chromium to turn notes into PDFs, so printing from Notes will use your browser instead. Run: playwright install chromium
        </div>
      )}

      <div className={card}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0"><PrinterIcon size={17} /></div>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">My printers</div>
            <div className="text-xs text-gray-400">Notes, reports and thought maps print to these from the Print button in Notes.</div>
          </div>
        </div>
        {state.printers.length > 0 && <QualityPicker value={opts} onChange={setOpts} />}
        {state.printers.length === 0 ? (
          <p className="text-xs text-gray-500">No printer yet. Look for one below.</p>
        ) : (
          <ul className="divide-y divide-black/5 dark:divide-white/5">
            {state.printers.map(p => (
              <li key={p.name} className="py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 dark:text-white flex items-center gap-1.5">
                    {p.name}{p.default && <span className="px-1.5 py-0.5 rounded-md bg-blue-600/10 text-blue-600 dark:text-blue-400 text-[10px] font-semibold">Default</span>}
                  </div>
                  <div className="text-[11px] text-gray-400 truncate">{p.state === 'disabled' ? 'Paused or offline' : p.state === 'printing' ? 'Printing…' : 'Ready'} · {p.uri}</div>
                </div>
                <button className={smallButton} disabled={!!busy} onClick={() => attempt(`test:${p.name}`, () => pr.testPage(p.name, opts), 'Test page sent')}>
                  {busy === `test:${p.name}` ? <Loader2 size={13} className="animate-spin" /> : <FileCheck2 size={13} />}Test page
                </button>
                {!p.default && <button className={smallButton} disabled={!!busy} onClick={() => attempt(`def:${p.name}`, () => pr.makeDefault(p.name))}><Star size={13} />Make default</button>}
                <button className={smallButton} disabled={!!busy} aria-label={`Remove ${p.name}`} onClick={() => attempt(`rm:${p.name}`, () => pr.remove(p.name), `${p.name} removed`)}><Trash2 size={13} /></button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className={card}>
        <div className="flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold text-gray-900 dark:text-white">Add a printer</div>
            <div className="text-xs text-gray-400">Switch the printer on, on the same Wi-Fi or plugged into the Pi, then look.</div>
          </div>
          <button className={primaryButton} onClick={look} disabled={looking}>
            {looking ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}{looking ? 'Looking…' : 'Look for printers'}
          </button>
        </div>
        {found && found.length === 0 && <p className="text-xs text-gray-500">Nothing new found. Check the printer is on and on this network, or type its address below.</p>}
        {found && found.length > 0 && (
          <ul className="divide-y divide-black/5 dark:divide-white/5">
            {found.map(f => (
              <li key={f.uri} className="py-3 flex flex-wrap items-center gap-x-3 gap-y-2">
                {f.kind === 'usb' ? <Usb size={15} className="text-gray-400 shrink-0" /> : <Wifi size={15} className="text-gray-400 shrink-0" />}
                <div className="min-w-0 flex-1">
                  <div className="text-sm text-gray-900 dark:text-white truncate">{f.label}</div>
                  <div className="text-[11px] text-gray-400 truncate">{f.uri}</div>
                </div>
                <input className={`${input} w-36`} aria-label="Name" maxLength={40} value={names[f.uri] ?? suggestName(f)} onChange={e => setNames(n => ({ ...n, [f.uri]: e.target.value }))} />
                <button className={primaryButton} disabled={!!busy} onClick={() => addFound(f)}>
                  {busy === `add:${f.uri}` ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}Add
                </button>
              </li>
            ))}
          </ul>
        )}
        <form className="flex flex-wrap items-center gap-2 pt-1" onSubmit={e => { e.preventDefault(); if (manual.trim()) addManual(); }}>
          <input className={`${input} flex-1 min-w-[12rem]`} value={manual} onChange={e => setManual(e.target.value)} placeholder="Or an address, like 192.168.1.20" aria-label="Printer address" />
          <button type="submit" className={smallButton} disabled={!manual.trim() || !!busy}>{busy === 'manual' ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />}Add</button>
        </form>
      </div>
    </div>
  );
}
