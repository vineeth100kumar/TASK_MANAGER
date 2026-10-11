// The LUMO page's light ring, night mode and haptics.
import { Lightbulb, Moon, Vibrate } from 'lucide-react';
import { LumoSettings, LumoSettingsUpdate } from '../../services/lumo';
import { FACES } from './ClockTab';
import { Panel, Row, Segmented, Slider, Toggle, selectCls } from './parts';

const MODES: { id: string; name: string; hint: string; swatch: string }[] = [
  { id: 'AUTO', name: 'Auto', hint: 'Each face and screen has its own calm light', swatch: 'bg-gradient-to-br from-sky-400 via-amber-300 to-rose-400' },
  { id: 'WARM', name: 'Warm', hint: 'A steady warm white', swatch: 'bg-amber-300' },
  { id: 'BREATHE', name: 'Breathe', hint: 'Slowly brightens and fades', swatch: 'bg-gradient-to-br from-blue-300 to-blue-500' },
  { id: 'AURORA', name: 'Aurora', hint: 'Soft colours drifting round', swatch: 'bg-gradient-to-br from-emerald-300 via-teal-400 to-violet-500' },
  { id: 'OFF', name: 'Off', hint: 'The ring stays dark', swatch: 'bg-gray-700' },
];

const pct = (v: number) => `${Math.round((v / 255) * 100)}%`;

export function LightsTab({ settings, save, night, toolsSupported }: { settings: LumoSettings; save: (u: LumoSettingsUpdate) => void; night: boolean; toolsSupported: boolean }) {
  const n = settings.night;
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 items-start">
      <Panel icon={<Lightbulb size={16} className="text-amber-500" />} title="Light ring" note={night ? 'Night mode is on now' : undefined}>
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
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
              <input type="time" value={n.start} onChange={e => e.target.value && save({ night: { start: e.target.value } })} className={`${selectCls} w-full tabular-nums`} />
            </label>
            <label className="space-y-1 block">
              <span className="text-[13px] font-medium text-gray-500">Until</span>
              <input type="time" value={n.end} onChange={e => e.target.value && save({ night: { end: e.target.value } })} className={`${selectCls} w-full tabular-nums`} />
            </label>
          </div>
          <Row title="Face at night">
            <select className={selectCls} value={n.face} onChange={e => save({ night: { face: e.target.value } })}>
              <option value="">Keep the usual face</option>
              {FACES.map(f => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </Row>
          <div className="space-y-2">
            <div className="text-[13px] font-medium text-gray-500">Ring at night</div>
            <Segmented value={n.lightsMode} onChange={v => save({ night: { lightsMode: v } })} size="sm"
              options={MODES.map(m => ({ id: m.id, label: m.name }))} />
            <Slider label="Night ring brightness" value={n.brightness} min={0} max={255} format={pct} onCommit={v => save({ night: { brightness: v } })} />
          </div>
        </div>
      </Panel>

      <Panel icon={<Vibrate size={16} className="text-rose-500" />} title="Haptics" note={toolsSupported ? undefined : 'Needs firmware 2.7'}>
        <Row title="Knock on every button press" hint="A silent tap you feel">
          <Toggle on={settings.haptics.buttons} onChange={on => save({ haptics: { buttons: on } })} label="Button knocks" />
        </Row>
        <Row title="Knock for notifications and reminders" hint="Two taps when a card comes up">
          <Toggle on={settings.haptics.notifications} onChange={on => save({ haptics: { notifications: on } })} label="Notification knocks" />
        </Row>
        <p className="text-[12px] text-gray-400">Only alarms and timers make a sound; everything else is a silent knock.</p>
      </Panel>
    </div>
  );
}
