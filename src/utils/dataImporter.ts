import { localDateString } from './dateUtils';
/**
 * SAGE MULTI-TOOL IMPORT ENGINE
 * Imports tasks from CSV, Todoist export, and Notion export.
 */

import { api } from '../services/api';
import { LifeContext } from '../services/types';

export interface ImportResult {
  total: number;
  imported: number;
  errors: string[];
}

export async function importCSVData(csvText: string, lifeContext: LifeContext = 'work'): Promise<ImportResult> {
  const lines = csvText.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length <= 1) {
    throw new Error('CSV file is empty or missing data rows.');
  }

  const headerLine = lines[0].toLowerCase();
  const headers = parseCSVLine(headerLine);

  const titleIdx = headers.findIndex(h => h.includes('title') || h.includes('task') || h.includes('content') || h.includes('name'));
  const descIdx = headers.findIndex(h => h.includes('desc') || h.includes('note') || h.includes('detail'));
  const dueIdx = headers.findIndex(h => h.includes('due') || h.includes('date') || h.includes('deadline'));
  const priorityIdx = headers.findIndex(h => h.includes('priority'));

  if (titleIdx === -1) {
    throw new Error('Could not find a Title/Task/Content column in the CSV.');
  }

  let imported = 0;
  const errors: string[] = [];

  for (let i = 1; i < lines.length; i++) {
    const row = parseCSVLine(lines[i]);
    const title = row[titleIdx]?.trim();
    if (!title) continue;

    try {
      const description = descIdx !== -1 ? row[descIdx]?.trim() : '';
      const dueDate = dueIdx !== -1 ? normalizeDateString(row[dueIdx]) : '';
      const priorityRaw = priorityIdx !== -1 ? row[priorityIdx]?.toLowerCase().trim() : 'medium';
      const priority = ['low', 'medium', 'high', 'urgent'].includes(priorityRaw) ? priorityRaw : 'medium';

      await api.workItems.create({
        title,
        description: description || undefined,
        dueDate: dueDate || undefined,
        priority: priority as any,
        lifeContext,
        entityType: 'task',
        type: 'task',
        status: 'todo',
        isInbox: false
      });
      imported++;
    } catch (e: any) {
      errors.push(`Row ${i + 1}: ${e.message}`);
    }
  }

  return { total: lines.length - 1, imported, errors };
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let cur = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(cur.trim().replace(/^"(.*)"$/, '$1'));
      cur = '';
    } else {
      cur += char;
    }
  }
  result.push(cur.trim().replace(/^"(.*)"$/, '$1'));
  return result;
}

function normalizeDateString(raw?: string): string {
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw.trim())) return raw.trim();
  const d = new Date(raw);
  if (isNaN(d.getTime())) return '';
  return localDateString(d);
}
