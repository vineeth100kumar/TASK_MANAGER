// The LUMO page's clock settings: the face, how the time reads, the World
// screen's places, and which screens UP and DOWN step through.
import { useMemo, useState } from 'react';
import { Check, Clock, Globe2, LayoutGrid, Plus, X } from 'lucide-react';
import { LumoSettings, LumoSettingsUpdate } from '../../services/lumo';
import { Panel, Row, Toggle, selectCls } from './parts';
import { DepthFacePanel } from './DepthFacePanel';
import { Select } from '../common/Select';

export const FACES: { id: string; name: string; hint: string; classic?: boolean }[] = [
  { id: 'monolith', name: 'Monolith', hint: 'One large, light time' },
  { id: 'stacked', name: 'Stacked', hint: 'Hours over minutes' },
  { id: 'nightstand', name: 'Nightstand', hint: 'Warm amber for the bedside' },
  { id: 'dial', name: 'Dial', hint: 'A watch dial with a date' },
  { id: 'digital', name: 'Classic', hint: 'Greeting, time, weather', classic: true },
  { id: 'minimal', name: 'Classic minimal', hint: 'Time and date', classic: true },
  { id: 'analog', name: 'Classic analog', hint: 'Thin dial and hands', classic: true },
];

const SCREENS: { id: string; name: string; hint: string; needs28?: boolean }[] = [
  { id: 'CLOCK', name: 'Clock', hint: 'The face you picked' },
  { id: 'TASKS', name: 'Today', hint: "Today's tasks from Sage" },
  { id: 'SPOTIFY', name: 'Now playing', hint: "What your phone's playing" },
  { id: 'TIMER', name: 'Timer', hint: 'OK pauses, RIGHT adds a minute', needs28: true },
  { id: 'STOPWATCH', name: 'Stopwatch', hint: 'OK starts, RIGHT laps', needs28: true },
  { id: 'WORLD', name: 'World', hint: 'Your places side by side', needs28: true },
  { id: 'SYSTEM', name: 'Pi vitals', hint: 'Temperature, CPU and memory' },
];

const COMMON_ZONES = ['Europe/London', 'America/New_York', 'America/Los_Angeles', 'Europe/Berlin', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'Asia/Kolkata', 'UTC'];

function zoneName(zone: string) {
  return zone.split('/').pop()!.replace(/_/g, ' ');
}

function zoneNow(zone: string, hour24: boolean) {
  try {
    return new Date().toLocaleTimeString('en-US', { timeZone: zone, hour: 'numeric', minute: '2-digit', hour12: !hour24 });
  } catch {
    return '';
  }
}

