// PrinterDrop - A section of the Drop page: upload PDFs to the Pi and print them,
// on one side or back to back (one sheet at a time, see print/DuplexDialog).
// The PDFs stay on the Pi until deleted (raspberry_pi/printdrop.py).

import { useCallback, useEffect, useRef, useState } from 'react';
import { FileText, Upload, Printer, Trash2, Loader2, Layers, Square } from 'lucide-react';
import { printDropApi, usePrinters, duplexApi, type DuplexJob, type PrintDropList, type PrintFile } from '../../services/printing';
import { DuplexDialog } from '../print/DuplexDialog';
import { QualityPicker, usePrintOptions } from '../print/QualityPicker';
import { useToast } from '../../context/ToastContext';

const PRINTER_KEY = 'sage-printdrop-printer';
const fmt = (b: number) => (b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);
const chip = (on: boolean) => `px-3 h-8 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ${on ? 'bg-blue-600 text-white' : 'bg-black/5 dark:bg-white/10 text-gray-700 dark:text-gray-200 hover:bg-black/10'}`;

export function PrinterDrop() {
  const { showToast } = useToast();
  const pr = usePrinters();
  const [list, setList] = useState<PrintDropList | null>(null);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<number | null>(null);
  const [over, setOver] = useState(false);
  const [picked, setPicked] = useState<PrintFile | null>(null);
  const [mode, setMode] = useState<'single' | 'duplex'>('single');
  const [copies, setCopies] = useState(1);
  const [flip, setFlip] = useState(false);
  const [printer, setPrinter] = useState('');
  const [busy, setBusy] = useState(false);
  const [job, setJob] = useState<DuplexJob | null>(null);
  const [jobs, setJobs] = useState<DuplexJob[]>([]);
  const [opts, setOpts] = usePrintOptions();
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try { setList(await printDropApi.list()); setError(''); }
    catch (e: any) { setError(e?.message || "Can't reach the Pi"); }
    try { setJobs((await duplexApi.list()).filter(j => !j.finished)); } catch { /* no jobs */ }
  }, []);
  useEffect(() => { load(); }, [load]);

  const printers = pr.state?.available ? pr.state.printers.filter(p => p.state !== 'disabled') : [];
  useEffect(() => {
    if (printer && printers.some(p => p.name === printer)) return;
    let saved = '';
    try { saved = localStorage.getItem(PRINTER_KEY) || ''; } catch { /* private window */ }
    const pick = printers.find(p => p.name === saved) || printers.find(p => p.default) || printers[0];
    if (pick) setPrinter(pick.name);
  }, [printers, printer]);

  const upload = async (files: FileList | File[]) => {
    const pdfs = Array.from(files).filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!pdfs.length) { showToast('Only PDF files go in Printer drop', 'error'); return; }
    for (const f of pdfs) {
      try {
        setSent(0);
        const made = await printDropApi.upload(f, (s, t) => setSent(t ? s / t : 0));
        showToast(`${made.name} added (${made.pages} page${made.pages === 1 ? '' : 's'})`);
        setPicked(made);
      } catch (e: any) {
        showToast(`${f.name}: ${e?.message || 'upload failed'}`, 'error');
      }
    }
    setSent(null);
    load();
  };

  const remove = async (f: PrintFile) => {
    try { await printDropApi.remove(f.id); if (picked?.id === f.id) setPicked(null); load(); }
    catch (e: any) { showToast(e?.message || "Couldn't delete that", 'error'); }
  };

  const print = async () => {
    if (!picked || !printer) return;
    try { localStorage.setItem(PRINTER_KEY, printer); } catch { /* private window */ }
    setBusy(true);
    try {
      const res = await printDropApi.print(picked.id, printer, mode, copies, flip, opts);
      if (res.job) setJob(res.job);
      else showToast(`Sent ${picked.name} to ${printer}`);
    } catch (e: any) {
      showToast(e?.message || "Couldn't print that", 'error');
    } finally {
      setBusy(false);
    }
  };

  const selectCls = 'h-8 px-2 rounded-lg bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs text-gray-900 dark:text-white outline-none focus:ring-2 focus:ring-blue-500';

  return (
    <section className="space-y-2" aria-label="Printer drop">
      <h2 className="text-[13px] font-semibold uppercase tracking-wider text-gray-500 px-1">Printer drop{list?.files.length ? ` · ${list.files.length}` : ''}</h2>
      <div className="rounded-2xl bg-white dark:bg-white/5 border border-black/5 dark:border-white/10 p-4 space-y-4">
        <div
          onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
          onDrop={e => { e.preventDefault(); setOver(false); upload(e.dataTransfer.files); }}
          className={`rounded-xl border-2 border-dashed p-5 text-center transition ${over ? 'border-blue-500 bg-blue-500/5' : 'border-black/10 dark:border-white/15'}`}>
          <input ref={input} type="file" accept="application/pdf,.pdf" multiple className="hidden" onChange={e => { if (e.target.files) upload(e.target.files); e.target.value = ''; }} />
          <button onClick={() => input.current?.click()} disabled={sent !== null}
            className="inline-flex items-center gap-2 h-9 px-4 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 transition disabled:opacity-60">
            {sent !== null ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}{sent !== null ? `Uploading ${Math.round(sent * 100)}%` : 'Add PDF'}
          </button>
          <p className="text-xs text-gray-400 mt-2">or drop PDFs here · up to {list?.maxMb ?? 30} MB each, {list?.maxFiles ?? 20} files</p>
        </div>

        {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
        {jobs.length > 0 && (
          <ul className="space-y-1.5">
            {jobs.map(j => (
              <li key={j.id} className="flex items-center gap-2 text-xs px-3 py-2 rounded-xl bg-amber-50 dark:bg-amber-500/10 text-amber-800 dark:text-amber-200">
                <Layers size={14} className="shrink-0" /><span className="truncate flex-1">{j.title}: back to back, sheet {j.sheet} of {j.sheets}</span>
                <button onClick={() => setJob(j)} className="font-semibold underline">Continue</button>
              </li>
            ))}
          </ul>
        )}

        {list && list.files.length === 0 && !error && <p className="text-xs text-gray-500">No PDFs yet.</p>}
        {list && list.files.length > 0 && (
          <ul className="divide-y divide-black/5 dark:divide-white/5">
            {list.files.map(f => (
              <li key={f.id} className={`py-2.5 flex items-center gap-3 ${picked?.id === f.id ? 'bg-blue-500/5 -mx-2 px-2 rounded-lg' : ''}`}>
                <FileText size={16} className="text-red-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-gray-900 dark:text-white truncate">{f.name}</div>
                  <div className="text-[11px] text-gray-400">{f.pages} page{f.pages === 1 ? '' : 's'} · {fmt(f.bytes)}</div>
                </div>
                <button onClick={() => setPicked(picked?.id === f.id ? null : f)} className="h-8 px-3 rounded-lg text-xs font-semibold bg-black/5 dark:bg-white/10 text-gray-800 dark:text-gray-100 hover:bg-black/10 flex items-center gap-1.5">
                  <Printer size={13} />Print
                </button>
                <button onClick={() => remove(f)} aria-label={`Delete ${f.name}`} className="h-8 w-8 grid place-items-center rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-500/10"><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        )}

        {picked && (
          <div className="rounded-xl bg-gray-50 dark:bg-white/5 p-4 space-y-3">
            <div className="text-sm font-semibold text-gray-900 dark:text-white truncate">Print {picked.name}</div>
            {printers.length === 0 ? (
              <p className="text-xs text-gray-500">No printer ready. Add one in Settings → Devices → Printers.</p>
            ) : (
              <>
                <QualityPicker value={opts} onChange={setOpts} />
                <div className="flex flex-wrap items-center gap-2">
                  <select value={printer} onChange={e => setPrinter(e.target.value)} className={selectCls} aria-label="Printer">
                    {printers.map(p => <option key={p.name} value={p.name}>{p.name}</option>)}
                  </select>
                  <button className={chip(mode === 'single')} onClick={() => setMode('single')}><Square size={13} />One side</button>
                  <button className={chip(mode === 'duplex')} onClick={() => setMode('duplex')}><Layers size={13} />Back to back</button>
                </div>
                {mode === 'single' ? (
                  <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">Copies
                    <input type="number" min={1} max={20} value={copies} onChange={e => setCopies(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className={`${selectCls} w-16`} />
                  </label>
                ) : (
                  <div className="space-y-2">
                    <p className="text-xs text-gray-500">Sage prints one side and waits. Flip the sheet, put it back, press the button, and it prints the other side. Then it asks for a fresh sheet. {picked.pages} page{picked.pages === 1 ? '' : 's'} = {Math.ceil(picked.pages / 2)} sheet{picked.pages <= 2 ? '' : 's'}.</p>
                    <label className="flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300">
                      <input type="checkbox" checked={flip} onChange={e => setFlip(e.target.checked)} />Back side comes out upside down? Turn it
                    </label>
                  </div>
                )}
                <button onClick={print} disabled={busy || !printer}
                  className="h-10 px-5 rounded-xl text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 active:scale-95 transition disabled:opacity-60 flex items-center gap-2">
                  {busy ? <Loader2 size={15} className="animate-spin" /> : <Printer size={15} />}{mode === 'duplex' ? 'Start back to back' : 'Print'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
      {job && <DuplexDialog job={job} autoStart onClose={() => { setJob(null); load(); }} />}
    </section>
  );
}
