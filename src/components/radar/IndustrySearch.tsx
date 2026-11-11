// The search box at the top of Radar: type an industry, get a full brief
// (IndustryPage). Recent briefs show under it while it has focus.
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Search, LoaderCircle, Clock } from 'lucide-react';
import { IndustryRecent, industryApi, timeAgo } from '../../services/radar';
import { useToast } from '../../context/ToastContext';

const EXAMPLES = ['3D printing', 'EV batteries', 'Drones', 'Quick commerce', 'Solar'];

export function IndustrySearch({ onOpen }: { onOpen: (id: string) => void }) {
  const { showToast } = useToast();
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [recent, setRecent] = useState<IndustryRecent[]>([]);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) industryApi.recent().then(r => setRecent(r.recent)).catch(() => setRecent([]));
  }, [open]);
  useEffect(() => {
    const close = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const search = async (text: string) => {
    const q = text.trim();
    if (q.length < 2) return;
    setBusy(true);
    try {
      const brief = await industryApi.search(q);
      setOpen(false);
      setQuery('');
      onOpen(brief.id);
    } catch (e: any) {
      showToast(e.message || "Couldn't search", 'error');
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => { e.preventDefault(); search(query); };
  const matches = recent.filter(r => !query.trim() || r.name.toLowerCase().includes(query.trim().toLowerCase()) || r.query.toLowerCase().includes(query.trim().toLowerCase()));

  return (
    <div ref={box} className="relative">
      <form onSubmit={submit} role="search" className="flex items-center gap-2 surface-item rounded-2xl pl-3.5 pr-1.5 py-1.5 focus-within:ring-2 focus-within:ring-purple-500/40">
        <Search size={16} className="text-gray-400 shrink-0" />
        <input
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setOpen(true)}
          onKeyDown={e => { if (e.key === 'Escape') setOpen(false); }}
          placeholder="Search an industry, e.g. 3D printing"
          aria-label="Search an industry"
          maxLength={80}
          className="flex-1 min-w-0 bg-transparent outline-none text-[14px] text-gray-900 dark:text-white placeholder:text-gray-400 py-1"
        />
        <button type="submit" disabled={busy || query.trim().length < 2}
          className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-[13px] font-semibold bg-gray-900 text-white dark:bg-white dark:text-gray-900 disabled:opacity-40">
          {busy ? <LoaderCircle size={14} className="animate-spin" /> : null} Brief me
        </button>
      </form>
      {open && (
        <div className="absolute z-20 left-0 right-0 mt-1.5 surface rounded-2xl border border-black/5 dark:border-white/10 shadow-lg p-2 space-y-1">
          {matches.length > 0 ? (
            <>
              <div className="text-[10.5px] font-semibold uppercase tracking-wider text-gray-400 px-2 pt-1">Recent briefs</div>
              {matches.slice(0, 6).map(r => (
                <button key={r.id} onClick={() => { setOpen(false); onOpen(r.id); }}
                  className="w-full text-left flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-black/[0.04] dark:hover:bg-white/5">
                  <Clock size={13} className="text-gray-400 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-gray-900 dark:text-white truncate">{r.name}</span>
                    {r.oneLiner && <span className="block text-[11.5px] text-gray-400 truncate">{r.oneLiner}</span>}
                  </span>
                  <span className="text-[11px] text-gray-400 shrink-0">{r.status === 'running' || r.status === 'queued' ? 'writing…' : r.status === 'failed' ? 'failed' : `${timeAgo(r.createdAt)} ago`}</span>
                </button>
              ))}
            </>
          ) : (
            <div className="px-2 py-1.5 space-y-1.5">
              <div className="text-[12px] text-gray-500">From Wikipedia, Wikidata, SEC filings, OpenAlex, published market figures and news, in about a minute.</div>
              <div className="flex gap-1.5 flex-wrap">
                {EXAMPLES.map(x => (
                  <button key={x} onClick={() => search(x)} disabled={busy} className="text-[12px] font-semibold px-2.5 py-1 rounded-lg bg-black/[0.04] dark:bg-white/10 hover:bg-black/10 dark:hover:bg-white/15 text-gray-700 dark:text-gray-200">{x}</button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
