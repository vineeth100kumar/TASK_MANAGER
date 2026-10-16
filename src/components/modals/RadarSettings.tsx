import { useEffect, useState } from 'react';
import { KeyRound, Radar } from 'lucide-react';
import { piBackendUrl, piHeaders } from '../../services/piBackend';
import { RadarSettings as Settings, radarAvailable, radarSettingsApi } from '../../services/radar';
import { useToast } from '../../context/ToastContext';
import { EdgeEditor } from '../radar/EdgeEditor';

function Toggle({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}
      className={`relative w-10 h-6 rounded-full transition-colors shrink-0 ${on ? 'bg-blue-600' : 'bg-gray-300 dark:bg-white/20'}`}>
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${on ? 'translate-x-4' : ''}`} />
    </button>
  );
}

function Row({ title, detail, children }: { title: string; detail: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 p-4 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5">
      <div className="min-w-0">
        <p className="text-[13.5px] font-semibold text-gray-900 dark:text-white">{title}</p>
        <p className="text-[12px] text-gray-500 dark:text-gray-400">{detail}</p>
      </div>
      {children}
    </div>
  );
}

type KeyStatus = { set: boolean; last4: string | null; usedToday: number; perDay: number };

// The free Twelve Data key that Radar's prices come from. Saved on the Pi.
function PricesKey() {
  const { showToast } = useToast();
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [key, setKey] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`${piBackendUrl()}/api/settings/prices-key`, { headers: piHeaders() })
      .then(res => (res.ok ? res.json() : null)).then(json => json && setStatus(json)).catch(() => {});
  }, []);

  const save = async (value: string) => {
    setSaving(true);
    try {
      const res = await fetch(`${piBackendUrl()}/api/settings/prices-key`, {
        method: 'POST', headers: piHeaders({ 'Content-Type': 'application/json' }), body: JSON.stringify({ key: value }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.detail || `The Pi said ${res.status}`);
      setStatus(json);
      setKey('');
      showToast(value ? 'Twelve Data key saved on the Pi' : 'Twelve Data key removed');
    } catch (e: any) {
      showToast(e.message || "Couldn't save the key", 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={e => { e.preventDefault(); if (key.trim()) save(key); }}
      className="p-4 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-2.5">
      <p className="flex items-center gap-2 text-[13.5px] font-semibold text-gray-900 dark:text-white"><KeyRound size={15} /> Market prices key</p>
      <p className="text-[12px] text-gray-500 dark:text-gray-400">
        US and world prices come from Twelve Data. Get a free key at twelvedata.com (sign up, then API keys). India's indices come from NSE and need no key.
      </p>
      <p className="text-[12px] font-medium text-gray-700 dark:text-gray-300">
        {status === null ? 'Checking…' : status.set
          ? `In use: key ending in ${status.last4}. ${status.usedToday} of ${status.perDay} calls used today.`
          : 'No key yet, so US and world prices fall back to slower free sources.'}
      </p>
      <div className="flex items-center gap-2">
        <input type="password" autoComplete="off" aria-label="Twelve Data API key" value={key} onChange={e => setKey(e.target.value)}
          placeholder={status?.set ? 'Paste a new key to replace it' : 'Twelve Data API key'}
          className="flex-1 min-w-0 px-3 py-2 rounded-xl bg-white dark:bg-white/5 border border-black/10 dark:border-white/10 text-xs font-mono outline-none dark:text-white" />
        <button type="submit" disabled={saving || !key.trim()} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-semibold text-xs rounded-xl shadow-sm">
          {saving ? 'Checking…' : 'Save'}
        </button>
      </div>
      {status?.set && (
        <button type="button" onClick={() => save('')} disabled={saving} className="text-xs font-semibold text-red-600 dark:text-red-400 hover:underline">Remove key</button>
      )}
    </form>
  );
}

// Settings > Radar. Kept on the Pi, so every device shares them.
export function RadarSettings() {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!radarAvailable()) return;
    radarSettingsApi.get().then(setSettings).catch(e => setError(e.message));
  }, []);

  const save = async (changes: Partial<Settings>) => {
    if (!settings) return;
    setSettings({ ...settings, ...changes });
    try {
      setSettings(await radarSettingsApi.update(changes));
    } catch (e: any) {
      showToast(e.message || "Couldn't save", 'error');
    }
  };

  if (!radarAvailable()) return <p className="text-[13px] text-gray-500">Radar runs on the Pi server, so its settings show when Sage is opened from the Pi.</p>;
  if (error) return <p className="text-[13px] text-red-500">{error}</p>;
  if (!settings) return <div className="skeleton h-40" />;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-[13px] text-gray-500"><Radar size={16} className="text-purple-500" /> Radar shows in Work and All, never in Personal.</div>
      <Row title="India news and markets" detail="Economic Times, Mint, BusinessLine, Inc42 and YourStory, plus Nifty 50, Nifty Midcap, Nifty Bank and the rupee. The India filter in Signals shows Indian news on its own.">
        <Toggle on={settings.india} onChange={india => save({ india })} label="India news and markets" />
      </Row>
      <PricesKey />
      <div className="p-4 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-2.5">
        <p className="text-[13.5px] font-semibold text-gray-900 dark:text-white">My edge</p>
        <p className="text-[12px] text-gray-500 dark:text-gray-400">What you know and already have. The Lab's sparks and Studio's research rate every idea on how well it fits this.</p>
        <EdgeEditor key={JSON.stringify(settings.edge)} edge={settings.edge} onSaved={edge => setSettings({ ...settings, edge })} />
      </div>
      <Row title="Sparks each morning" detail="How many business-idea sparks the Lab makes at 7:00. One AI call makes the whole batch.">
        <select value={settings.sparksPerDay} onChange={e => save({ sparksPerDay: Number(e.target.value) as Settings['sparksPerDay'] })}
          className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-white/10 border border-black/10 dark:border-white/10 text-[13px] font-semibold">
          {[3, 5, 10].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
      </Row>
      <Row title="Radar brief on Today" detail="Three signals, the biggest market move and the hottest topic, on the Today screen.">
        <Toggle on={settings.brief} onChange={brief => save({ brief })} label="Radar brief on Today" />
      </Row>
      <Row title="Research runs a day" detail="Each run makes 4 to 6 AI calls. Resets at midnight.">
        <input type="number" min={0} max={50} value={settings.dailyCap}
          onChange={e => save({ dailyCap: Math.max(0, Math.min(50, Number(e.target.value) || 0)) })}
          className="w-16 px-2 py-1.5 rounded-xl bg-white dark:bg-white/10 border border-black/10 dark:border-white/10 text-[13px] font-semibold text-center tabular-nums" />
      </Row>
      <Row title="AI for research" detail="Groq is free with the key under Server & Reset. Claude writes sharper dossiers and is paid per run. The other one is the backup.">
        <select value={settings.engine} onChange={e => save({ engine: e.target.value as Settings['engine'] })}
          className="px-2.5 py-1.5 rounded-xl bg-white dark:bg-white/10 border border-black/10 dark:border-white/10 text-[13px] font-semibold">
          <option value="groq">Groq first</option>
          <option value="claude">Claude first</option>
        </select>
      </Row>
      <Row title="Radar line on LUMO" detail="Mornings, the clock's Tasks screen adds one line: the hottest topic and the biggest market move.">
        <Toggle on={settings.lumoLine} onChange={lumoLine => save({ lumoLine })} label="Radar line on LUMO" />
      </Row>
    </div>
  );
}
