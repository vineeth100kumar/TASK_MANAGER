interface ProgressRingProps {
  done: number;
  total: number;
  size?: number;
  stroke?: number;
  tone?: 'work' | 'personal';
}

// Ring that fills as the day's items get done.
export function ProgressRing({ done, total, size = 72, stroke = 7, tone = 'work' }: ProgressRingProps) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ratio = total > 0 ? Math.min(1, done / total) : 0;
  const complete = total > 0 && done >= total;
  const color = complete ? 'var(--color-emerald-500)' : tone === 'personal' ? 'var(--color-orange-500)' : 'var(--color-blue-500)';
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="progress-ring -rotate-90 shrink-0" role="img" aria-label={`${done} of ${total} done`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} className="stroke-black/[0.07] dark:stroke-white/[0.09]" />
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" strokeWidth={stroke} strokeLinecap="round"
        stroke={color} strokeDasharray={c} strokeDashoffset={c * (1 - ratio)}
        style={{ opacity: ratio === 0 ? 0 : 1 }} />
    </svg>
  );
}
