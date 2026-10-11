// The LUMO page's device tab: is the clock there, which firmware it runs,
// a remote for its buttons, and finding, restarting and locking it.
import { useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Cpu, Download, KeyRound, Lock, MapPin, Power, Radio, Wifi } from 'lucide-react';
import { LumoSettings, LumoSettingsUpdate, LumoStatus, lumoApi } from '../../services/lumo';
import { useToast } from '../../context/ToastContext';
import { Panel, Row, Toggle, btnQuiet } from './parts';

function ago(ms: number | null): string {
  if (!ms) return '';
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} days ago`;
}

function uptime(seconds?: number): string {
  if (!seconds) return '';
  const d = Math.floor(seconds / 86400), h = Math.floor((seconds % 86400) / 3600), m = Math.floor((seconds % 3600) / 60);
  return d ? `${d} d ${h} h` : h ? `${h} h ${m} min` : `${m} min`;
}

function bars(rssi?: number): number {
  if (rssi === undefined) return 0;
  return rssi >= -55 ? 4 : rssi >= -65 ? 3 : rssi >= -75 ? 2 : 1;
}

export function DeviceTab({ status, settings, save, onChange }: {
  status: LumoStatus | null; settings: LumoSettings | null; save: (u: LumoSettingsUpdate) => void; onChange: () => void;
}) {
  const { showToast } = useToast();
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [pressed, setPressed] = useState('');
  const connected = !!status?.connected;

  const act = async (fn: () => Promise<unknown>, done?: string) => {
    try { await fn(); if (done) showToast(done, 'success'); onChange(); } catch (e: any) { showToast(e.message, 'error'); }
  };
  const press = async (button: string) => {
    setPressed(button);
    setTimeout(() => setPressed(''), 180);
    await act(() => lumoApi.press(button));
  };

  const pad = (button: string, icon: React.ReactNode, cls = '') => (
    <button onClick={() => press(button)} disabled={!connected} aria-label={button}
      className={`w-14 h-14 rounded-2xl surface-item flex items-center justify-center text-gray-700 dark:text-gray-200 disabled:opacity-40 active:scale-90 transition-transform ${pressed === button ? 'ring-2 ring-blue-600' : ''} ${cls}`}>
      {icon}
    </button>
  );

  const w = status?.wifi || {};
  const signal = bars(w.rssi);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 md:gap-6 items-start">
      <Panel icon={<Radio size={16} className={connected ? 'text-emerald-500' : 'text-gray-400'} />} title="Status"
        note={connected ? `Connected ${ago(status?.connectedAt ?? null)}` : status?.enabled === false ? 'Off on this Pi' : 'Not connected'}>
        {status?.enabled === false && (
          <p className="text-[13px] text-amber-700 dark:text-amber-400">The desk clock part of Sage is off on this Pi. Set SAGE_DESK=1 in /etc/sage/sage.env and restart Sage.</p>
        )}
        <dl className="grid grid-cols-2 gap-3">
          {[
            ['Firmware', status?.firmware ? `v${status.firmware}` : '—'],
            ['Address', w.ip || status?.address || '—'],
            ['Wi-Fi', w.ssid ? `${w.ssid}` : '—'],
            ['Signal', w.rssi !== undefined ? `${w.rssi} dBm` : '—'],
            ['Up for', uptime(w.uptime) || '—'],
            ['Last heard', connected ? ago(status?.lastSeen ?? null) || '—' : '—'],
          ].map(([k, v]) => (
            <div key={k} className="surface-item rounded-2xl px-3 py-2.5 min-w-0">
              <dt className="text-[11px] font-semibold uppercase tracking-wider text-gray-400 flex items-center gap-1.5">
                {k === 'Signal' && <Wifi size={11} />}{k}
              </dt>
              <dd className="text-[14px] font-semibold text-gray-900 dark:text-white truncate tabular-nums flex items-center gap-2">
                {v}
                {k === 'Signal' && signal > 0 && (
                  <span className="flex items-end gap-0.5 h-3" aria-hidden>
                    {[1, 2, 3, 4].map(i => <span key={i} className={`w-1 rounded-sm ${i <= signal ? 'bg-emerald-500' : 'bg-gray-300 dark:bg-white/15'}`} style={{ height: `${i * 25}%` }} />)}
                  </span>
                )}
              </dd>
            </div>
          ))}
        </dl>
        {connected && !w.ssid && <p className="text-[12px] text-gray-400">Wi-Fi details and uptime show from firmware 2.7.</p>}
      </Panel>

      <Panel icon={<Cpu size={16} className="text-blue-600" />} title="Firmware">
        {status?.updateAvailable ? (
          <div className="space-y-3">
            <div className="rounded-2xl bg-blue-500/10 text-blue-800 dark:text-blue-200 px-4 py-3 text-[13.5px]">
              <div className="font-semibold flex items-center gap-2"><Download size={15} /> Firmware {status.latestFirmware} is ready</div>
              <div className="mt-0.5">LUMO runs {status.firmware}. It updates over USB from your laptop.</div>
            </div>
            <ol className="list-decimal pl-5 space-y-1 text-[13px] text-gray-600 dark:text-gray-300">
              <li>Open the <b>lumo_fw2</b> sketch in the Arduino IDE (its files are updated for you).</li>
              <li>Plug LUMO in with USB and pick its port.</li>
              <li>Press Upload. LUMO restarts and reconnects by itself.</li>
            </ol>
          </div>
        ) : (
          <p className="text-[13.5px] text-gray-600 dark:text-gray-300">
            {status?.firmware ? <>LUMO is on <b>v{status.firmware}</b>, the latest{status.latestFirmware ? ` (${status.latestFirmware})` : ''}.</> : <>The latest firmware is <b>v{status?.latestFirmware || '?'}</b>.</>}
          </p>
        )}
        <div className="flex flex-wrap gap-2 pt-1">
          <button onClick={() => act(() => lumoApi.device('identify'), 'LUMO is flashing')} disabled={!connected} className={btnQuiet}><MapPin size={15} /> Find my clock</button>
          <button onClick={() => {
            if (!confirmRestart) { setConfirmRestart(true); setTimeout(() => setConfirmRestart(false), 4000); return; }
            setConfirmRestart(false);
            act(() => lumoApi.device('restart'), 'LUMO is restarting');
          }} disabled={!connected} className={btnQuiet}>
            <Power size={15} /> {confirmRestart ? 'Tap again to restart' : 'Restart'}
          </button>
        </div>
      </Panel>

      <Panel icon={<ArrowUp size={16} className="text-purple-500" />} title="Remote" note="Press LUMO's buttons from here">
        <div className="flex flex-col items-center gap-2 py-2">
          {pad('UP', <ArrowUp size={20} />)}
          <div className="flex gap-2">
            {pad('LEFT', <ArrowLeft size={20} />)}
            <button onClick={() => press('OK')} disabled={!connected} aria-label="OK"
              className={`w-14 h-14 rounded-full bg-blue-600 text-white font-bold text-[14px] disabled:opacity-40 active:scale-90 transition-transform shadow-md shadow-blue-600/30 ${pressed === 'OK' ? 'ring-4 ring-blue-300' : ''}`}>OK</button>
            {pad('RIGHT', <ArrowRight size={20} />)}
          </div>
          {pad('DOWN', <ArrowDown size={20} />)}
          <button onClick={() => press('HOLD_OK')} disabled={!connected} className={`${btnQuiet} !text-[12px] !py-1.5 mt-1`}>Hold OK</button>
        </div>
        <p className="text-[12px] text-gray-400 text-center">Showing: {status?.state?.screen ? status.state.screen.charAt(0) + status.state.screen.slice(1).toLowerCase() : '—'}</p>
      </Panel>

      <Panel icon={<Lock size={16} className="text-gray-500" />} title="Buttons and pairing">
        {settings && (
          <Row title="Lock LUMO's buttons" hint="It ignores its own presses, except to stop an alarm">
            <Toggle on={settings.buttons.locked} onChange={on => save({ buttons: { locked: on } })} label="Lock buttons" />
          </Row>
        )}
        <Row title="Pairing code" hint="DESK_TOKEN in the firmware's secrets.h">
          <span className="font-mono text-[16px] font-semibold tracking-[0.2em] text-gray-900 dark:text-white flex items-center gap-1.5">
            <KeyRound size={14} className="text-gray-400" />{status?.token || '—'}
          </span>
        </Row>
        <Row title="Port" hint="The clock connects to the Pi here">
          <span className="font-mono text-[14px] text-gray-700 dark:text-gray-200">{status?.port ?? 8765}</span>
        </Row>
      </Panel>
    </div>
  );
}
