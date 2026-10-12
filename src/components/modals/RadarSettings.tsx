import { useEffect, useState } from 'react';
import { Radar } from 'lucide-react';
import { RadarSettings as Settings, radarAvailable, radarSettingsApi } from '../../services/radar';
import { useToast } from '../../context/ToastContext';

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
      <Row title="India news and markets" detail="Economic Times, Mint, BusinessLine, Inc42 and YourStory, plus Nifty 50, Sensex, Nifty Bank and the rupee. The India filter in Signals shows Indian news on its own.">
        <Toggle on={settings.india} onChange={india => save({ india })} label="India news and markets" />
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
