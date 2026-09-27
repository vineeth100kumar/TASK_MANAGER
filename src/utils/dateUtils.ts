/**
 * Timezone-safe Date Formatting & Input Sanitization Utilities
 * Prevents UTC off-by-one day bugs and ensures HTML5 date inputs always render correctly
 */

export function parseDateString(dStr: string | null | undefined): Date | null {
  if (!dStr) return null;
  if (typeof dStr === 'string' && dStr.length === 10 && dStr.includes('-')) {
    const [y, m, d] = dStr.split('-').map(Number);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return new Date(y, m - 1, d);
    }
  }
  if (typeof dStr === 'string' && dStr.length > 10 && /^\d{4}-\d{2}-\d{2}/.test(dStr)) {
    const [y, m, d] = dStr.substring(0, 10).split('-').map(Number);
    if (!isNaN(y) && !isNaN(m) && !isNaN(d)) {
      return new Date(y, m - 1, d);
    }
  }
  const parsed = new Date(dStr);
  return isNaN(parsed.getTime()) ? null : parsed;
}

export function toInputDateValue(dStr: string | null | undefined): string {
  if (!dStr) return '';
  if (typeof dStr === 'string') {
    // If exact YYYY-MM-DD
    if (/^\d{4}-\d{2}-\d{2}$/.test(dStr)) return dStr;
    // If starts with YYYY-MM-DD
    if (dStr.length >= 10 && /^\d{4}-\d{2}-\d{2}/.test(dStr)) {
      return dStr.substring(0, 10);
    }
  }
  const d = new Date(dStr);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function toInputDateTimeValue(dStr: string | null | undefined): string {
  if (!dStr) return '';
  if (typeof dStr === 'string') {
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(dStr)) {
      return dStr.substring(0, 16);
    }
    if (/^\d{4}-\d{2}-\d{2}/.test(dStr) && dStr.length === 10) {
      return `${dStr}T09:00`;
    }
  }
  const d = new Date(dStr);
  if (isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${m}-${day}T${hh}:${mm}`;
}

export function formatDisplayDate(dStr: string | null | undefined): string {
  if (!dStr) return '';
  const d = parseDateString(dStr);
  if (!d) return '';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function getTodayString(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function formatDateRange(start: string | null | undefined, due: string | null | undefined): string | null {
  const today = getTodayString();
  const cleanStart = toInputDateValue(start);
  const cleanDue = toInputDateValue(due);

  if (!cleanStart && !cleanDue) return null;

  if (cleanStart && !cleanDue) {
    return cleanStart === today ? 'Starts today' : `Starts ${formatDisplayDate(cleanStart)}`;
  }

  if (!cleanStart && cleanDue) {
    if (cleanDue < today) return `Overdue · ${formatDisplayDate(cleanDue)}`;
    if (cleanDue === today) return 'Due today';
    return `Due ${formatDisplayDate(cleanDue)}`;
  }

  if (cleanStart === cleanDue) {
    if (cleanStart === today) return 'Today';
    return formatDisplayDate(cleanStart);
  }

  return `${formatDisplayDate(cleanStart)} → ${formatDisplayDate(cleanDue)}`;
}
