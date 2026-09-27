/**
 * SAGE RFC 5545 iCALENDAR (.ics) EXPORT ENGINE
 * Generates valid iCalendar files for importing into Google Calendar, Apple Calendar, and Outlook.
 */

import { WorkItem } from '../services/types';

function formatICalDate(dateStr?: string | null): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
}

function formatICalDateOnly(dateStr?: string | null): string {
  if (!dateStr) return '';
  return dateStr.replace(/-/g, '');
}

export function generateICSFeed(items: WorkItem[]): string {
  const timeBoundItems = items.filter(i => !i.deletedAt && i.status !== 'done' && (i.dueDate || i.startDate || i.startAt));
  
  const now = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  let ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Sage//Solo Task & Life Management//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:Sage Commitments'
  ];

  for (const item of timeBoundItems) {
    const uid = `${item.id}@sage.app`;
    const summary = item.title.replace(/[,;\\]/g, '\\$&');
    const description = (item.description || '').replace(/\n/g, '\\n').replace(/[,;\\]/g, '\\$&');
    const location = (item.location || '').replace(/[,;\\]/g, '\\$&');

    ics.push('BEGIN:VEVENT');
    ics.push(`UID:${uid}`);
    ics.push(`DTSTAMP:${now}`);
    ics.push(`SUMMARY:${summary}`);

    if (description) ics.push(`DESCRIPTION:${description}`);
    if (location) ics.push(`LOCATION:${location}`);

    if (item.startAt) {
      ics.push(`DTSTART:${formatICalDate(item.startAt)}`);
      if (item.endAt) {
        ics.push(`DTEND:${formatICalDate(item.endAt)}`);
      } else {
        const end = new Date(new Date(item.startAt).getTime() + 3600000).toISOString();
        ics.push(`DTEND:${formatICalDate(end)}`);
      }
    } else if (item.dueDate) {
      const dtVal = formatICalDateOnly(item.dueDate);
      ics.push(`DTSTART;VALUE=DATE:${dtVal}`);
      ics.push(`DTEND;VALUE=DATE:${dtVal}`);
    } else if (item.startDate) {
      const dtVal = formatICalDateOnly(item.startDate);
      ics.push(`DTSTART;VALUE=DATE:${dtVal}`);
      ics.push(`DTEND;VALUE=DATE:${dtVal}`);
    }

    if (item.priority) {
      const pLevel = item.priority === 'urgent' ? '1' : item.priority === 'high' ? '3' : item.priority === 'medium' ? '5' : '9';
      ics.push(`PRIORITY:${pLevel}`);
    }

    ics.push('STATUS:CONFIRMED');
    ics.push('END:VEVENT');
  }

  ics.push('END:VCALENDAR');
  return ics.join('\r\n');
}

export function downloadICSFile(items: WorkItem[]): void {
  const content = generateICSFeed(items);
  const blob = new Blob([content], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `sage_calendar_${new Date().toISOString().split('T')[0]}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}
