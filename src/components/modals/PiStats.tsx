// PiStats - live health of the Pi in Settings > Advanced > System: CPU, GPU,
// temperatures, memory, swap, uptime and free space on both drives.
// Polls the Pi every 3 s while this card is on screen and the tab is visible.
// The Pi caches a reading for 2 s, so this stays cheap.

import { useEffect, useState } from 'react';
import { piBackendUrl, piHeaders } from '../../services/piBackend';

type Disk = { label: string; path: string; mounted: boolean; total?: number; used?: number; free?: number; usedPercent?: number | null };
type Stats = {
  cpu: { percent: number | null; cores: number | null; load: number[] | null };
  gpu: { tempC: number | null; clockMHz: number | null; memoryMB: number | null };
  tempC: number | null;
  fanRpm: number | null;
  throttled: string[];
  memory: { total: number; used: number; free: number; usedPercent: number | null };
  swap: { total: number; used: number; usedPercent: number | null };
  uptimeSeconds: number | null;
  disks: Disk[];
};

const POLL_MS = 3000;

const bytes = (n: number): string => {
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.round(n / 1e3)} KB`;
};

const uptime = (s: number): string => {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};

const level = (pct: number | null | undefined, warn: number, bad: number) =>
  pct == null ? 'bg-gray-400' : pct >= bad ? 'bg-red-500' : pct >= warn ? 'bg-amber-500' : 'bg-emerald-500';

function Meter({ label, value, pct, warn = 75, bad = 90 }: { label: string; value: string; pct: number | null | undefined; warn?: number; bad?: number }) {
  const w = Math.max(0, Math.min(100, pct ?? 0));
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
        <span>{label}</span>
        <span className="font-semibold tabular-nums text-gray-800 dark:text-gray-200">{value}</span>
      </div>
      <div className="h-2 rounded-full bg-black/[0.07] dark:bg-white/10 overflow-hidden" role="progressbar" aria-valuenow={Math.round(w)} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className={`h-full rounded-full ${level(pct, warn, bad)} transition-[width]`} style={{ width: `${w}%` }} />
      </div>
    </div>
  );
}

export function PiStats() {
  // undefined = still asking, null = Pi not reachable.
  const [s, setS] = useState<Stats | null | undefined>(undefined);

  useEffect(() => {
    const base = piBackendUrl();
    if (!base) { setS(null); return; }
    let stop = false;
    const load = () => {
      if (document.hidden) return;
      fetch(`${base}/api/pi-stats`, { headers: piHeaders() })
        .then(r => (r.ok ? r.json() : null))
        .then(j => { if (!stop) setS(j?.success ? j : null); })
        .catch(() => { if (!stop) setS(null); });
    };
    load();
    const id = window.setInterval(load, POLL_MS);
    return () => { stop = true; window.clearInterval(id); };
  }, []);

  if (!piBackendUrl() || s === undefined) return null;

  const card = 'p-5 rounded-2xl bg-gray-50 dark:bg-white/5 border border-black/5 dark:border-white/5 space-y-3';
  const title = 'flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-gray-700 dark:text-gray-300';
  if (s === null) {
    return (
      <div className={card}>
        <div className={title}><span className="inline-block w-2.5 h-2.5 rounded-full bg-gray-400" aria-hidden="true" /><span>Pi live stats</span></div>
        <p className="text-xs text-gray-600 dark:text-gray-400">Couldn't reach the Pi.</p>
      </div>
    );
  }

  const temp = s.tempC ?? s.gpu.tempC;
  const tempPct = temp == null ? null : temp; // 70 C warm, 80 C hot
  const facts: { label: string; value: string }[] = [
    { label: 'CPU temp', value: temp == null ? 'n/a' : `${temp.toFixed(1)} °C` },
    { label: 'GPU temp', value: s.gpu.tempC == null ? 'n/a' : `${s.gpu.tempC.toFixed(1)} °C` },
    { label: 'GPU clock', value: s.gpu.clockMHz ? `${s.gpu.clockMHz} MHz` : 'n/a' },
    { label: 'GPU memory', value: s.gpu.memoryMB ? `${s.gpu.memoryMB} MB` : 'n/a' },
    { label: 'Load (1/5/15 min)', value: s.cpu.load ? s.cpu.load.join(' · ') : 'n/a' },
    { label: 'Fan', value: s.fanRpm == null ? 'n/a' : `${s.fanRpm} rpm` },
    { label: 'Uptime', value: s.uptimeSeconds == null ? 'n/a' : uptime(s.uptimeSeconds) },
  ];

  return (
    <div className={card}>
      <div className={title}>
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${level(tempPct, 70, 80)}`} aria-hidden="true" />
        <span>Pi live stats</span>
      </div>
      <Meter label={`CPU${s.cpu.cores ? ` · ${s.cpu.cores} cores` : ''}`} value={s.cpu.percent == null ? 'n/a' : `${s.cpu.percent.toFixed(0)}%`} pct={s.cpu.percent} />
      <Meter label="Temperature" value={temp == null ? 'n/a' : `${temp.toFixed(1)} °C`} pct={tempPct} warn={70} bad={80} />
      <Meter label="RAM" value={`${bytes(s.memory.used)} of ${bytes(s.memory.total)}`} pct={s.memory.usedPercent} />
      <Meter label="Swap" value={s.swap.total ? `${bytes(s.swap.used)} of ${bytes(s.swap.total)}` : 'none'} pct={s.swap.usedPercent} warn={25} bad={60} />
      {s.disks.map(d => d.mounted && d.total != null && d.free != null ? (
        <Meter key={d.path} label={`${d.label} (${d.path})`} value={`${bytes(d.free)} free of ${bytes(d.total)}`} pct={d.usedPercent} />
      ) : (
        <div key={d.path} className="flex items-center justify-between text-xs text-gray-600 dark:text-gray-400">
          <span>{d.label} ({d.path})</span><span className="font-semibold text-amber-600">not mounted</span>
        </div>
      ))}
      <dl className="divide-y divide-black/5 dark:divide-white/5">
        {facts.map(f => (
          <div key={f.label} className="flex items-baseline justify-between gap-3 py-1.5">
            <dt className="text-xs text-gray-600 dark:text-gray-400">{f.label}</dt>
            <dd className="text-xs font-semibold tabular-nums text-gray-800 dark:text-gray-200">{f.value}</dd>
          </div>
        ))}
      </dl>
      {s.throttled.length > 0 && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">Pi warning: {s.throttled.join(', ')}.</p>
      )}
    </div>
  );
}
