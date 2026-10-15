// The LUMO page's light ring, night mode, haptics and welcome back message.
import { useEffect, useState } from 'react';
import { Home, Lightbulb, Moon, Vibrate } from 'lucide-react';
import { LumoSettings, LumoSettingsUpdate } from '../../services/lumo';
import { FACES } from './ClockTab';
import { Panel, Row, Segmented, Slider, Toggle, selectCls } from './parts';
import { Select } from '../common/Select';
import { TimePicker } from '../common/TimePicker';

const MODES: { id: string; name: string; hint: string; swatch: string }[] = [
  { id: 'AUTO', name: 'Auto', hint: 'Each face and screen has its own calm light', swatch: 'bg-gradient-to-br from-sky-400 via-amber-300 to-rose-400' },
  { id: 'WARM', name: 'Warm', hint: 'A steady warm white', swatch: 'bg-amber-300' },
  { id: 'BREATHE', name: 'Breathe', hint: 'Slowly brightens and fades', swatch: 'bg-gradient-to-br from-blue-300 to-blue-500' },
  { id: 'AURORA', name: 'Aurora', hint: 'Soft colours drifting round', swatch: 'bg-gradient-to-br from-emerald-300 via-teal-400 to-violet-500' },
  { id: 'PHOTO', name: 'Photo', hint: "The main colour of your depth photo (warm white when there isn't one)", swatch: 'bg-gradient-to-br from-amber-400 via-pink-400 to-sky-400' },
  { id: 'OFF', name: 'Off', hint: 'The ring stays dark', swatch: 'bg-gray-700' },
];

