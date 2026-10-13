// The LUMO page's alarms: a list of cards, each switched on or off in one
// tap and edited in place, plus the settings every alarm shares.
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlarmClock, BellRing, Check, ChevronDown, Play, Plus, Trash2, Volume2, Loader2, SlidersHorizontal } from 'lucide-react';
import {
  AlarmDraft, AlarmTone, DAY_NAMES, LumoAlarm, LumoSettings, LumoSettingsUpdate,
  ampm, clockText, daysText, lumoApi, untilText,
} from '../../services/lumo';
import { useToast } from '../../context/ToastContext';
import { Panel, Row, Slider, Toggle, btnDanger, btnPrimary, btnQuiet, selectCls } from './parts';
import { ALARM_SOUND_SHAPES } from './alarmSounds';

// The sounds, in the firmware's order (tones.h). fw211: new in firmware 2.11.
export const TONES: { id: AlarmTone; name: string; hint: string; fw211?: boolean }[] = [
  { id: 'pulse', name: 'Pulse', hint: 'Tick-tock, high then low, like a heartbeat' },
  { id: 'classic', name: 'Classic', hint: 'Four quick beeps, the loudest pitch' },
  { id: 'rising', name: 'Rising', hint: 'Three notes climbing a chord, builds over a minute' },
  { id: 'chirp', name: 'Chirp', hint: 'Three bird-like chirps' },
  { id: 'chime', name: 'Chime', hint: 'A three-note bell, high to low, ringing out', fw211: true },
  { id: 'dawn', name: 'Dawn', hint: 'Soft, slow notes that take two minutes to get loud', fw211: true },
  { id: 'melody', name: 'Melody', hint: 'A short morning tune that climbs to the top', fw211: true },
  { id: 'urgent', name: 'Urgent', hint: 'A fast warble for heavy sleepers', fw211: true },
];

// Play one cycle of a sound on LUMO's buzzer, then it stops by itself.
async function playOnce(tone: AlarmTone, volume: number, onError: (m: string) => void) {
  try {
    await lumoApi.device('tone', tone, volume);
  } catch (e: any) {
    onError(e.message);
  }
}

// One cycle of a sound as notes: higher pitch higher up, softer notes fainter.
function SoundShape({ tone, className = '' }: { tone: AlarmTone; className?: string }) {
  const shape = ALARM_SOUND_SHAPES[tone];
  if (!shape) return null;
  const lo = 2300, hi = 3550;
  return (
    <svg viewBox="0 0 100 24" preserveAspectRatio="none" className={className} aria-hidden="true">
      <line x1="0" x2="100" y1="23.5" y2="23.5" className="stroke-current opacity-15" strokeWidth="0.6" vectorEffect="non-scaling-stroke" />
      {shape.notes.map(([start, len, hz, peak], i) => {
        const y = 20 - ((hz - lo) / (hi - lo)) * 17;
        return <rect key={i} x={(start / shape.cycleMs) * 100} y={y - 1.6} width={Math.max(0.8, (len / shape.cycleMs) * 100)} height={3.2} rx={1.2}
          className="fill-current" opacity={0.35 + 0.65 * (peak / 255)} />;
      })}
    </svg>
  );
}

