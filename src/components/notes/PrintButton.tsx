// PrintButton - Print the open note, report or thought map: to a printer the Pi
// knows (Settings > Printers), or with the browser's own Print dialog (which can
// also save a PDF). One button covers all three kinds of note.

import { useEffect, useRef, useState } from 'react';
import { Printer, Loader2, Monitor, Settings2, Layers } from 'lucide-react';
import { Note, Thought } from '../../services/types';
import { api } from '../../services/api';
import { useToast } from '../../context/ToastContext';
import { duplexApi, printInBrowser, printOnPi, usePrinters, type DuplexJob } from '../../services/printing';
import { DuplexDialog } from '../print/DuplexDialog';
import { codePage, mapPage, notePage, reportPage } from './printable';

interface Props {
  note: Note;
  /** The note's body: formatted HTML for a note, the source for a report or code. */
  body: string;
  onOpenSettings?: () => void;
}

export function PrintButton({ note, body, onOpenSettings }: Props) {
  const pr = usePrinters();
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [working, setWorking] = useState(false);
  const [duplexJob, setDuplexJob] = useState<DuplexJob | null>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const page = async (): Promise<string> => {
    if (note.kind === 'map') {
      const thoughts: Thought[] = await api.thoughts.list(note.id);
      return mapPage(note, thoughts);
    }
    if (note.kind === 'html') return reportPage(note, body);
    if (note.kind === 'code') return codePage(note, body);
    return notePage(note, body);
  };

  const go = async (printer: string | null) => {
    setOpen(false);
    setWorking(true);
    try {
      const html = await page();
      if (printer === null) { printInBrowser(html); return; }
      await printOnPi(printer, note.title || 'Sage', html);
      showToast(`Sent to ${printer}`);
    } catch (e: any) {
      showToast(e?.message || "Couldn't print that", 'error');
    } finally {
      setWorking(false);
    }
  };

  const goDuplex = async (printer: string) => {
    setOpen(false);
    setWorking(true);
    try {
      setDuplexJob(await duplexApi.fromHtml(printer, note.title || 'Sage', await page(), false));
    } catch (e: any) {
      showToast(e?.message || "Couldn't start back to back", 'error');
    } finally {
      setWorking(false);
    }
  };

  const printers = pr.state?.available && pr.state.pdf !== false ? pr.state.printers : [];
  const item = 'w-full text-left px-2.5 py-2 rounded-xl text-[13px] font-medium text-gray-800 dark:text-gray-100 hover:bg-black/5 dark:hover:bg-white/10 flex items-center gap-2';

  return (
    <div className="relative shrink-0" ref={box}>
      <button onClick={() => { setOpen(o => !o); pr.reload(); }} disabled={working} aria-label="Print" aria-expanded={open} aria-haspopup="menu" title="Print"
        className="grid place-items-center w-9 h-9 rounded-[10px] text-gray-500 dark:text-gray-400 hover:bg-black/5 dark:hover:bg-white/10 hover:text-gray-900 dark:hover:text-white active:scale-95 transition">
        {working ? <Loader2 size={18} className="animate-spin" /> : <Printer size={18} />}
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-30 w-60 p-1.5 rounded-2xl bg-white dark:bg-[#2c2c2e] shadow-xl ring-1 ring-black/10 dark:ring-white/10">
          <div className="px-2.5 pt-1 pb-1.5 text-[11.5px] font-semibold text-gray-500">Print {note.kind === 'map' ? 'thought map' : note.kind === 'html' ? 'report' : note.kind === 'code' ? 'code' : 'note'}</div>
          {printers.map(p => (
            <button key={p.name} role="menuitem" disabled={p.state === 'disabled'} onClick={() => go(p.name)} className={`${item} disabled:opacity-40`}>
              <Printer size={14} className="shrink-0 text-blue-500" />
              <span className="truncate">{p.name}</span>
              {p.default && <span className="ml-auto text-[10px] text-gray-400">default</span>}
            </button>
          ))}
          {printers.filter(p => p.state !== 'disabled').map(p => (
            <button key={`b2b-${p.name}`} role="menuitem" onClick={() => goDuplex(p.name)} className={item}>
              <Layers size={14} className="shrink-0 text-blue-500" />
              <span className="truncate">Back to back · {p.name}</span>
            </button>
          ))}
          <button role="menuitem" onClick={() => go(null)} className={item}>
            <Monitor size={14} className="shrink-0 text-gray-400" />This device / save as PDF
          </button>
          {onOpenSettings && (
            <button role="menuitem" onClick={() => { setOpen(false); onOpenSettings(); }} className={`${item} text-gray-500`}>
              <Settings2 size={14} className="shrink-0" />{printers.length ? 'Printer settings' : 'Set up a printer'}
            </button>
          )}
        </div>
      )}
      {duplexJob && <DuplexDialog job={duplexJob} autoStart onClose={() => setDuplexJob(null)} />}
    </div>
  );
}
