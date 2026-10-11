// DeskClockSettings - Pick how the LUMO desk clock shows the time.
//
// The Pi keeps the clock's settings (raspberry_pi/desk/settings.py) and sends
// the chosen face to the clock straight away. The pictures are the clock's
// own drawing code rendered off the device, so what you pick is what you get.

import { useEffect, useState } from 'react';
import { Check, Clock, Loader2 } from 'lucide-react';
import { piBackendUrl, piHeaders } from '../../services/piBackend';
import { useToast } from '../../context/ToastContext';

const card = 'p-5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-4';

const FACES: { id: string; name: string; hint: string }[] = [
  { id: 'monolith', name: 'Monolith', hint: 'One large, light time' },
  { id: 'stacked', name: 'Stacked', hint: 'Hours over minutes, details on the side' },
  { id: 'nightstand', name: 'Nightstand', hint: 'Warm amber glow for the bedside' },
  { id: 'dial', name: 'Dial', hint: 'A watch dial with a date window' },
];
const CLASSIC: { id: string; name: string; hint: string }[] = [
  { id: 'digital', name: 'Classic', hint: 'Greeting, time, date and weather' },
  { id: 'minimal', name: 'Classic minimal', hint: 'Time and date only' },
  { id: 'analog', name: 'Classic analog', hint: 'Thin dial and hands' },
];

type Load = 'loading' | 'ready' | 'offline';

function FaceButton({ face, chosen, saving, onPick }: {
  face: { id: string; name: string; hint: string };
  chosen: boolean;
  saving: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onPick(face.id)}
      disabled={saving}
      aria-pressed={chosen}
      className={`group text-left rounded-2xl p-1.5 transition-all disabled:opacity-60 ${
        chosen ? 'bg-blue-600/10 ring-2 ring-blue-600' : 'hover:bg-black/[0.03] dark:hover:bg-white/5 ring-1 ring-black/5 dark:ring-white/10'
      }`}
    >
      <img
        src={`/lumo-faces/${face.id}.png`}
        alt={`${face.name} clock face`}
        width={320}
        height={216}
        className="w-full rounded-xl bg-black"
        style={{ imageRendering: 'auto' }}
        loading="lazy"
      />
      <div className="flex items-start gap-2 px-1.5 pt-2 pb-1">
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold text-gray-900 dark:text-white">{face.name}</div>
          <div className="text-xs text-gray-400 truncate">{face.hint}</div>
        </div>
        {chosen && (
          <span className="mt-0.5 w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0">
            {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          </span>
        )}
      </div>
    </button>
  );
}

export function DeskClockSettings() {
  const { showToast } = useToast();
  const [load, setLoad] = useState<Load>('loading');
  const [style, setStyle] = useState<string>('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch(`${piBackendUrl()}/api/desk/settings`, { headers: piHeaders() })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(data => {
        if (!alive) return;
        setStyle(data?.settings?.clock?.style || 'digital');
        setLoad('ready');
      })
      .catch(() => alive && setLoad('offline'));
    return () => { alive = false; };
  }, []);

  const pick = async (id: string) => {
    if (id === style || saving) return;
    const before = style;
    setStyle(id);
    setSaving(true);
    try {
      const res = await fetch(`${piBackendUrl()}/api/desk/settings`, {
        method: 'PUT',
        headers: piHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ clock: { style: id } }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => null))?.detail || `HTTP ${res.status}`);
      const data = await res.json();
      setStyle(data?.settings?.clock?.style || id);
    } catch (err: any) {
      setStyle(before);
      showToast(`Couldn't change the clock face: ${err.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className={card}>
        <div className="flex items-center gap-2">
          <Clock size={16} className="text-blue-600" />
          <h4 className="font-semibold text-sm text-gray-900 dark:text-white">Clock face</h4>
        </div>
        <p className="text-xs text-gray-400">
          How LUMO shows the time. The clock changes as soon as you pick one. The four new faces need LUMO firmware 2.1 or later.
        </p>

        {load === 'loading' && (
          <div className="flex items-center gap-2 text-xs text-gray-400 py-6 justify-center">
            <Loader2 size={14} className="animate-spin" /> Asking the Pi…
          </div>
        )}
        {load === 'offline' && (
          <div className="text-xs text-gray-500 dark:text-gray-400 py-4">
            Sage can't reach the Pi right now, so the clock face can't be changed from here. Check the Pi's address and key under Server & Reset.
          </div>
        )}
        {load === 'ready' && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {FACES.map(f => <FaceButton key={f.id} face={f} chosen={style === f.id} saving={saving} onPick={pick} />)}
            </div>
            <div className="pt-2">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 mb-2">Classic</div>
              <div className="grid grid-cols-3 gap-2">
                {CLASSIC.map(f => <FaceButton key={f.id} face={f} chosen={style === f.id} saving={saving} onPick={pick} />)}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
