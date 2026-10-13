// LumoView - The LUMO desk clock, run from Sage.
//
// LUMO is a screen and buttons for Sage's Pi (raspberry_pi/desk/), so this
// page is its control panel: alarms, the timer and stopwatch, the face and
// screens, lights and night mode, and the clock itself. Everything is read
// from and saved to the Pi; the Pi's DESK_STATE events keep it live.

import { useCallback, useEffect, useState } from 'react';
import { AlarmClock, AlertTriangle, BellOff, BellRing, Clock, Cpu, Hourglass, Lightbulb, Moon, Server, AlarmClockOff } from 'lucide-react';
import { LUMO_EVENT, LumoAlarm, LumoState, LumoStatus, compareVersions, lumoApi, lumoAvailable, untilText } from '../../services/lumo';
import { useDataChanges } from '../../hooks/useDataChanges';
import { useToast } from '../../context/ToastContext';
import { useLumoSettings } from '../lumo/parts';
import { AlarmsTab } from '../lumo/AlarmsTab';
import { TimersTab } from '../lumo/TimersTab';
import { ClockTab } from '../lumo/ClockTab';
import { LightsTab } from '../lumo/LightsTab';
import { DeviceTab } from '../lumo/DeviceTab';

type Tab = 'alarms' | 'timers' | 'clock' | 'lights' | 'device';

const TABS: { id: Tab; name: string; icon: typeof Clock }[] = [
  { id: 'alarms', name: 'Alarms', icon: AlarmClock },
  { id: 'timers', name: 'Timers', icon: Hourglass },
  { id: 'clock', name: 'Clock', icon: Clock },
  { id: 'lights', name: 'Lights', icon: Lightbulb },
  { id: 'device', name: 'Device', icon: Cpu },
];

const TAB_KEY = 'sage-lumo-tab';
const TOOLS_FIRMWARE = '2.8.0';
const DEPTH_FIRMWARE = '2.9.0';

