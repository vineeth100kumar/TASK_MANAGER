// PresenceCard - when you were home, a 24-hour bar per day (raspberry_pi/herald_journal.py).
// Herald also uses it: late returns and the like show up in its lines.

import { useEffect, useState } from 'react';
import { piBackendUrl, piHeaders } from '../../services/piBackend';

interface Day { day: string; known: boolean; from: number; to: number; out: number[][]; awayMin: number; homeMin: number }
interface Report { days: Day[]; out: boolean; since?: number; late: number }

const hm = (min: number) => `${Math.floor(min / 60)}h ${String(min % 60).padStart(2, '0')}m`;
const pct = (min: number) => `${(min / 1440) * 100}%`;

export function PresenceCard() {
  const [report, setReport] = useState<Report | null>(null);
  useEffect(() => {
    if (!piBackendUrl()) return;
    fetch(`${piBackendUrl()}/api/herald/presence`, { headers: piHeaders() })
      .then(r => r.json()).then(setReport).catch(() => { /* the card just stays hidden */ });
  }, []);
  if (!report || !report.since) return null;

  return (
    <div className="rounded-xl bg-black/[0.03] dark:bg-white/5 px-3 py-2.5 space-y-1.5">
      <span className="block text-[11px] font-semibold text-gray-600 dark:text-gray-300">
        When you were home{report.out ? ' · out now' : ''}{report.late >= 2 ? ` · ${report.late} late returns this week` : ''}
      </span>
      {report.days.map(d => (
        <div key={d.day} className="flex items-center gap-2 text-[11px] text-gray-500">
          <span className="w-8 shrink-0">{new Date(d.day + 'T12:00').toLocaleDateString([], { weekday: 'short' })}</span>
          <div className="relative h-2.5 flex-1 rounded-full bg-gray-200/70 dark:bg-white/10 overflow-hidden" aria-hidden>
            {d.known && <div className="absolute inset-y-0 bg-blue-500/60" style={{ left: pct(d.from), width: pct(d.to - d.from) }} />}
            {d.out.map(([s, e]) => <div key={s} className="absolute inset-y-0 bg-gray-300 dark:bg-gray-600" style={{ left: pct(s), width: pct(e - s) }} />)}
          </div>
          <span className="w-16 shrink-0 text-right">{d.known ? hm(d.homeMin) : '-'}</span>
        </div>
      ))}
      <p className="text-[10px] text-gray-400">Blue is time at home, grey is time out. It starts when Herald first saw you leave.</p>
    </div>
  );
}
