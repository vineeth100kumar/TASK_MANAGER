// "My edge": what you know and already have, so Lab sparks and research ideas
// fit you. Saved on the Pi with Radar's other settings (raspberry_pi/radar.py).
import { useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import { api } from '../../services/api';
import { RadarEdge, radarSettingsApi } from '../../services/radar';
import { useToast } from '../../context/ToastContext';

const FIELDS: { key: keyof RadarEdge; label: string; placeholder: string; short?: boolean }[] = [
  { key: 'skills', label: 'What you know', placeholder: 'Embedded hardware, React, making reels' },
  { key: 'assets', label: 'What you already have', placeholder: "A kids' clothing brand, an Instagram audience, a Raspberry Pi setup" },
  { key: 'place', label: 'Where you are', placeholder: 'Hyderabad, India', short: true },
  { key: 'budget', label: 'Budget to start', placeholder: 'Under ₹1 lakh', short: true },
  { key: 'hours', label: 'Hours a week', placeholder: '8', short: true },
];

export const EDGE_EMPTY: RadarEdge = { skills: '', assets: '', place: '', budget: '', hours: '' };

// With nothing filled in yet, start from the projects already in Sage.
function prefill(edge: RadarEdge): RadarEdge {
  if (edge.skills || edge.assets) return edge;
  const names = api.sync.getState().projects.filter(p => p && !(p as any).deletedAt && p.name).map(p => p.name).slice(0, 6);
  return names.length ? { ...edge, assets: `Works on ${names.join(', ')}` } : edge;
}

export function EdgeEditor({ edge, onSaved, onCancel }: { edge: RadarEdge; onSaved: (edge: RadarEdge) => void; onCancel?: () => void }) {
  const { showToast } = useToast();
  const [draft, setDraft] = useState<RadarEdge>(() => prefill({ ...EDGE_EMPTY, ...edge }));
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      const settings = await radarSettingsApi.update({ edge: draft });
      onSaved(settings.edge);
      showToast('My edge saved. The next sparks use it.');
    } catch (e: any) {
      showToast(e.message || "Couldn't save", 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={e => { e.preventDefault(); save(); }} className="space-y-2.5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        {FIELDS.map(f => (
          <label key={f.key} className={`block min-w-0 ${f.short ? '' : 'sm:col-span-3'}`}>
            <span className="text-[11.5px] font-semibold text-gray-500 dark:text-gray-400">{f.label}</span>
            <input id={`edge-${f.key}`} value={draft[f.key]} maxLength={300} placeholder={f.placeholder}
              inputMode={f.key === 'hours' ? 'numeric' : undefined}
              onChange={e => setDraft({ ...draft, [f.key]: e.target.value })}
              className="mt-1 w-full px-3 py-2 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-[13px] outline-none focus:ring-2 focus:ring-blue-500/40 dark:text-white" />
          </label>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <button type="submit" disabled={saving} className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs rounded-xl shadow-sm">
          {saving && <LoaderCircle size={13} className="animate-spin" />} Save
        </button>
        {onCancel && <button type="button" onClick={onCancel} className="px-3 py-2 text-xs font-semibold text-gray-500 hover:text-gray-900 dark:hover:text-white">Cancel</button>}
      </div>
    </form>
  );
}
