import { useEffect, useState } from 'react';
import { Radar, TrendingUp, TrendingDown, ChevronRight } from 'lucide-react';
import { RADAR_EVENT, RadarBrief, radarAvailable, radarBrief, timeAgo } from '../../services/radar';
import { Tag } from './parts';

// Today's Radar card: three signals worth a look, the biggest market move and
// the hottest topic. Off until switched on in Settings > Radar; never in Personal.
export function RadarBriefCard({ onOpen }: { onOpen: () => void }) {
  const [brief, setBrief] = useState<RadarBrief | null>(null);

  useEffect(() => {
    if (!radarAvailable()) return;
    const load = () => radarBrief().then(setBrief).catch(() => setBrief(null));
    load();
    const onRadar = (e: Event) => { if ((e as CustomEvent).detail?.type === 'RADAR_UPDATED') load(); };
    window.addEventListener(RADAR_EVENT, onRadar);
    return () => window.removeEventListener(RADAR_EVENT, onRadar);
  }, []);

  if (!brief?.enabled || (brief.signals.length === 0 && !brief.move)) return null;
  const move = brief.move;
  const up = (move?.changePct ?? 0) >= 0;

  return (
    <div className="surface p-4 md:p-5 rounded-3xl border border-black/5 dark:border-white/5 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="eyebrow text-gray-500 dark:text-gray-400">
          <Radar size={14} className="text-purple-500" />
          <span>Radar brief</span>
        </div>
        <button onClick={onOpen} className="text-[12px] font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-0.5 hover:underline">Open Radar <ChevronRight size={13} /></button>
      </div>
      <p className="text-[13.5px] text-gray-600 dark:text-gray-300">{brief.headline}</p>
      <div className="flex gap-2 flex-wrap">
        {brief.trend && (
          <span className="flex items-center gap-1 text-[12px] font-semibold px-2 py-1 rounded-lg text-amber-700 bg-amber-500/10 dark:text-amber-400">
            <TrendingUp size={13} /> #{brief.trend.tag} {brief.trend.velocity}×
          </span>
        )}
        {move && move.changePct !== null && (
          <span className={`flex items-center gap-1 text-[12px] font-semibold px-2 py-1 rounded-lg ${up ? 'text-emerald-700 bg-emerald-500/10 dark:text-emerald-400' : 'text-red-600 bg-red-500/10 dark:text-red-400'}`}>
            {up ? <TrendingUp size={13} /> : <TrendingDown size={13} />} {move.name} {up ? '+' : ''}{move.changePct.toFixed(2)}%
          </span>
        )}
      </div>
      <div className="space-y-1.5">
        {brief.signals.map(s => (
          <a key={s.id} href={s.link} target="_blank" rel="noopener noreferrer" className="block p-3 rounded-2xl surface-item is-interactive">
            <div className="flex items-center gap-2 text-[11px] font-medium text-gray-400 mb-0.5">
              <span className="font-semibold text-gray-500 dark:text-gray-300">{s.source}</span>
              <span>· {timeAgo(s.published)}</span>
              {s.rising && <span className="text-amber-600 font-semibold">rising</span>}
              {s.tags.slice(0, 2).map(t => <Tag key={t} tag={t} />)}
            </div>
            <p className="text-[13px] font-semibold leading-snug text-gray-900 dark:text-white">{s.title}</p>
          </a>
        ))}
      </div>
    </div>
  );
}
