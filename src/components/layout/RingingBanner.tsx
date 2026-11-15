// A ringing LUMO alarm, or a finished timer, with Stop and Snooze right where you
// are in the app: any page, phone or laptop. (The same buttons used to live only
// on the LUMO page.)
import { useCallback, useEffect, useState } from 'react';
import { AlarmClockOff, BellOff, BellRing, Hourglass, Plus } from 'lucide-react';
import { LUMO_EVENT, LumoState, lumoApi, lumoAvailable } from '../../services/lumo';
import { useToast } from '../../context/ToastContext';

export function RingingBanner() {
  const [live, setLive] = useState<LumoState | null>(null);
  const [busy, setBusy] = useState(false);
  const { showToast } = useToast();

  const load = useCallback(async () => {
    try { setLive((await lumoApi.status()).state); } catch { /* the Pi is unreachable: show nothing */ }
  }, []);

  useEffect(() => {
    if (!lumoAvailable()) return;
    void load();
    const poll = window.setInterval(load, 30000);
    const onLumo = (e: Event) => {
      const state = (e as CustomEvent).detail?.state as LumoState | undefined;
      if (state) setLive(state);
    };
    window.addEventListener(LUMO_EVENT, onLumo);
    return () => { window.clearInterval(poll); window.removeEventListener(LUMO_EVENT, onLumo); };
  }, [load]);

  const ringing = live?.ringing;
  const timerDone = live?.timer?.state === 'done';
  if (!ringing && !timerDone) return null;

  const run = async (job: () => Promise<{ state: LumoState | null }>) => {
    setBusy(true);
    try { setLive((await job()).state); } catch (e: any) { showToast(e?.message || 'LUMO did not answer', 'error'); }
    setBusy(false);
  };

  const btn = 'px-4 py-2.5 rounded-xl font-semibold text-[14px] flex items-center gap-1.5 disabled:opacity-60';
  return (
    <div role="alert" className="fixed left-3 right-3 md:left-1/2 md:right-auto md:-translate-x-1/2 md:w-[28rem] z-[60] top-[calc(0.75rem+env(safe-area-inset-top))]">
      {ringing ? (
        <div className="rounded-2xl p-3.5 bg-white dark:bg-[#18181b] ring-1 ring-red-500/40 shadow-2xl flex items-center gap-3 flex-wrap">
          <BellRing size={24} className="text-red-500 animate-bounce shrink-0" />
          <div className="flex-1 min-w-[8rem]">
            <div className="text-[15px] font-semibold text-gray-900 dark:text-white">{ringing.label || 'Alarm'} is ringing</div>
            <div className="text-[12px] text-gray-500">on LUMO</div>
          </div>
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => run(() => lumoApi.ringing('snooze'))} className={`${btn} surface-item text-gray-800 dark:text-gray-100`}><AlarmClockOff size={16} /> Snooze</button>
            <button disabled={busy} onClick={() => run(() => lumoApi.ringing('stop'))} className={`${btn} bg-red-600 text-white shadow-sm shadow-red-600/30`}><BellOff size={16} /> Stop</button>
          </div>
        </div>
      ) : (
        <div className="rounded-2xl p-3.5 bg-white dark:bg-[#18181b] ring-1 ring-amber-500/40 shadow-2xl flex items-center gap-3 flex-wrap">
          <Hourglass size={22} className="text-amber-500 shrink-0" />
          <div className="flex-1 min-w-[8rem] text-[15px] font-semibold text-gray-900 dark:text-white">{live?.timer.label || 'Timer'} is done</div>
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => run(() => lumoApi.timer('add', 300))} className={`${btn} surface-item text-gray-800 dark:text-gray-100`}><Plus size={16} /> 5 min</button>
            <button disabled={busy} onClick={() => run(() => lumoApi.timer('cancel'))} className={`${btn} bg-amber-500 text-white`}><BellOff size={16} /> Stop</button>
          </div>
        </div>
      )}
    </div>
  );
}