export function LumoView() {
  const { showToast } = useToast();
  const [tab, setTabState] = useState<Tab>(() => {
    try { return (localStorage.getItem(TAB_KEY) as Tab) || 'alarms'; } catch { return 'alarms'; }
  });
  const setTab = (t: Tab) => {
    setTabState(t);
    try { localStorage.setItem(TAB_KEY, t); } catch { /* storage unavailable */ }
  };
  const [status, setStatus] = useState<LumoStatus | null>(null);
  const [live, setLive] = useState<LumoState | null>(null);
  const [alarms, setAlarms] = useState<LumoAlarm[] | null>(null);
  const [error, setError] = useState('');
  const { settings, error: settingsError, save } = useLumoSettings();

  const loadStatus = useCallback(async () => {
    try {
      const s = await lumoApi.status();
      setStatus(s);
      setLive(s.state);
      setError('');
    } catch (e: any) {
      setError(e.message || "Can't reach the Pi");
    }
  }, []);
  const loadAlarms = useCallback(async () => {
    try { setAlarms(await lumoApi.alarms()); } catch { /* the status line says why */ }
  }, []);

  useEffect(() => {
    if (!lumoAvailable()) return;
    loadStatus();
    loadAlarms();
    const timer = setInterval(loadStatus, 30000);
    const onLumo = (e: Event) => {
      const state = (e as CustomEvent).detail?.state as LumoState | undefined;
      if (state) setLive(state);
    };
    window.addEventListener(LUMO_EVENT, onLumo);
    return () => { clearInterval(timer); window.removeEventListener(LUMO_EVENT, onLumo); };
  }, [loadStatus, loadAlarms]);
  // Alarms are Sage reminders: a change anywhere (the clock snoozing one, an
  // edit on the phone) arrives through sync.
  useDataChanges(loadAlarms, 400);

  if (!lumoAvailable()) {
    return (
      <div className="max-w-md mx-auto text-center py-20 space-y-3">
        <div className="surface-item p-4 rounded-2xl inline-flex text-gray-500"><Server size={28} /></div>
        <h3 className="text-lg font-semibold tracking-tight text-gray-900 dark:text-white">LUMO talks to the Pi</h3>
        <p className="text-[14px] text-gray-500">The desk clock is run by Sage's Pi server, so its controls show when the app is opened from the Pi.</p>
      </div>
    );
  }

  const connected = !!status?.connected;
  const toolsSupported = connected ? compareVersions(status?.firmware ?? null, TOOLS_FIRMWARE) >= 0 : true;
  const depthSupported = connected ? compareVersions(status?.firmware ?? null, DEPTH_FIRMWARE) >= 0 : true;
  const ringing = live?.ringing;
  const timerDone = live?.timer.state === 'done';
  const next = (alarms || []).filter(a => a.enabled && a.nextRing).sort((a, b) => a.nextRing!.localeCompare(b.nextRing!))[0];

  const ringAction = async (action: 'snooze' | 'stop') => {
    try {
      const s = await lumoApi.ringing(action);
      setLive(s.state);
      loadAlarms();
    } catch (e: any) {
      showToast(e.message, 'error');
    }
  };

  const tagline = error ? `Can't reach the Pi right now (${error}).`
    : !status ? 'Asking the Pi…'
    : !status.enabled ? 'The desk clock is off on this Pi. Alarms you set here still ring as reminders.'
    : !connected ? 'LUMO is not connected. Alarms you set here reach it when it is back.'
    : next ? `Next alarm: ${next.label} ${untilText(next.nextRing)}.`
    : 'No alarm is set.';

  return (
    <div className="max-w-6xl mx-auto space-y-4 md:space-y-6">
      <div className="hero p-5 md:p-7 rounded-3xl space-y-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="min-w-0">
            <div className="eyebrow text-gray-500 dark:text-gray-400 mb-2">
              <span className={`inline-block w-2 h-2 rounded-full ${connected ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.18)]' : 'bg-gray-400'}`} />
              <span>{connected ? `Connected · v${status?.firmware}` : 'Desk clock'}{live?.night ? ' · Night' : ''}</span>
              {live?.night && <Moon size={12} className="text-indigo-400" />}
            </div>
            <h1 className="text-display text-[28px] md:text-[44px] font-semibold leading-[1.05] pb-1">LUMO</h1>
            <p className="text-[14.5px] text-gray-500 dark:text-gray-400 mt-1">{tagline}</p>
          </div>
          <div className="flex p-1 rounded-xl bg-black/[0.04] dark:bg-white/5 w-full md:w-auto overflow-x-auto no-scrollbar" role="tablist">
            {TABS.map(t => (
              <button key={t.id} role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)}
                className={`flex-1 md:flex-none flex items-center justify-center gap-1 md:gap-1.5 px-2 md:px-3 py-1.5 rounded-lg text-[12.5px] md:text-[13px] font-semibold transition-colors whitespace-nowrap ${tab === t.id ? 'bg-white dark:bg-[#2c2c2e] shadow-sm ring-1 ring-black/5 text-gray-900 dark:text-white' : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'}`}>
                <t.icon size={14} className="hidden sm:block" />{t.name}
              </button>
            ))}
          </div>
        </div>

        {connected && !toolsSupported && (
          <p className="text-[12.5px] font-medium text-amber-700 dark:text-amber-400 flex items-start gap-1.5">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            LUMO runs v{status?.firmware}. Flash v{status?.latestFirmware || TOOLS_FIRMWARE} for the timer, stopwatch and world screens, alarm sounds and haptics settings (see Device).
          </p>
        )}
      </div>

      {ringing && (
        <div className="rounded-3xl p-4 md:p-5 bg-red-500/10 ring-1 ring-red-500/30 flex items-center gap-4 flex-wrap">
          <BellRing size={26} className="text-red-500 animate-bounce shrink-0" />
          <div className="flex-1 min-w-0">
            <div className="text-[16px] font-semibold text-gray-900 dark:text-white">{ringing.label} is ringing</div>
            <div className="text-[13px] text-gray-500">Since {new Date(ringing.since).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}</div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => ringAction('snooze')} className="px-4 py-2.5 rounded-xl surface-item font-semibold text-[14px] text-gray-800 dark:text-gray-100 flex items-center gap-1.5"><AlarmClockOff size={16} /> Snooze</button>
            <button onClick={() => ringAction('stop')} className="px-4 py-2.5 rounded-xl bg-red-600 text-white font-semibold text-[14px] flex items-center gap-1.5 shadow-sm shadow-red-600/30"><BellOff size={16} /> Stop</button>
          </div>
        </div>
      )}
      {timerDone && !ringing && (
        <div className="rounded-3xl p-4 md:p-5 bg-amber-500/10 ring-1 ring-amber-500/30 flex items-center gap-4 flex-wrap">
          <Hourglass size={24} className="text-amber-500 shrink-0" />
          <div className="flex-1 text-[16px] font-semibold text-gray-900 dark:text-white">{live?.timer.label || 'Timer'} is done</div>
          <button onClick={async () => { try { setLive((await lumoApi.timer('cancel')).state); } catch (e: any) { showToast(e.message, 'error'); } }}
            className="px-4 py-2.5 rounded-xl bg-amber-500 text-white font-semibold text-[14px]">Stop</button>
        </div>
      )}

      {tab === 'alarms' && (
        <AlarmsTab alarms={alarms} settings={settings} save={save} reload={loadAlarms} connected={connected} tonesSupported={toolsSupported} />
      )}
      {tab === 'timers' && (
        <TimersTab timer={live?.timer ?? null} stopwatch={live?.stopwatch ?? null} enabled={status?.enabled !== false} onChange={loadStatus} />
      )}
      {(tab === 'clock' || tab === 'lights') && !settings && (
        settingsError
          ? <p className="text-[14px] text-gray-500 text-center py-10">Can't load LUMO's settings: {settingsError}</p>
          : <div className="grid grid-cols-1 lg:grid-cols-2 gap-4" aria-busy="true"><div className="skeleton h-72" /><div className="skeleton h-72" /></div>
      )}
      {tab === 'clock' && settings && <ClockTab settings={settings} save={save} toolsSupported={toolsSupported} depthSupported={depthSupported} />}
      {tab === 'lights' && settings && <LightsTab settings={settings} save={save} night={!!live?.night} toolsSupported={toolsSupported} />}
      {tab === 'device' && <DeviceTab status={status} settings={settings} save={save} onChange={loadStatus} />}
    </div>
  );
}
