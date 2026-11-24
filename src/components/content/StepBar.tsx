// StepBar - the dots at the top of a linear flow: which step you are on, out of how many.
export function StepBar({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2 mb-4 text-[12px] font-semibold" aria-label="Steps">
      {steps.map((s, i) => (
        <li key={s} aria-current={i === current ? 'step' : undefined} className="flex items-center gap-2">
          <span className={`flex items-center justify-center w-5 h-5 rounded-full text-[11px] tabular-nums ${i < current ? 'bg-emerald-500 text-white' : i === current ? 'bg-purple-600 text-white' : 'bg-black/[0.07] dark:bg-white/10 text-gray-500'}`}>{i + 1}</span>
          <span className={i === current ? 'text-gray-900 dark:text-white' : 'text-gray-400'}>{s}</span>
          {i < steps.length - 1 && <span className="w-4 h-px bg-gray-300 dark:bg-white/15" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}
