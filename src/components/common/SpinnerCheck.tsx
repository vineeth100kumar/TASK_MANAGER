// A spinner that closes into a ring and draws a tick when the work is done.
export function SpinnerCheck({ done = false, size = 18 }: { done?: boolean; size?: number }) {
  return (
    <svg className="spin-check" data-state={done ? 'done' : 'saving'} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10" pathLength={100} />
      <path d="M7.5 12.5l3 3 6-6.5" pathLength={100} />
    </svg>
  );
}
