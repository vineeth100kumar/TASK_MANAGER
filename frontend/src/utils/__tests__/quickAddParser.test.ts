import { describe, it, expect } from 'vitest';
import { parseQuickAdd } from '../quickAddParser';
import { Project } from '../../types';
import { getTodayDateString, getTomorrowDateString } from '../dateHelpers';

describe('quickAddParser', () => {
  const sampleProjects: Project[] = [
    { id: 'p1', name: 'Work', color: '#3b82f6', created_at: '' },
    { id: 'p2', name: 'Home Lab', color: '#10b981', created_at: '' },
    { id: 'p3', name: 'Fitness', color: '#f59e0b', created_at: '' }
  ];

  it('parses basic title with no tags', () => {
    const res = parseQuickAdd('Buy milk and eggs');
    expect(res.title).toBe('Buy milk and eggs');
    expect(res.priority).toBe('medium');
    expect(res.entity_type).toBe('task');
    expect(res.due_date).toBeUndefined();
    expect(res.tokens).toHaveLength(0);
  });

  it('parses entity type prefixes', () => {
    const resEvent = parseQuickAdd('Event: Team sync meeting');
    expect(resEvent.entity_type).toBe('event');
    expect(resEvent.title).toBe('Team sync meeting');

    const resReminder = parseQuickAdd('Reminder: Take vitamins');
    expect(resReminder.entity_type).toBe('reminder');
    expect(resReminder.title).toBe('Take vitamins');
  });

  it('parses priorities correctly', () => {
    const res1 = parseQuickAdd('Deploy update !urgent');
    expect(res1.priority).toBe('urgent');
    expect(res1.title).toBe('Deploy update');

    const res2 = parseQuickAdd('Clean garage p1');
    expect(res2.priority).toBe('urgent');

    const res3 = parseQuickAdd('Read article !low');
    expect(res3.priority).toBe('low');
  });

  it('parses dates and times', () => {
    const resToday = parseQuickAdd('Send email today 5pm');
    expect(resToday.due_date).toBe(getTodayDateString());
    expect(resToday.due_time).toBe('17:00');
    expect(resToday.title).toBe('Send email');

    const resTomorrow = parseQuickAdd('Dentist appointment tomorrow at 9:30am');
    expect(resTomorrow.due_date).toBe(getTomorrowDateString());
    expect(resTomorrow.due_time).toBe('09:30');
    expect(resTomorrow.title).toBe('Dentist appointment');
  });

  it('parses project fuzzy matches', () => {
    const res = parseQuickAdd('Review quarterly stats #work', sampleProjects);
    expect(res.project_id).toBe('p1');
    expect(res.project_name).toBe('Work');
    expect(res.title).toBe('Review quarterly stats');
  });

  it('parses context tags and time estimates', () => {
    const res = parseQuickAdd('Fix router @computer ~45m #homelab', sampleProjects);
    expect(res.context_tags).toBe('@computer');
    expect(res.estimated_minutes).toBe(45);
    expect(res.project_id).toBe('p2');
    expect(res.title).toBe('Fix router');
  });

  it('parses a full complex query in one go', () => {
    const res = parseQuickAdd('Submit quarterly tax return tomorrow 3pm !urgent #work @computer ~2h', sampleProjects);
    expect(res.title).toBe('Submit quarterly tax return');
    expect(res.due_date).toBe(getTomorrowDateString());
    expect(res.due_time).toBe('15:00');
    expect(res.priority).toBe('urgent');
    expect(res.project_name).toBe('Work');
    expect(res.context_tags).toBe('@computer');
    expect(res.estimated_minutes).toBe(120);
    expect(res.tokens.length).toBeGreaterThanOrEqual(5);
  });
});