export function ClockTab({ settings, save, toolsSupported, depthSupported }: { settings: LumoSettings; save: (u: LumoSettingsUpdate) => void; toolsSupported: boolean; depthSupported: boolean }) {
  const zones = useMemo<string[]>(() => {
    try { return (Intl as any).supportedValuesOf('timeZone'); } catch { return COMMON_ZONES; }
  }, []);
  const [newZone, setNewZone] = useState('');
  const world = settings.world.zones;
  const addZone = (zone: string) => {
    if (!zone || world.includes(zone) || world.length >= 3) return;
    save({ world: { zones: [...world, zone] } });
    setNewZone('');
  };

  const toggleScreen = (id: string, on: boolean) => {
    const order = SCREENS.map(s => s.id);
    const next = on ? [...settings.screens, id].sort((a, b) => order.indexOf(a) - order.indexOf(b)) : settings.screens.filter(s => s !== id);
    if (next.length) save({ screens: next });
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <Panel icon={<Clock size={16} className="text-blue-600" />} title="Clock face" note="Changes on LUMO straight away">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {FACES.filter(f => !f.classic).map(f => <Face key={f.id} face={f} chosen={settings.clock.style === f.id} onPick={() => save({ clock: { style: f.id } })} />)}
        </div>
        <div className="grid grid-cols-3 gap-2 md:max-w-[75%]">
          {FACES.filter(f => f.classic).map(f => <Face key={f.id} face={f} chosen={settings.clock.style === f.id} onPick={() => save({ clock: { style: f.id } })} small />)}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 pt-2">
          <Row title="24-hour time" hint={settings.clock.hour24 ? '18:30' : '6:30 PM'}>
            <Toggle on={settings.clock.hour24} onChange={on => save({ clock: { hour24: on } })} label="24-hour time" />
          </Row>
          <Row title="Seconds" hint="On the faces that show them">
            <Toggle on={settings.clock.seconds} onChange={on => save({ clock: { seconds: on } })} label="Show seconds" />
          </Row>
          <Row title="Second time zone" hint="A small line on the face">
            <Select className={`${selectCls} max-w-44`} value={settings.clock.secondZone} onChange={v => save({ clock: { secondZone: v } })}>
              <option value="">None</option>
              {zones.map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
            </Select>
          </Row>
        </div>
      </Panel>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 items-start">
        <Panel icon={<Globe2 size={16} className="text-emerald-500" />} title="World clock" note={`${world.length} of 3`}>
          <ul className="divide-y divide-black/5 dark:divide-white/5">
            <li className="flex items-center justify-between py-2.5">
              <div><div className="text-[14px] font-medium text-gray-500">Here</div></div>
              <div className="text-[18px] font-semibold tabular-nums text-gray-500">{zoneNow(Intl.DateTimeFormat().resolvedOptions().timeZone, settings.clock.hour24)}</div>
            </li>
            {world.map(z => (
              <li key={z} className="flex items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <div className="text-[14px] font-semibold text-gray-900 dark:text-white truncate">{zoneName(z)}</div>
                  <div className="text-[12px] text-gray-400 truncate">{z}</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="text-[18px] font-semibold tabular-nums text-gray-900 dark:text-white">{zoneNow(z, settings.clock.hour24)}</div>
                  <button onClick={() => save({ world: { zones: world.filter(x => x !== z) } })} aria-label={`Remove ${zoneName(z)}`}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-500/10"><X size={15} /></button>
                </div>
              </li>
            ))}
          </ul>
          {world.length < 3 && (
            <div className="space-y-2">
              <div className="flex gap-2">
                <Select className={`${selectCls} flex-1 min-w-0`} value={newZone} onChange={v => setNewZone(v)} aria-label="Add a place">
                  <option value="">Add a place…</option>
                  {zones.filter(z => !world.includes(z)).map(z => <option key={z} value={z}>{z.replace(/_/g, ' ')}</option>)}
                </Select>
                <button onClick={() => addZone(newZone)} disabled={!newZone} className="px-3 rounded-xl bg-blue-600 text-white disabled:opacity-40" aria-label="Add"><Plus size={16} /></button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {COMMON_ZONES.filter(z => !world.includes(z)).slice(0, 6).map(z => (
                  <button key={z} onClick={() => addZone(z)} className="px-2.5 py-1 rounded-lg text-[12px] font-semibold text-gray-500 bg-black/[0.04] dark:bg-white/5 hover:text-gray-900 dark:hover:text-white">+ {zoneName(z)}</button>
                ))}
              </div>
            </div>
          )}
          <p className="text-[12px] text-gray-400">Shown on LUMO's World screen{toolsSupported ? '' : ' (needs firmware 2.8)'}. Add World to the screens to step to it.</p>
        </Panel>

        <Panel icon={<LayoutGrid size={16} className="text-purple-500" />} title="Screens" note="UP and DOWN step through these">
          <ul className="space-y-1">
            {SCREENS.map(s => {
              const on = settings.screens.includes(s.id);
              return (
                <li key={s.id} className="flex items-center justify-between gap-3 py-1.5">
                  <div className="min-w-0">
                    <div className="text-[14px] font-medium text-gray-900 dark:text-white flex items-center gap-2">
                      {s.name}
                      {settings.homeScreen === s.id && <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md text-blue-600 bg-blue-500/10">Home</span>}
                      {s.needs28 && !toolsSupported && <span className="text-[10.5px] font-semibold px-1.5 py-0.5 rounded-md text-amber-700 dark:text-amber-400 bg-amber-500/10">FW 2.8</span>}
                    </div>
                    <div className="text-[12px] text-gray-500 dark:text-gray-400 truncate">{s.hint}</div>
                  </div>
                  <Toggle on={on} onChange={v => toggleScreen(s.id, v)} label={s.name} disabled={on && settings.screens.length === 1} />
                </li>
              );
            })}
          </ul>
          <Row title="Home screen" hint="Where LUMO starts">
            <Select className={selectCls} value={settings.homeScreen} onChange={v => save({ homeScreen: v })}>
              {SCREENS.filter(s => settings.screens.includes(s.id)).map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </Select>
          </Row>
        </Panel>
      </div>

      <DepthFacePanel settings={settings} save={save} supported={depthSupported} />
    </div>
  );
}

function Face({ face, chosen, onPick, small }: { face: { id: string; name: string; hint: string }; chosen: boolean; onPick: () => void; small?: boolean }) {
  return (
    <button onClick={onPick} aria-pressed={chosen}
      className={`group text-left rounded-2xl p-1.5 transition-all ${chosen ? 'bg-blue-600/10 ring-2 ring-blue-600' : 'hover:bg-black/[0.03] dark:hover:bg-white/5 ring-1 ring-black/5 dark:ring-white/10'}`}>
      <img src={`/lumo-faces/${face.id}.png`} alt={`${face.name} clock face`} width={320} height={216} loading="lazy" className="w-full rounded-xl bg-black" />
      <div className="flex items-start gap-2 px-1.5 pt-2 pb-1">
        <div className="min-w-0 flex-1">
          <div className={`${small ? 'text-[12.5px]' : 'text-sm'} font-semibold text-gray-900 dark:text-white truncate`}>{face.name}</div>
          {!small && <div className="text-xs text-gray-400 truncate">{face.hint}</div>}
        </div>
        {chosen && <span className="mt-0.5 w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center shrink-0"><Check size={12} /></span>}
      </div>
    </button>
  );
}
