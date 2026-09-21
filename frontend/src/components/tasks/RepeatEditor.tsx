import React from 'react';
import {
  EMPTY_SPEC,
  MonthlyMode,
  RepeatKind,
  RepeatSpec,
  WEEKDAY_FULL,
  WEEKDAY_LABELS,
  buildRepeatRule,
  describeRepeat,
  parseRepeatRule,
} from '../../utils/repeatRule';

export interface RepeatValue {
  rule: string;
  until: string | null;
  count: number | null;
}

interface RepeatEditorProps {
  value: RepeatValue;
  onChange: (next: RepeatValue) => void;
  /** Where the item currently sits, used to guess sensible defaults. */
  anchorDate?: string | null;
  idPrefix?: string;
}

const KINDS: { value: RepeatKind; label: string }[] = [
  { value: 'none', label: 'Never' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekdays', label: 'Weekdays' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

const UNIT_FOR_KIND: Partial<Record<RepeatKind, string>> = {
  daily: 'days',
  weekly: 'weeks',
  monthly: 'months',
  yearly: 'years',
};

const NTH_OPTIONS = [
  { value: 1, label: 'First' },
  { value: 2, label: 'Second' },
  { value: 3, label: 'Third' },
  { value: 4, label: 'Fourth' },
  { value: -1, label: 'Last' },
];

/*
 * The whole of a repeat, in one place.
 *
 * Sage used to offer five fixed rules in a dropdown — daily, weekdays, every
 * Monday, monthly — with no interval, no way to say "the third Tuesday", and
 * no way to make a repeat ever stop. The engine underneath already understood
 * more than that; this is the interface catching up with it.
 *
 * The controls stay closed until a repeat is actually chosen, so a one-time
 * task, which is nearly all of them, shows one select and nothing else.
 */
export const RepeatEditor: React.FC<RepeatEditorProps> = ({
  value,
  onChange,
  anchorDate,
  idPrefix = 'repeat',
}) => {
  const spec = parseRepeatRule(value.rule);

  const anchor = anchorDate ? new Date(`${anchorDate.slice(0, 10)}T00:00:00`) : null;
  const anchorValid = anchor && !Number.isNaN(anchor.getTime());
  // JS weeks start on Sunday; the rule grammar starts on Monday.
  const anchorWeekday = anchorValid ? (anchor.getDay() + 6) % 7 : 0;
  const anchorDayOfMonth = anchorValid ? anchor.getDate() : 1;

  const emit = (nextSpec: RepeatSpec, extra: Partial<RepeatValue> = {}) => {
    const rule = buildRepeatRule(nextSpec);
    onChange({
      rule,
      // A rule that no longer repeats cannot have an end condition.
      until: rule ? value.until : null,
      count: rule ? value.count : null,
      ...extra,
    });
  };

  const handleKindChange = (kind: RepeatKind) => {
    if (kind === 'none') {
      onChange({ rule: '', until: null, count: null });
      return;
    }
    // Seed the fields from the day the item is already on, so choosing
    // "Weekly" on a Thursday means every Thursday rather than every Monday.
    emit({
      ...EMPTY_SPEC,
      ...spec,
      kind,
      interval: 1,
      weekdays: spec.weekdays.length ? spec.weekdays : [anchorWeekday],
      dayOfMonth: spec.dayOfMonth > 1 ? spec.dayOfMonth : anchorDayOfMonth,
      nthWeekday: spec.nthWeekday || anchorWeekday,
    });
  };

  const toggleWeekday = (day: number) => {
    const has = spec.weekdays.includes(day);
    const next = has ? spec.weekdays.filter((d) => d !== day) : [...spec.weekdays, day];
    // Never leave it with nothing selected: a weekly rule with no day never
    // comes round at all.
    emit({ ...spec, weekdays: next.length ? next.sort((a, b) => a - b) : spec.weekdays });
  };

  const endsMode: 'never' | 'on' | 'after' = value.count ? 'after' : value.until ? 'on' : 'never';

  const handleEndsMode = (mode: 'never' | 'on' | 'after') => {
    if (mode === 'never') onChange({ ...value, until: null, count: null });
    else if (mode === 'on') {
      const fallback = new Date();
      fallback.setMonth(fallback.getMonth() + 3);
      onChange({ ...value, count: null, until: value.until || fallback.toISOString().slice(0, 10) });
    } else onChange({ ...value, until: null, count: value.count || 10 });
  };

  const unit = UNIT_FOR_KIND[spec.kind];

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <label htmlFor={`${idPrefix}-kind`} className="label">Repeat</label>
        {value.rule && (
          <span className="text-caption text-ink-3 text-right min-w-0 truncate">
            {describeRepeat(value.rule, value.until, value.count)}
          </span>
        )}
      </div>

      <select
        id={`${idPrefix}-kind`}
        value={spec.kind}
        onChange={(e) => handleKindChange(e.target.value as RepeatKind)}
        className="field"
      >
        {KINDS.map((k) => (
          <option key={k.value} value={k.value}>{k.label}</option>
        ))}
      </select>

      {spec.kind !== 'none' && (
        <div className="space-y-2.5 pl-3 border-l-2 border-hairline">
          {unit && (
            <div className="flex items-center gap-2">
              <label htmlFor={`${idPrefix}-interval`} className="text-meta text-ink-2 shrink-0">
                Every
              </label>
              <input
                id={`${idPrefix}-interval`}
                type="number"
                min={1}
                max={99}
                inputMode="numeric"
                value={spec.interval}
                onChange={(e) =>
                  emit({ ...spec, interval: Math.max(1, parseInt(e.target.value, 10) || 1) })
                }
                className="field w-20 tabular"
              />
              <span className="text-meta text-ink-2">{unit}</span>
            </div>
          )}

          {spec.kind === 'weekly' && (
            <div className="flex items-center gap-1" role="group" aria-label="Days of the week">
              {WEEKDAY_LABELS.map((label, day) => {
                const active = spec.weekdays.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    aria-pressed={active}
                    aria-label={WEEKDAY_FULL[day]}
                    title={WEEKDAY_FULL[day]}
                    onClick={() => toggleWeekday(day)}
                    className={`w-9 h-9 rounded-full text-meta transition-colors ${
                      active
                        ? 'bg-accent-500 text-white font-medium'
                        : 'bg-sunken text-ink-2 hover:text-ink'
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          )}

          {spec.kind === 'monthly' && (
            <div className="space-y-2">
              <select
                aria-label="How it repeats each month"
                value={spec.monthlyMode}
                onChange={(e) => emit({ ...spec, monthlyMode: e.target.value as MonthlyMode })}
                className="field"
              >
                <option value="day-of-month">On a day of the month</option>
                <option value="weekday-of-month">On a weekday of the month</option>
              </select>

              {spec.monthlyMode === 'day-of-month' ? (
                <div className="flex items-center gap-2">
                  <span className="text-meta text-ink-2 shrink-0">Day</span>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    inputMode="numeric"
                    aria-label="Day of the month"
                    value={spec.dayOfMonth}
                    onChange={(e) =>
                      emit({
                        ...spec,
                        dayOfMonth: Math.min(31, Math.max(1, parseInt(e.target.value, 10) || 1)),
                      })
                    }
                    className="field w-20 tabular"
                  />
                  {spec.dayOfMonth > 28 && (
                    <span className="text-caption text-ink-3">
                      Shorter months use their last day
                    </span>
                  )}
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <select
                    aria-label="Which one"
                    value={spec.nth}
                    onChange={(e) => emit({ ...spec, nth: parseInt(e.target.value, 10) })}
                    className="field flex-1"
                  >
                    {NTH_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                  <select
                    aria-label="Which day"
                    value={spec.nthWeekday}
                    onChange={(e) => emit({ ...spec, nthWeekday: parseInt(e.target.value, 10) })}
                    className="field flex-1"
                  >
                    {WEEKDAY_FULL.map((name, day) => (
                      <option key={day} value={day}>{name}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}

          {/* When it stops. Every rule used to run forever. */}
          <div className="space-y-2">
            <label htmlFor={`${idPrefix}-ends`} className="text-meta text-ink-2 block">Ends</label>
            <select
              id={`${idPrefix}-ends`}
              value={endsMode}
              onChange={(e) => handleEndsMode(e.target.value as 'never' | 'on' | 'after')}
              className="field"
            >
              <option value="never">Never</option>
              <option value="on">On a date</option>
              <option value="after">After a number of times</option>
            </select>

            {endsMode === 'on' && (
              <input
                type="date"
                aria-label="Repeat until"
                value={value.until || ''}
                onChange={(e) => onChange({ ...value, until: e.target.value || null, count: null })}
                className="field"
              />
            )}

            {endsMode === 'after' && (
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={999}
                  inputMode="numeric"
                  aria-label="Number of times"
                  value={value.count || 1}
                  onChange={(e) =>
                    onChange({
                      ...value,
                      count: Math.max(1, parseInt(e.target.value, 10) || 1),
                      until: null,
                    })
                  }
                  className="field w-24 tabular"
                />
                <span className="text-meta text-ink-2">times</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
