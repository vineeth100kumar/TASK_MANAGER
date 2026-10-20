// The LUMO page's device tab: is the clock there, how steady its link to the
// Pi is, which firmware it runs, a remote for its buttons, and finding,
// restarting and locking it.
import { useState } from 'react';
import { Activity, ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Cpu, Download, Gauge, KeyRound, Lock, MapPin, Pin, Power, Radio, RefreshCw, RotateCcw, Wifi } from 'lucide-react';
import { LumoLink, LumoPerf, LumoSettings, LumoSettingsUpdate, LumoStatus, LumoUpdates, lumoApi } from '../../services/lumo';
import { useToast } from '../../context/ToastContext';
import { Panel, Row, Toggle, btnQuiet, selectCls } from './parts';

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

function since(ms: number | null | undefined): string {
  if (!ms) return '';
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'under a minute';
  if (s < 3600) return `${Math.round(s / 60)} min`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${Math.round((s % 3600) / 60)} min`;
  return `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`;
}

const LINK_LOOK: Record<LumoLink['state'], { label: string; cls: string; dot: string }> = {
  steady: { label: 'Steady', cls: 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300', dot: 'bg-emerald-500' },
  flaky: { label: 'Dropping', cls: 'bg-amber-500/10 text-amber-800 dark:text-amber-300', dot: 'bg-amber-500' },
  down: { label: 'Offline', cls: 'bg-red-500/10 text-red-700 dark:text-red-300', dot: 'bg-red-500' },
};

// The link between LUMO and the Pi: steady, dropping or offline, why it last
// dropped, and its recent connects and drops.
function LinkPanel({ link }: { link: LumoLink }) {
  const look = LINK_LOOK[link.state];
  const facts: [string, string][] = [
    [link.state === 'down' ? 'Offline for' : 'Up for', since(link.since) || '—'],
    ['Drops, 24 h', String(link.drops24h)],
    ['Ping', link.rtt !== null && link.rtt !== undefined && link.rtt >= 0 ? `${link.rtt} ms` : '—'],
    ['Last restart', link.lastBoot || '—'],
  ];
  return (
    <Panel icon={<Activity size={16} className={link.state === 'steady' ? 'text-emerald-500' : link.state === 'flaky' ? 'text-amber-500' : 'text-red-500'} />}
      title="Link to the Pi" note="Both ends ping every 10 s">
      <div className={`rounded-2xl px-4 py-3 text-[13.5px] ${look.cls}`}>
        <div className="font-semibold flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${look.dot} ${link.state === 'steady' ? '' : 'animate-pulse'}`} />{look.label}
        </div>
        {link.lastDrop && (
          <div className="mt-0.5">Last drop {ago(link.lastDrop.at)}: {link.lastDrop.detail}.</div>
        )}
        {link.state === 'down' && (
          <div className="mt-0.5">LUMO keeps time, rings its alarms and runs its timer on its own, and tells Sage what it did when it's back.</div>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-3">
        {facts.map(([k, v]) => (
          <div key={k} className="surface-item rounded-2xl px-3 py-2.5 min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{k}</dt>
            <dd className="text-[14px] font-semibold text-gray-900 dark:text-white truncate tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      {link.history.length > 0 && (
        <ul className="space-y-1.5">
          {link.history.slice(0, 6).map((h, i) => (
            <li key={`${h.at}-${i}`} className="flex gap-2 text-[12.5px] min-w-0">
              <span className={`mt-1.5 w-1.5 h-1.5 rounded-full shrink-0 ${h.event === 'connected' ? 'bg-emerald-500' : h.event === 'dropped' ? 'bg-red-400' : 'bg-gray-300'}`} />
              <span className="text-gray-400 shrink-0 tabular-nums w-20">{ago(h.at)}</span>
              <span className="text-gray-700 dark:text-gray-200 min-w-0 break-words">
                {h.event === 'connected' ? 'Connected' : h.event === 'dropped' ? 'Dropped' : 'Sage restarted'}{h.detail && h.event !== 'sage started' ? `: ${h.detail}` : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

// Firmware 2.18's frame meter: how smoothly the screen ran in the half
// minute before LUMO's last status.
function ScreenPanel({ perf }: { perf: LumoPerf }) {
  const num = (v: number | undefined, unit: string, digits = 0) => (typeof v === 'number' ? `${v.toFixed(digits)}${unit}` : '—');
  const stall = perf.stallMs ?? 0;
  const facts: [string, string][] = [
    ['Frames a second', num(perf.fps, '', 1)],
    ['Best second', num(perf.peakFps, ' fps')],
    ['Average frame', num(perf.frameMs, ' ms', 1)],
    ['Slowest frame', num(perf.worstMs, ' ms', 1)],
  ];
  return (
    <Panel icon={<Gauge size={16} className={stall > 2000 ? 'text-amber-500' : 'text-emerald-500'} />} title="Screen"
      note={perf.seconds ? `Last ${perf.seconds} s` : undefined}>
      <dl className="grid grid-cols-2 gap-3">
        {facts.map(([k, v]) => (
          <div key={k} className="surface-item rounded-2xl px-3 py-2.5 min-w-0">
            <dt className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{k}</dt>
            <dd className="text-[14px] font-semibold text-gray-900 dark:text-white truncate tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="text-[12px] text-gray-500 dark:text-gray-400">
        {stall > 2000
          ? `The screen stood still for ${(stall / 1000).toFixed(1)} s at one point.`
          : `Longest pause between frames: ${num(perf.stallMs, ' ms')}.`} A frame is any moment LUMO redraws part of the screen.
      </p>
    </Panel>
  );
}

function bars(rssi?: number): number {
  if (rssi === undefined) return 0;
  return rssi >= -55 ? 4 : rssi >= -65 ? 3 : rssi >= -75 ? 2 : 1;
}

export function DeviceTab({ status, updates, settings, save, onChange }: {
  status: LumoStatus | null; updates: LumoUpdates | null; settings: LumoSettings | null; save: (u: LumoSettingsUpdate) => void; onChange: () => void;
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
        {connected && !w.ssid && <p className="text-[12px] text-gray-400">Wi-Fi details and uptime show from firmware 2.8.</p>}
      </Panel>

      {status?.link && <LinkPanel link={status.link} />}

      {connected && w.perf && <ScreenPanel perf={w.perf} />}

      <Panel icon={<Cpu size={16} className="text-blue-600" />} title="Firmware">
        {updates && (updates.canUpdate || updates.state !== 'idle') ? (
          <OverTheAir updates={updates} firmware={status?.firmware ?? null} auto={settings?.updates?.auto ?? true}
            setAuto={on => save({ updates: { auto: on } })} when={settings?.updates?.window ?? '03:00-05:00'}
            setWhen={w => save({ updates: { window: w } })} act={act} />
        ) : status?.updateAvailable ? (
          <div className="space-y-3">
            <div className="rounded-2xl bg-blue-500/10 text-blue-800 dark:text-blue-200 px-4 py-3 text-[13.5px]">
              <div className="font-semibold flex items-center gap-2"><Download size={15} /> Firmware {status.latestFirmware} is ready</div>
              <div className="mt-0.5">LUMO runs {status.firmware}. It updates over USB from your laptop.</div>
            </div>
            <ol className="list-decimal pl-5 space-y-1 text-[13px] text-gray-600 dark:text-gray-300">
              <li>Open the <b>lumo_fw2</b> sketch in the Arduino IDE, with the files from Sage's <b>lumo/esp32_client</b> folder.</li>
              <li>Plug LUMO in with USB and pick its port. Keep <b>partitions.csv</b> in the sketch folder; it sets the flash layout for updates over Wi-Fi.</li>
              <li>Press Upload. LUMO restarts and reconnects by itself.</li>
            </ol>
            <p className="text-[12px] text-gray-400">From firmware 2.13, LUMO updates itself over Wi-Fi whenever a change is merged on GitHub, so this is the last time you need the cable.</p>
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

// Firmware 2.13+: GitHub builds each merged firmware change and the Pi sends
// it to LUMO over Wi-Fi, by itself when automatic updates are on (inside the
// update window, unless held on a version). From 2.18 a new version starts on
// trial and goes back to the old one by itself if its checks fail. Any of the
// last builds can be installed from the list, older ones too.
const WINDOWS: { id: string; label: string }[] = [
  { id: '', label: 'Any time' },
  { id: '03:00-05:00', label: 'Night, 3 to 5 am' },
  { id: '01:00-06:00', label: 'Night, 1 to 6 am' },
  { id: '12:00-14:00', label: 'Midday, 12 to 2 pm' },
];

function OverTheAir({ updates: u, firmware, auto, setAuto, when, setWhen, act }: {
  updates: LumoUpdates; firmware: string | null; auto: boolean; setAuto: (on: boolean) => void;
  when: string; setWhen: (w: string) => void;
  act: (fn: () => Promise<unknown>, done?: string) => Promise<void>;
}) {
  const box = 'rounded-2xl px-4 py-3 text-[13.5px]';
  const [confirm, setConfirm] = useState('');
  const [showAll, setShowAll] = useState(false);
  const busy = u.state === 'updating' || u.state === 'checking';
  const builds = u.builds || [];
  const shown = showAll ? builds : builds.slice(0, 4);
  const rolledBack = u.state === 'failed' && (u.error || '').startsWith('rolled back');
  const windows = WINDOWS.some(w => w.id === when) ? WINDOWS : [...WINDOWS, { id: when, label: when.replace('-', ' to ') }];

  const install = (version: string, sha: string, older: boolean) => {
    const key = `${version}-${sha}`;
    if (confirm !== key) { setConfirm(key); setTimeout(() => setConfirm(c => (c === key ? '' : c)), 4000); return; }
    setConfirm('');
    act(() => lumoApi.firmware('install', { version, sha }), older ? `Going back to v${version}` : `Sending v${version} to LUMO`);
  };

  return (
    <div className="space-y-3">
      {u.state === 'updating' ? (
        <div className={`${box} bg-blue-500/10 text-blue-800 dark:text-blue-200`}>
          <div className="font-semibold flex items-center gap-2"><RefreshCw size={15} className="animate-spin" /> Updating to v{u.target}</div>
          {typeof u.progress === 'number' ? (
            <div className="mt-2 flex items-center gap-2">
              <div className="flex-1 h-1.5 rounded-full bg-blue-500/20 overflow-hidden">
                <div className="h-full bg-blue-600 rounded-full transition-[width] duration-500" style={{ width: `${u.progress}%` }} />
              </div>
              <span className="text-[12px] font-semibold tabular-nums w-10 text-right">{u.progress}%</span>
            </div>
          ) : <div className="mt-0.5">LUMO shows the progress and restarts by itself.</div>}
        </div>
      ) : u.state === 'checking' ? (
        <div className={`${box} bg-blue-500/10 text-blue-800 dark:text-blue-200`}>
          <div className="font-semibold flex items-center gap-2"><RefreshCw size={15} className="animate-spin" /> Checking v{u.target}</div>
          <div className="mt-0.5">LUMO keeps it once the screen answers and it has run for 2 minutes. If a check fails it goes back to the last version by itself.</div>
        </div>
      ) : rolledBack ? (
        <div className={`${box} bg-amber-500/10 text-amber-800 dark:text-amber-300`}>
          <div className="font-semibold">LUMO went back to v{firmware}</div>
          <div className="mt-0.5">v{u.target} {(u.error || '').replace(/^rolled back from [^:]+: /, '')}, so it isn't sent again by itself.</div>
        </div>
      ) : u.state === 'failed' ? (
        <div className={`${box} bg-red-500/10 text-red-700 dark:text-red-300`}>
          <div className="font-semibold">The update to v{u.target} didn't go through</div>
          <div className="mt-0.5">{u.error}. LUMO kept v{firmware}.</div>
        </div>
      ) : u.newer && u.latest ? (
        <div className={`${box} bg-blue-500/10 text-blue-800 dark:text-blue-200`}>
          <div className="font-semibold flex items-center gap-2"><Download size={15} /> v{u.latest} is ready</div>
          {u.latestTitle && <div className="mt-0.5">{u.latestTitle}</div>}
          {u.waiting && <div className="mt-0.5">Waiting: {u.waiting}.</div>}
        </div>
      ) : null}
      {u.hold && (
        <div className={`${box} surface-item flex items-center justify-between gap-3`}>
          <div className="min-w-0">
            <div className="font-semibold text-gray-900 dark:text-white flex items-center gap-1.5"><Pin size={14} /> Held on v{u.hold}</div>
            <div className="text-[12px] text-gray-500 dark:text-gray-400">Automatic updates skip newer builds until you let them go.</div>
          </div>
          <button onClick={() => act(() => lumoApi.firmware('release'), 'Updates will go ahead again')} className={btnQuiet}>Let go</button>
        </div>
      )}
      <p className="text-[13.5px] text-gray-600 dark:text-gray-300">
        LUMO is on <b>v{firmware || '?'}</b>
        {u.latest ? <>; the newest build is <b>v{u.latest}</b>{u.latestSha ? ` (${u.latestSha})` : ''}.</> : '.'}
        {u.checkError && <span className="block text-[12px] text-amber-600 dark:text-amber-400 mt-1">{u.checkError}</span>}
      </p>
      <Row title="Update automatically" hint="When a firmware change is merged on GitHub, LUMO installs it when it isn't busy">
        <Toggle on={auto} onChange={setAuto} label="Update automatically" />
      </Row>
      <Row title="When" hint="Automatic updates wait for this window. Update now doesn't.">
        <select value={when} onChange={e => setWhen(e.target.value)} className={selectCls} aria-label="Update window">
          {windows.map(w => <option key={w.id} value={w.id}>{w.label}</option>)}
        </select>
      </Row>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => act(() => lumoApi.firmware('update'), 'Sending the update to LUMO')} disabled={busy}
          className={btnQuiet}><Download size={15} /> Check and update now</button>
        <button onClick={() => act(() => lumoApi.firmware('check'), 'Checked GitHub')} className={btnQuiet}><RefreshCw size={15} /> Check only</button>
        {!u.hold && firmware && (
          <button onClick={() => act(() => lumoApi.firmware('hold'), `Held on v${firmware}`)} className={btnQuiet}><Pin size={15} /> Hold this version</button>
        )}
      </div>
      {builds.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">Versions</div>
          <ul className="space-y-1.5">
            {shown.map(b => {
              const older = !!firmware && cmpVersion(b.version, firmware) < 0;
              const key = `${b.version}-${b.sha}`;
              return (
                <li key={key} className="surface-item rounded-2xl px-3 py-2.5 flex items-center gap-3 min-w-0">
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-semibold text-gray-900 dark:text-white flex items-center gap-2 flex-wrap">
                      v{b.version}
                      <span className="text-[11px] font-mono font-normal text-gray-400">{b.sha}</span>
                      {b.running && <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Running</span>}
                      {u.hold === b.version && <span className="text-[11px] px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-800 dark:text-amber-300">Held</span>}
                    </div>
                    <div className="text-[12px] text-gray-500 dark:text-gray-400 truncate">
                      {b.title || 'No description'}{b.pr ? ` (#${b.pr})` : ''}{b.at ? ` · ${ago(Date.parse(b.at))}` : ''}
                    </div>
                  </div>
                  {!b.running && (
                    <button onClick={() => install(b.version, b.sha, older)} disabled={busy || !b.installable}
                      title={b.installable ? undefined : 'Too old to update over Wi-Fi again'}
                      className={`${btnQuiet} !py-1.5 !text-[12.5px] shrink-0`}>
                      {confirm === key ? 'Tap again' : older ? <><RotateCcw size={14} /> Go back</> : 'Install'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {builds.length > shown.length || showAll ? (
            <button onClick={() => setShowAll(v => !v)} className="text-[12.5px] font-semibold text-blue-600 dark:text-blue-400">
              {showAll ? 'Show fewer' : `Show all ${builds.length}`}
            </button>
          ) : null}
        </div>
      )}
    </div>
  );
}

function cmpVersion(a: string, b: string): number {
  const pa = a.split('.').map(Number), pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}
