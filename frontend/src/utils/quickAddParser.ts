import { EntityType, TaskPriority, Project } from '../types';
import { getTodayDateString, getTomorrowDateString, getThisWeekend, getNextMonday } from './dateHelpers';

export interface ParsedQuickAdd {
  title: string;
  rawInput: string;
  entity_type: EntityType;
  priority: TaskPriority;
  due_date?: string;
  due_time?: string;
  project_id?: string;
  project_name?: string;
  context_tags?: string;
  estimated_minutes?: number;
  tokens: {
    type: 'date' | 'time' | 'priority' | 'project' | 'tag' | 'estimate' | 'entity';
    text: string;
    display: string;
  }[];
}

export function parseQuickAdd(input: string, availableProjects: Project[] = []): ParsedQuickAdd {
  const trimmed = input.trim();
  if (!trimmed) {
    return {
      title: '',
      rawInput: input,
      entity_type: 'task',
      priority: 'medium',
      tokens: []
    };
  }

  let remaining = trimmed;
  let entity_type: EntityType = 'task';
  let priority: TaskPriority = 'medium';
  let due_date: string | undefined = undefined;
  let due_time: string | undefined = undefined;
  let project_id: string | undefined = undefined;
  let project_name: string | undefined = undefined;
  let context_tags: string | undefined = undefined;
  let estimated_minutes: number | undefined = undefined;
  const tokens: ParsedQuickAdd['tokens'] = [];

  // 1. Entity type prefix or keyword
  if (/^\b(event|meeting|call):\s*/i.test(remaining)) {
    entity_type = 'event';
    const match = remaining.match(/^\b(event|meeting|call):\s*/i)!;
    tokens.push({ type: 'entity', text: match[0], display: '📅 Event' });
    remaining = remaining.slice(match[0].length);
  } else if (/^\b(reminder|remember|remind):\s*/i.test(remaining)) {
    entity_type = 'reminder';
    const match = remaining.match(/^\b(reminder|remember|remind):\s*/i)!;
    tokens.push({ type: 'entity', text: match[0], display: '🔔 Reminder' });
    remaining = remaining.slice(match[0].length);
  }

  // 2. Priority: !urgent, !high, !med, !low, p1, p2, p3, p4
  const priorityRegex = /(?:^|\s)(!(urgent|high|med|medium|low)|\b(p1|p2|p3|p4)\b)(?=\s|$)/i;
  const priorityMatch = remaining.match(priorityRegex);
  if (priorityMatch) {
    const rawTag = priorityMatch[1].toLowerCase();
    if (rawTag === '!urgent' || rawTag === 'p1') {
      priority = 'urgent';
      tokens.push({ type: 'priority', text: priorityMatch[0].trim(), display: '🔴 Urgent' });
    } else if (rawTag === '!high' || rawTag === 'p2') {
      priority = 'high';
      tokens.push({ type: 'priority', text: priorityMatch[0].trim(), display: '🟠 High' });
    } else if (rawTag === '!med' || rawTag === '!medium' || rawTag === 'p3') {
      priority = 'medium';
      tokens.push({ type: 'priority', text: priorityMatch[0].trim(), display: '🟡 Medium' });
    } else if (rawTag === '!low' || rawTag === 'p4') {
      priority = 'low';
      tokens.push({ type: 'priority', text: priorityMatch[0].trim(), display: '⚪ Low' });
    }
    remaining = remaining.replace(priorityRegex, ' ');
  }

  // 3. Time estimate: ~15m, ~30m, ~1h, ~2h, ~90m
  const estimateRegex = /(?:^|\s)(~(\d+)(m|h|min|mins|hours?))(?=\s|$)/i;
  const estimateMatch = remaining.match(estimateRegex);
  if (estimateMatch) {
    const num = parseInt(estimateMatch[2], 10);
    const unit = estimateMatch[3].toLowerCase();
    if (unit.startsWith('h')) {
      estimated_minutes = num * 60;
    } else {
      estimated_minutes = num;
    }
    tokens.push({ type: 'estimate', text: estimateMatch[1], display: `⏱️ ${estimated_minutes}m` });
    remaining = remaining.replace(estimateRegex, ' ');
  }

  // 4. Context tags: @tag (e.g. @errand, @phone, @computer, @home)
  const tagRegex = /(?:^|\s)(@([a-zA-Z0-9_-]+))(?=\s|$)/g;
  const matchedTags: string[] = [];
  let tagMatch;
  while ((tagMatch = tagRegex.exec(remaining)) !== null) {
    matchedTags.push(`@${tagMatch[2].toLowerCase()}`);
    tokens.push({ type: 'tag', text: tagMatch[1], display: `@${tagMatch[2]}` });
  }
  if (matchedTags.length > 0) {
    context_tags = matchedTags.join(' ');
    remaining = remaining.replace(tagRegex, ' ');
  }

  // 5. Project tag: #ProjectName (fuzzy match against availableProjects)
  const projectRegex = /(?:^|\s)(#([a-zA-Z0-9_-]+))(?=\s|$)/i;
  const projectMatch = remaining.match(projectRegex);
  if (projectMatch) {
    const query = projectMatch[2].toLowerCase().replace(/[\s_-]/g, '');
    const matchedProject = availableProjects.find(
      p => {
        const cleanName = p.name.toLowerCase().replace(/[\s_-]/g, '');
        return cleanName.includes(query) || query.includes(cleanName);
      }
    );
    if (matchedProject) {
      project_id = matchedProject.id;
      project_name = matchedProject.name;
      tokens.push({ type: 'project', text: projectMatch[1], display: `📁 ${matchedProject.name}` });
    } else {
      tokens.push({ type: 'project', text: projectMatch[1], display: `#${projectMatch[2]}` });
    }
    remaining = remaining.replace(projectRegex, ' ');
  }

  // 6. Date & Time parsing
  // Check specific time: e.g. "at 5pm", "5:30pm", "17:00", "at 9am"
  const timeRegex = /(?:^|\s)(?:at\s+)?(\b(?:1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(am|pm)\b|\b([01]?\d|2[0-3]):([0-5]\d)\b)(?=\s|$)/i;
  const timeMatch = remaining.match(timeRegex);
  if (timeMatch) {
    let rawTime = timeMatch[1].toLowerCase().trim();
    // Normalize to HH:MM
    if (timeMatch[3]) {
      // 12-hour AM/PM format
      const parts = timeMatch[1].toLowerCase().match(/(\d+)(?::(\d+))?\s*(am|pm)/)!;
      let hour = parseInt(parts[1], 10);
      const min = parts[2] ? parts[2].padStart(2, '0') : '00';
      const isPm = parts[3] === 'pm';
      if (isPm && hour < 12) hour += 12;
      if (!isPm && hour === 12) hour = 0;
      due_time = `${String(hour).padStart(2, '0')}:${min}`;
    } else if (timeMatch[4]) {
      // 24-hour format
      due_time = `${timeMatch[4].padStart(2, '0')}:${timeMatch[5]}`;
    }
    tokens.push({ type: 'time', text: timeMatch[0].trim(), display: `🕒 ${rawTime}` });
    remaining = remaining.replace(timeRegex, ' ');
  }

  // Check date keywords: today, tomorrow, tmrw, tonight, weekend, monday, etc.
  const dateKeywordRegex = /(?:^|\s)(?:on\s+)?\b(today|tomorrow|tmrw|tonight|weekend|next\s+monday|next\s+week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)\b(?=\s|$)/i;
  const dateMatch = remaining.match(dateKeywordRegex);
  if (dateMatch) {
    const rawDate = dateMatch[1].toLowerCase();
    if (rawDate === 'today' || rawDate === 'tonight') {
      due_date = getTodayDateString();
      tokens.push({ type: 'date', text: dateMatch[0].trim(), display: '📅 Today' });
    } else if (rawDate === 'tomorrow' || rawDate === 'tmrw') {
      due_date = getTomorrowDateString();
      tokens.push({ type: 'date', text: dateMatch[0].trim(), display: '📅 Tomorrow' });
    } else if (rawDate === 'weekend') {
      due_date = getThisWeekend();
      tokens.push({ type: 'date', text: dateMatch[0].trim(), display: '📅 This Weekend' });
    } else if (rawDate.includes('monday') || rawDate === 'mon' || rawDate.includes('next week')) {
      due_date = getNextMonday();
      tokens.push({ type: 'date', text: dateMatch[0].trim(), display: '📅 Next Monday' });
    } else {
      // Weekday match
      const days = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
      const targetDay = days.findIndex(d => rawDate.startsWith(d));
      if (targetDay !== -1) {
        const d = new Date();
        const currentDay = d.getDay();
        let diff = targetDay - currentDay;
        if (diff <= 0) diff += 7;
        d.setDate(d.getDate() + diff);
        due_date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        tokens.push({ type: 'date', text: dateMatch[0].trim(), display: `📅 ${rawDate.charAt(0).toUpperCase() + rawDate.slice(1)}` });
      }
    }
    remaining = remaining.replace(dateKeywordRegex, ' ');
  }

  // Relative: in X days / in X weeks
  const relativeRegex = /(?:^|\s)\bin\s+(\d+)\s+(day|days|week|weeks)\b(?=\s|$)/i;
  const relativeMatch = remaining.match(relativeRegex);
  if (relativeMatch) {
    const count = parseInt(relativeMatch[1], 10);
    const unit = relativeMatch[2].toLowerCase();
    const d = new Date();
    if (unit.startsWith('week')) {
      d.setDate(d.getDate() + (count * 7));
    } else {
      d.setDate(d.getDate() + count);
    }
    due_date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    tokens.push({ type: 'date', text: relativeMatch[0].trim(), display: `📅 In ${count} ${unit}` });
    remaining = remaining.replace(relativeRegex, ' ');
  }

  // If time is provided but no date, default due_date to today
  if (due_time && !due_date) {
    due_date = getTodayDateString();
  }

  // Title is whatever remains after removing all parsed tokens
  const cleanTitle = remaining.replace(/\s+/g, ' ').trim();

  return {
    title: cleanTitle || trimmed,
    rawInput: input,
    entity_type,
    priority,
    due_date,
    due_time,
    project_id,
    project_name,
    context_tags,
    estimated_minutes,
    tokens
  };
}