const AWAY_CHOICES = [5, 15, 30, 60, 120, 240];
const awayLabel = (m: number) => (m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}`);

const pct = (v: number) => `${Math.round((v / 255) * 100)}%`;

export function LightsTab({ settings, save, night, toolsSupported }: { settings: LumoSettings; save: (u: LumoSettingsUpdate) => void; night: boolean; toolsSupported: boolean }) {
  const n = settings.night;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 items-start">
      <Panel icon={<Lightbulb size={16} className="text-amber-500" />} title="Light ring" note={night ? 'Night mode is on now' : undefined}>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {MODES.map(m => (
            <button key={m.id} onClick={() => save({ lights: { mode: m.id } })} aria-pressed={settings.lights.mode === m.id}
              className={`rounded-2xl p-3 text-left transition-all ${settings.lights.mode === m.id ? 'ring-2 ring-blue-600 bg-blue-600/5' : 'ring-1 ring-black/5 dark:ring-white/10 hover:bg-black/[0.03] dark:hover:bg-white/5'}`}>
              <span className={`block w-7 h-7 rounded-full ${m.swatch} shadow-inner mb-2`} />
              <span className="block text-[13px] font-semibold text-gray-900 dark:text-white">{m.name}</span>
            </button>
          ))}
        </div>
        <p className="text-[12px] text-gray-400">{MODES.find(m => m.id === settings.lights.mode)?.hint}</p>
        <div className="space-y-2">
          <div className="text-[13px] font-medium text-gray-500">Brightness</div>
          <Slider label="Ring brightness" value={settings.lights.brightness} min={0} max={255} format={pct} onCommit={v => save({ lights: { brightness: v } })} />
        </div>
      </Panel>

      <Panel icon={<Moon size={16} className="text-indigo-500" />} title="Night mode"
        right={<Toggle on={n.enabled} onChange={on => save({ night: { enabled: on } })} label="Night mode" />}>
        <p className="text-[13px] text-gray-500 dark:text-gray-400">
          Between these times LUMO dims its ring, can switch to a night face, and its knocks get softer. Alarms still ring as loud as you set them.
        </p>
        <div className={`space-y-3 ${n.enabled ? '' : 'opacity-50 pointer-events-none'}`}>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1 block">
              <span className="text-[13px] font-medium text-gray-500">From</span>
              <TimePicker clearable={false} value={n.start} onChange={v => v && save({ night: { start: v } })} className={`${selectCls} w-full tabular-nums`} />
            </label>
            <label className="space-y-1 block">
              <span className="text-[13px] font-medium text-gray-500">Until</span>
              <TimePicker clearable={false} value={n.end} onChange={v => v && save({ night: { end: v } })} className={`${selectCls} w-full tabular-nums`} />
            </label>
          </div>
          <Row title="Face at night">
            <Select className={selectCls} value={n.face} onChange={v => save({ night: { face: v } })}>
              <option value="">Keep the usual face</option>
              {FACES.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </Select>
          </Row>
          <div className="space-y-2">
            <div className="text-[13px] font-medium text-gray-500">Ring at night</div>
            <Segmented value={n.lightsMode} onChange={v => save({ night: { lightsMode: v } })} size="sm"
              options={MODES.map(m => ({ id: m.id, label: m.name }))} />
            <Slider label="Night ring brightness" value={n.brightness} min={0} max={255} format={pct} onCommit={v => save({ night: { brightness: v } })} />
          </div>
        </div>
      </Panel>

      <Panel icon={<Vibrate size={16} className="text-rose-500" />} title="Haptics" note={toolsSupported ? undefined : 'The switches need firmware 2.8'}>
        <div className="space-y-2">
          <div className="text-[13px] font-medium text-gray-500">Strength</div>
          <Slider label="Haptic strength" value={settings.haptics.strength} min={0} max={100}
            format={v => (v === 0 ? 'Off' : `${v}%`)} onCommit={v => save({ haptics: { strength: v } })} />
        </div>
        <Row title="Knock on every button press" hint="A silent tap you feel">
          <Toggle on={settings.haptics.buttons} onChange={on => save({ haptics: { buttons: on } })} label="Button knocks" />
        </Row>
        <Row title="Knock for notifications and reminders" hint="Two taps when a card comes up">
          <Toggle on={settings.haptics.notifications} onChange={on => save({ haptics: { notifications: on } })} label="Notification knocks" />
        </Row>
        <p className="text-[12px] text-gray-400">Only alarms and timers make a sound; everything else is a silent knock.</p>
      </Panel>

      <WelcomePanel settings={settings} save={save} />
    </div>
  );
}

// When your phone reconnects to Sage's Bluetooth after you've been out, LUMO
// shows this message with what's on today.
function WelcomePanel({ settings, save }: { settings: LumoSettings; save: (u: LumoSettingsUpdate) => void }) {
  const w = settings.welcome;
  const [message, setMessage] = useState(w.message);
  useEffect(() => setMessage(w.message), [w.message]);
  const commit = () => {
    const text = message.trim();
    if (!text) setMessage(w.message);
    else if (text !== w.message) save({ welcome: { message: text } });
  };
  const away = AWAY_CHOICES.includes(w.awayMinutes) ? AWAY_CHOICES : [...AWAY_CHOICES, w.awayMinutes].sort((a, b) => a - b);
  return (
    <Panel icon={<Home size={16} className="text-emerald-500" />} title="Welcome back"
      right={<Toggle on={w.enabled} onChange={on => save({ welcome: { enabled: on } })} label="Welcome back" />}>
      <p className="text-[13px] text-gray-500 dark:text-gray-400">
        When your phone connects to Sage's Bluetooth after you've been out, LUMO greets you with what's on today and your next alarm.
      </p>
      <div className={`space-y-3 ${w.enabled ? '' : 'opacity-50 pointer-events-none'}`}>
        <label className="space-y-1 block">
          <span className="text-[13px] font-medium text-gray-500">Message</span>
          <input value={message} maxLength={27} onChange={e => setMessage(e.target.value)} onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
            className={`${selectCls} w-full`} aria-label="Welcome message" />
        </label>
        <Row title="After you've been out for" hint="Shorter trips don't get a greeting">
          <Select className={selectCls} value={String(w.awayMinutes)} onChange={v => save({ welcome: { awayMinutes: Number(v) } })}>
            {away.map(m => <option key={m} value={String(m)}>{awayLabel(m)}</option>)}
          </Select>
        </Row>
      </div>
    </Panel>
  );
}