// The sound list: picking one plays it once on LUMO (when it's there to play it).
function SoundPicker({ value, onPick, onPlay, canPlay, soundsSupported, defaultName }: {
  value: AlarmTone | null; onPick: (t: AlarmTone | null) => void; onPlay: (t: AlarmTone) => void;
  canPlay: boolean; soundsSupported: boolean; defaultName?: string;
}) {
  const card = (on: boolean) => `relative text-left rounded-2xl border p-3 transition-colors ${on ? 'border-blue-500/50 bg-blue-500/[0.06]' : 'border-black/5 dark:border-white/10 hover:border-black/15 dark:hover:border-white/20'}`;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {defaultName !== undefined && (
        <button type="button" onClick={() => onPick(null)} aria-pressed={value === null} className={card(value === null)}>
          <div className="text-[13px] font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">{value === null && <Check size={13} className="text-blue-600" />}Default</div>
          <div className="text-[11.5px] text-gray-500 mt-0.5 leading-snug">Follows "Every alarm" ({defaultName})</div>
        </button>
      )}
      {TONES.map(t => {
        const on = value === t.id;
        const old = t.fw211 && !soundsSupported;
        return (
          <div key={t.id} className={card(on)}>
            <button type="button" onClick={() => { onPick(t.id); if (canPlay && !old) onPlay(t.id); }} aria-pressed={on} className="block w-full text-left pr-7">
              <div className="text-[13px] font-semibold text-gray-900 dark:text-white flex items-center gap-1.5">{on && <Check size={13} className="text-blue-600" />}{t.name}</div>
              <SoundShape tone={t.id} className={`w-full h-5 my-1.5 ${on ? 'text-blue-600' : 'text-gray-500 dark:text-gray-400'}`} />
              <div className="text-[11.5px] text-gray-500 leading-snug">{old ? 'Needs LUMO firmware 2.11' : t.hint}</div>
            </button>
            <button type="button" onClick={() => onPlay(t.id)} disabled={!canPlay || old} title={canPlay ? 'Play once on LUMO' : 'LUMO is not connected'}
              aria-label={`Play ${t.name} once on LUMO`}
              className="absolute top-2 right-2 p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-500/10 disabled:opacity-40 disabled:pointer-events-none">
              <Play size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

const PRESETS: { name: string; days: number[] }[] = [
  { name: 'Once', days: [] },
  { name: 'Weekdays', days: [0, 1, 2, 3, 4] },
  { name: 'Weekends', days: [5, 6] },
  { name: 'Every day', days: [0, 1, 2, 3, 4, 5, 6] },
];

const SNOOZES = [1, 3, 5, 9, 10, 15, 20, 30];

const BLANK: AlarmDraft = { label: 'Alarm', time: '07:00', days: [0, 1, 2, 3, 4], enabled: true, tone: null, volume: null, snoozeMinutes: null };

interface AlarmsTabProps {
  alarms: LumoAlarm[] | null;
  settings: LumoSettings | null;
  save: (u: LumoSettingsUpdate) => void;
  reload: () => void;
  connected: boolean;
  tonesSupported: boolean;
  soundsSupported: boolean;
}

export function AlarmsTab({ alarms, settings, save, reload, connected, tonesSupported, soundsSupported }: AlarmsTabProps) {
  const { showToast } = useToast();
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [local, setLocal] = useState<LumoAlarm[] | null>(alarms);
  useEffect(() => setLocal(alarms), [alarms]);
  const hour24 = settings?.clock.hour24 ?? false;

  const toggle = async (a: LumoAlarm, on: boolean) => {
    setLocal(list => list?.map(x => (x.id === a.id ? { ...x, enabled: on } : x)) || null);
    setBusy(b => ({ ...b, [a.id]: true }));
    try {
      const saved = await lumoApi.updateAlarm(a.id, { enabled: on });
      setLocal(list => list?.map(x => (x.id === a.id ? saved : x)) || null);
      if (on && saved.nextRing) showToast(`${saved.label} rings ${untilText(saved.nextRing)}`, 'success');
    } catch (e: any) {
      setLocal(alarms);
      showToast(`Couldn't change the alarm: ${e.message}`, 'error');
    } finally {
      setBusy(b => ({ ...b, [a.id]: false }));
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6 items-start">
      <div className="lg:col-span-8 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-[13px] text-gray-500 dark:text-gray-400">
            {local === null ? '' : `${local.length} alarm${local.length === 1 ? '' : 's'}, ${local.filter(a => a.enabled).length} on`}
          </p>
          <button onClick={() => { setAdding(true); setOpenId(null); }} className={btnPrimary}><Plus size={15} /> New alarm</button>
        </div>

        <AnimatePresence initial={false}>
          {adding && (
            <motion.div key="new" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
              <AlarmEditor draft={BLANK} settings={settings} hour24={hour24} isNew connected={connected} tonesSupported={tonesSupported} soundsSupported={soundsSupported}
                onCancel={() => setAdding(false)}
                onSave={async (d) => {
                  const made = await lumoApi.createAlarm(d);
                  setLocal(list => [...(list || []), made].sort((a, b) => a.time.localeCompare(b.time)));
                  setAdding(false);
                  showToast(made.nextRing ? `${made.label} rings ${untilText(made.nextRing)}` : 'Alarm saved', 'success');
                  reload();
                }} />
            </motion.div>
          )}
        </AnimatePresence>

        {local === null ? (
          <div className="space-y-3" aria-busy="true"><div className="skeleton h-24" /><div className="skeleton h-24" /></div>
        ) : local.length === 0 && !adding ? (
          <div className="surface rounded-3xl border border-black/5 dark:border-white/5 py-14 text-center space-y-2">
            <AlarmClock size={30} className="mx-auto text-gray-300 dark:text-gray-600" />
            <p className="text-[14px] text-gray-500">No alarms yet. Make one and LUMO rings it.</p>
          </div>
        ) : local.map(a => (
          <div key={a.id} className={`surface rounded-3xl border transition-colors ${openId === a.id ? 'border-blue-500/30' : 'border-black/5 dark:border-white/5'}`}>
            <div role="button" tabIndex={0} onClick={() => setOpenId(openId === a.id ? null : a.id)}
              onKeyDown={e => { if (e.key === 'Enter') setOpenId(openId === a.id ? null : a.id); }}
              className="flex items-center gap-4 p-4 md:px-6 cursor-pointer select-none">
              <div className={`min-w-0 flex-1 ${a.enabled ? '' : 'opacity-45'}`}>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-[34px] md:text-[40px] font-semibold tracking-[-0.03em] tabular-nums leading-none text-gray-900 dark:text-white">{clockText(a.time, hour24)}</span>
                  {!hour24 && <span className="text-[14px] font-semibold text-gray-500">{ampm(a.time)}</span>}
                </div>
                <div className="mt-1.5 text-[13px] text-gray-500 dark:text-gray-400 truncate">
                  <span className="font-semibold text-gray-700 dark:text-gray-200">{a.label}</span> · {daysText(a.days)}
                  {a.enabled && a.nextRing && <> · {a.snoozed ? 'snoozed, rings ' : ''}{untilText(a.nextRing)}</>}
                </div>
              </div>
              <ChevronDown size={18} className={`text-gray-400 transition-transform hidden sm:block ${openId === a.id ? 'rotate-180' : ''}`} />
              {busy[a.id] ? <Loader2 size={18} className="animate-spin text-gray-400" /> : null}
              <Toggle on={a.enabled} onChange={on => toggle(a, on)} label={`${a.label} at ${a.time}`} />
            </div>
            <AnimatePresence initial={false}>
              {openId === a.id && (
                <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden">
                  <div className="px-4 pb-4 md:px-6 md:pb-6">
                    <AlarmEditor draft={a} settings={settings} hour24={hour24} connected={connected} tonesSupported={tonesSupported} soundsSupported={soundsSupported}
                      onCancel={() => setOpenId(null)}
                      onDelete={async () => {
                        await lumoApi.deleteAlarm(a.id);
                        setLocal(list => list?.filter(x => x.id !== a.id) || null);
                        setOpenId(null);
                        showToast('Alarm moved to the Trash', 'success');
                        reload();
                      }}
                      onSave={async (d) => {
                        const saved = await lumoApi.updateAlarm(a.id, d);
                        setLocal(list => list?.map(x => (x.id === a.id ? saved : x)) || null);
                        setOpenId(null);
                        showToast('Alarm saved', 'success');
                        reload();
                      }} />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        ))}
      </div>

      <div className="lg:col-span-4">
        <Panel icon={<SlidersHorizontal size={16} className="text-blue-600" />} title="Every alarm">
          {!settings ? <div className="skeleton h-40" /> : (
            <div className="space-y-4">
              <div className="space-y-2">
                <div className="text-[13px] font-medium text-gray-500">Sound</div>
                <select className={`${selectCls} w-full`} value={settings.alarm.tone} onChange={e => {
                  const tone = e.target.value as AlarmTone;
                  save({ alarm: { tone } });
                  const t = TONES.find(x => x.id === tone);
                  if (connected && tonesSupported && !(t?.fw211 && !soundsSupported)) playOnce(tone, settings.alarm.volume, m => showToast(m, 'error'));
                }}>
                  {TONES.map(t => <option key={t.id} value={t.id}>{t.name}: {t.hint}</option>)}
                </select>
                <SoundShape tone={settings.alarm.tone} className="w-full h-5 text-gray-400" />
                <p className="text-[12px] text-gray-400">Picking a sound plays it once on LUMO.</p>
              </div>
              <div className="space-y-2">
                <div className="text-[13px] font-medium text-gray-500 flex items-center gap-1.5"><Volume2 size={13} /> Volume</div>
                <Slider label="Alarm volume" value={settings.alarm.volume} min={5} max={100} format={v => `${v}%`} onCommit={v => save({ alarm: { volume: v } })} />
              </div>
              <Row title="Snooze" hint="RIGHT on the clock">
                <select className={selectCls} value={settings.alarm.snoozeMinutes} onChange={e => save({ alarm: { snoozeMinutes: Number(e.target.value) } })}>
                  {SNOOZES.map(m => <option key={m} value={m}>{m} min</option>)}
                </select>
              </Row>
              <Row title="Rings for" hint="Then it stops by itself">
                <select className={selectCls} value={settings.alarm.ringMinutes} onChange={e => save({ alarm: { ringMinutes: Number(e.target.value) } })}>
                  {[1, 2, 5, 10, 15, 20, 30].map(m => <option key={m} value={m}>{m} min</option>)}
                </select>
              </Row>
              {!tonesSupported && <p className="text-[12px] text-amber-700 dark:text-amber-400">The sound and volume need LUMO firmware 2.8. Until it's flashed, every alarm pulses.</p>}
              {tonesSupported && !soundsSupported && <p className="text-[12px] text-amber-700 dark:text-amber-400">Chime, Dawn, Melody and Urgent need LUMO firmware 2.11. Until it's flashed they ring as Pulse.</p>}
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function AlarmEditor({ draft, settings, hour24, isNew, connected, tonesSupported, soundsSupported, onSave, onCancel, onDelete }: {
  draft: AlarmDraft; settings: LumoSettings | null; hour24: boolean; isNew?: boolean; connected: boolean; tonesSupported: boolean; soundsSupported: boolean;
  onSave: (d: AlarmDraft) => Promise<void>; onCancel: () => void; onDelete?: () => Promise<void>;
}) {
  const { showToast } = useToast();
  // Only the fields an alarm is saved with (an existing alarm also carries id, nextRing and snoozed).
  const [d, setD] = useState<AlarmDraft>({
    label: draft.label, time: draft.time, days: draft.days, enabled: draft.enabled,
    tone: draft.tone, volume: draft.volume, snoozeMinutes: draft.snoozeMinutes,
  });
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const set = (patch: Partial<AlarmDraft>) => setD(prev => ({ ...prev, ...patch }));
  const toggleDay = (day: number) => set({ days: d.days.includes(day) ? d.days.filter(x => x !== day) : [...d.days, day].sort() });
  const tone = d.tone || settings?.alarm.tone || 'pulse';
  const volume = d.volume ?? settings?.alarm.volume ?? 80;

  const submit = async () => {
    setSaving(true);
    try {
      await onSave({ ...d, enabled: isNew ? true : d.enabled });
    } catch (e: any) {
      showToast(`Couldn't save the alarm: ${e.message}`, 'error');
    } finally {
      setSaving(false);
    }
  };

  const play = (t: AlarmTone) => playOnce(t, volume, m => showToast(m, 'error'));

  return (
    <div className={`space-y-5 ${isNew ? 'surface rounded-3xl border border-blue-500/30 p-4 md:p-6' : 'pt-2 border-t border-black/5 dark:border-white/5'}`}>
      {isNew && <h3 className="font-semibold text-[15px] text-gray-900 dark:text-white flex items-center gap-2"><BellRing size={16} className="text-blue-600" /> New alarm</h3>}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <label className="space-y-1.5 block">
          <span className="text-[13px] font-medium text-gray-500">Time</span>
          <input type="time" value={d.time} onChange={e => e.target.value && set({ time: e.target.value })}
            className={`${selectCls} w-full text-[22px] font-semibold tabular-nums py-2.5`} />
          {!hour24 && <span className="text-[12px] text-gray-400">Shows on LUMO as {clockText(d.time, false)} {ampm(d.time)}</span>}
        </label>
        <label className="space-y-1.5 block">
          <span className="text-[13px] font-medium text-gray-500">Label</span>
          <input value={d.label} maxLength={40} onChange={e => set({ label: e.target.value })} placeholder="Alarm"
            className={`${selectCls} w-full py-3`} />
        </label>
      </div>

      <div className="space-y-2">
        <span className="text-[13px] font-medium text-gray-500">Repeat</span>
        <div className="flex gap-1.5">
          {DAY_NAMES.map((name, i) => (
            <button key={name} onClick={() => toggleDay(i)} aria-pressed={d.days.includes(i)}
              className={`flex-1 h-10 rounded-xl text-[13px] font-semibold transition-colors ${d.days.includes(i) ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/25' : 'bg-black/[0.04] dark:bg-white/5 text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}>
              <span className="sm:hidden">{name[0]}</span><span className="hidden sm:inline">{name}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map(p => {
            const on = p.days.join(',') === [...d.days].sort().join(',');
            return (
              <button key={p.name} onClick={() => set({ days: p.days })}
                className={`px-2.5 py-1 rounded-lg text-[12px] font-semibold ${on ? 'text-blue-700 dark:text-blue-300 bg-blue-500/10' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}>
                {p.name}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <span className="text-[13px] font-medium text-gray-500">Sound</span>
          <button onClick={() => play(tone)} disabled={!connected || !tonesSupported} className={`${btnQuiet} !py-1 !px-2.5 !text-[12px]`} title={connected ? 'Play it once on LUMO' : 'LUMO is not connected'}>
            <Volume2 size={13} /> Hear it on LUMO
          </button>
        </div>
        <SoundPicker value={d.tone} onPick={t => set({ tone: t })} onPlay={play} canPlay={connected && tonesSupported}
          soundsSupported={soundsSupported} defaultName={TONES.find(t => t.id === settings?.alarm.tone)?.name || 'Pulse'} />
        <p className="text-[12px] text-gray-400">{connected ? 'Picking a sound plays it once on LUMO, at this alarm\'s volume.' : 'Connect LUMO to hear the sounds on it.'}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[13px] font-medium text-gray-500">Volume</span>
            <label className="text-[12px] text-gray-500 flex items-center gap-1.5">
              <input type="checkbox" className="accent-blue-600" checked={d.volume === null} onChange={e => set({ volume: e.target.checked ? null : volume })} /> Default
            </label>
          </div>
          {d.volume === null
            ? <div className="text-[13px] text-gray-400 py-1.5">{settings?.alarm.volume ?? 80}% (every alarm)</div>
            : <Slider label="Volume" value={d.volume} min={5} max={100} format={v => `${v}%`} onCommit={v => set({ volume: v })} />}
        </div>
        <div className="space-y-2">
          <span className="text-[13px] font-medium text-gray-500">Snooze</span>
          <select className={`${selectCls} w-full`} value={d.snoozeMinutes ?? ''} onChange={e => set({ snoozeMinutes: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Default ({settings?.alarm.snoozeMinutes ?? 5} min)</option>
            {SNOOZES.map(m => <option key={m} value={m}>{m} min</option>)}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-2 pt-1 flex-wrap">
        <button onClick={submit} disabled={saving} className={btnPrimary}>{saving && <Loader2 size={14} className="animate-spin" />}{isNew ? 'Set alarm' : 'Save'}</button>
        <button onClick={onCancel} className={btnQuiet}>Cancel</button>
        {onDelete && (
          <button onClick={async () => { if (!confirmDelete) { setConfirmDelete(true); return; } await onDelete().catch((e: any) => showToast(e.message, 'error')); }}
            className={`${btnDanger} ml-auto`}>
            <Trash2 size={14} /> {confirmDelete ? 'Tap again to delete' : 'Delete'}
          </button>
        )}
      </div>
    </div>
  );
}
