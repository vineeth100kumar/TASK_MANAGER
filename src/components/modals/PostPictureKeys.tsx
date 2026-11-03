import { useEffect, useState } from 'react';
import { Image as ImageIcon } from 'lucide-react';
import { piBackendUrl, piHeaders } from '../../services/piBackend';
import { useToast } from '../../context/ToastContext';

type Source = { set: boolean; last4: string };
type Sources = Record<'unsplash' | 'pexels' | 'pixabay' | 'wikimedia', Source>;

const KEYED = [
  { id: 'unsplash', name: 'Unsplash', url: 'unsplash.com/developers' },
  { id: 'pexels', name: 'Pexels', url: 'pexels.com/api' },
  { id: 'pixabay', name: 'Pixabay', url: 'pixabay.com/api/docs' },
] as const;

// Free photo keys for Posts. Picture slides ("search: ...") use whichever sources have a key; Wikimedia Commons needs none.
export function PostPictureKeys() {
  const { showToast } = useToast();
  const [sources, setSources] = useState<Sources | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState('');
  const base = piBackendUrl();

  useEffect(() => {
    if (!base) return;
    fetch(`${base}/api/posts/pictures`, { headers: piHeaders() })
      .then(r => (r.ok ? r.json() : null)).then(j => j && setSources(j.sources)).catch(() => {});
  }, [base]);

  if (!base) return null;

  const save = async (id: string, value: string) => {
    setSaving(id);
    try {
      const res = await fetch(`${base}/api/posts/pictures`, {
        method: 'PUT', headers: piHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ [id]: value }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || json.success === false) throw new Error(json.error || json.detail || `The Pi said ${res.status}`);
      setSources(json.sources);
      setDraft(d => ({ ...d, [id]: '' }));
      showToast(value ? 'Picture key saved on the Pi' : 'Picture key removed');
    } catch (e: any) {
      showToast(e.message || "Couldn't save the key", 'error');
    } finally {
      setSaving('');
    }
  };

  return (
    <div className="p-4 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-3">
      <p className="flex items-center gap-2 text-[13.5px] font-semibold text-gray-900 dark:text-white"><ImageIcon size={15} /> Free photos for Posts</p>
      <p className="text-[12px] text-gray-500 dark:text-gray-400">
        When a post script asks for a picture ("search: street food stall"), Sage finds a free photo and credits the photographer on the slide and in the caption.
        Wikimedia Commons works with no key. Add any free key below for more choice.
      </p>
      {KEYED.map(k => {
        const s = sources?.[k.id];
        return (
          <form key={k.id} onSubmit={e => { e.preventDefault(); if (draft[k.id]?.trim()) save(k.id, draft[k.id]); }} className="space-y-1">
            <p className="text-[12px] font-medium text-gray-700 dark:text-gray-300">
              {k.name} {s?.set ? <span className="text-emerald-600">· in use{s.last4 ? `, key ending ${s.last4}` : ''}</span> : <span className="text-gray-400">· no key (free at {k.url})</span>}
            </p>
            <div className="flex items-center gap-2">
              <input type="password" autoComplete="off" aria-label={`${k.name} API key`} value={draft[k.id] || ''}
                onChange={e => setDraft(d => ({ ...d, [k.id]: e.target.value }))}
                placeholder={s?.set ? 'Paste a new key to replace it' : `${k.name} API key`}
                className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs font-mono outline-none dark:text-white" />
              <button type="submit" disabled={saving === k.id || !draft[k.id]?.trim()} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs rounded-xl shadow-sm">Save</button>
              {s?.set && <button type="button" onClick={() => save(k.id, '')} disabled={saving === k.id} className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline">Remove</button>}
            </div>
          </form>
        );
      })}
    </div>
  );
}
