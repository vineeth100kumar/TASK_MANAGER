// After "Mark posted", Sage looks for the post on Instagram and keeps its link.
// This shows the link, or what the search is doing, with a button to look again.
import { useState } from 'react';
import { ExternalLink, Loader2, Search } from 'lucide-react';
import { useToast } from '../../context/ToastContext';

interface Props<T> {
  item: T & { posted: boolean; instagramUrl?: string; instagramCheck?: string };
  find: () => Promise<{ found: boolean } & Record<string, any>>;
  onChange: (next: any) => void;
}

export function InstagramLink<T>({ item, find, onChange }: Props<T>) {
  const { showToast } = useToast();
  const [busy, setBusy] = useState(false);
  if (!item.posted) return null;

  const look = async () => {
    setBusy(true);
    try {
      const r = await find();
      onChange(r.post ?? r.reel);
      showToast(r.found ? 'Found it on Instagram' : 'Not on Instagram yet', r.found ? 'success' : 'info');
    } catch (e: any) { showToast(e.message || "Couldn't reach Instagram", 'error'); }
    finally { setBusy(false); }
  };

  if (item.instagramUrl) {
    return (
      <a href={item.instagramUrl} target="_blank" rel="noreferrer"
         className="h-10 rounded-xl bg-black/[0.06] dark:bg-white/10 text-[13px] font-semibold flex items-center justify-center gap-1.5">
        <ExternalLink size={14} /> Open on Instagram
      </a>
    );
  }
  const note = item.instagramCheck === 'offline' ? 'Instagram page not connected for this project'
    : item.instagramCheck === 'missed' ? 'Not found on Instagram yet'
    : 'Looking on Instagram…';
  return (
    <div className="flex items-center justify-between gap-2 text-[12px] text-gray-500">
      <span className="flex items-center gap-1.5">{item.instagramCheck === 'looking' && <Loader2 size={12} className="animate-spin" />}{note}</span>
      {item.instagramCheck !== 'offline' && (
        <button onClick={look} disabled={busy} className="h-8 px-3 rounded-lg bg-black/[0.06] dark:bg-white/10 font-semibold flex items-center gap-1.5">
          <Search size={12} /> Find on Instagram
        </button>
      )}
    </div>
  );
}
