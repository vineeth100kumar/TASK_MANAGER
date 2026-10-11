// The LUMO page's alarms: a list of cards, each switched on or off in one
// tap and edited in place, plus the settings every alarm shares.
import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { AlarmClock, BellRing, ChevronDown, Plus, Trash2, Volume2, Loader2, SlidersHorizontal } from 'lucide-react';
import {
  AlarmDraft, AlarmTone, DAY_NAMES, LumoAlarm, LumoSettings, LumoSettingsUpdate,
  ampm, clockText, daysText, lumoApi, untilText,
} from '../../services/lumo';
import { useToast } from '../../context/ToastContext';
import { Panel, Row, Segmented, Slider, Toggle, btnDanger, btnPrimary, btnQuiet, selectCls } from './parts';

export const TONES: { id: AlarmTone; name: string; hint: string }[] = [
  { id: 'pulse', name: 'Pulse', hint: 'Beep-beep, like a heartbeat' },
  { id: 'classic', name: 'Classic', hint: 'Four quick beeps' },
  { id: 'rising', name: 'Rising', hint: 'Slow beeps that build over a minute' },
  { id: 'chirp', name: 'Chirp', hint: 'Three short chirps' },
];

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
}

export function AlarmsTab({ alarms, settings, save, reload, connected, tonesSupported }: AlarmsTabProps) {
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
              <AlarmEditor draft={BLANK} settings={settings} hour24={hour24} isNew connected={connected} tonesSupported={tonesSupported}
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
                    <AlarmEditor draft={a} settings={settings} hour24={hour24} connected={connected} tonesSupported={tonesSupported}
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
                <select className={`${selectCls} w-full`} value={settings.alarm.tone} onChange={e => save({ alarm: { tone: e.target.value as AlarmTone } })}>
                  {TONES.map(t => <option key={t.id} value={t.id}>{t.name}: {t.hint}</option>)}
                </select>
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
            </div>
          )}
        </Panel>
      </div>
    </div>
  );
}

function AlarmEditor({ draft, settings, hour24, isNew, connected, tonesSupported, onSave, onCancel, onDelete }: {
  draft: AlarmDraft; settings: LumoSettings | null; hour24: boolean; isNew?: boolean; connected: boolean; tonesSupported: boolean;
  onSave: (d: AlarmDraft) => Promise<void>; onCancel: () => void; onDelete?: () => Promise<void>;
}) {
  const { showToast } = useToast();
  const [d, setD] = useState<AlarmDraft>({ ...draft });
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

  const hear = async () => {
    try {
      await lumoApi.device('tone', tone, volume);
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  };

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
          <button onClick={hear} disabled={!connected || !tonesSupported} className={`${btnQuiet} !py-1 !px-2.5 !text-[12px]`} title={connected ? 'Play it on LUMO for a few seconds' : 'LUMO is not connected'}>
            <Volume2 size={13} /> Hear it on LUMO
          </button>
        </div>
        <Segmented<string> value={d.tone ?? 'default'} onChange={v => set({ tone: v === 'default' ? null : (v as AlarmTone) })} size="sm"
          options={[{ id: 'default', label: 'Default' }, ...TONES.map(t => ({ id: t.id, label: t.name }))]} />
        <p className="text-[12px] text-gray-400">{d.tone ? TONES.find(t => t.id === d.tone)?.hint : `Follows "Every alarm" (${TONES.find(t => t.id === settings?.alarm.tone)?.name || 'Pulse'})`}</p>
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
