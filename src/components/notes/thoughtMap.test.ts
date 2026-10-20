import { describe, expect, it } from 'vitest';
import { Thought } from '../../services/types';
import { buildThoughtFlow, countStatuses, nextStatus, parseThought, splitLines, topicsOf } from './thoughtMap';

let n = 0;
const t = (text: string, status: Thought['status'], topic = '', at = `2026-10-13T09:${String(n).padStart(2, '0')}:00`): Thought =>
  ({ id: `t${++n}`, mapId: 'm', text, status, topic, createdAt: at });

describe('parseThought', () => {
  it('reads the icon from a prefix and the topic from a tag', () => {
    expect(parseThought('con: grant is slow #money', ['Money'])).toEqual({ text: 'grant is slow', status: 'bad', topic: 'Money' });
    expect(parseThought('pro - 8 months of savings', [])).toEqual({ text: '8 months of savings', status: 'good', topic: undefined });
    expect(parseThought('? who could be CTO #co-founder', [])).toEqual({ text: 'who could be CTO', status: 'open', topic: 'Co founder' });
    expect(parseThought('unsure: raise first', []).status).toBe('unsure');
    expect(parseThought('No-shows tool for clinics', []).text).toBe('No-shows tool for clinics');
    expect(parseThought('Quit in March', [])).toEqual({ text: 'Quit in March', status: undefined, topic: undefined });
  });

  it('leaves a leading minus alone, since pasted lists use it as a bullet', () => {
    expect(parseThought('- 5% margin is fine', []).status).toBeUndefined();
  });
});

describe('splitLines', () => {
  it('drops bullets and blank lines', () => {
    expect(splitLines('- one\n\n• two\n3. three\n  four  ')).toEqual(['one', 'two', 'three', 'four']);
  });
});

describe('buildThoughtFlow', () => {
  it('branches topics off the main line and folds settled ones back', () => {
    n = 0;
    const thoughts = [
      t('Start a company?', 'open'),
      t('Clinic tool', 'good', 'Idea'),
      t('Social app', 'bad', 'Idea'),
      t('Savings', 'good', 'Money'),
      t('Raise first?', 'unsure', 'money'),
      t('Co-founder', 'open', 'People', '2026-10-15T08:00:00'),
    ];
    const flow = buildThoughtFlow(thoughts);
    expect(flow.rows.map(r => r.kind)).toEqual(['day', 'thought', 'fork', 'thought', 'thought', 'settle', 'fork', 'thought', 'thought', 'day', 'fork', 'thought']);
    // Idea settled, so Money reuses its lane; Money is still open, so People goes beside it.
    const forks = flow.rows.filter(r => r.kind === 'fork') as Array<{ topic: string; lane: number }>;
    expect(forks.map(f => [f.topic, f.lane])).toEqual([['Idea', 1], ['Money', 1], ['People', 2]]);
    expect(flow.laneCount).toBe(3);
    expect(flow.spans.find(s => s.color === topicsOf(thoughts)[0].color)?.open).toBe(false);
    expect(countStatuses(thoughts)).toEqual({ open: 2, unsure: 1, good: 2, bad: 1 });
  });

  it('keeps topic colours when filtered', () => {
    n = 0;
    const all = [t('a', 'good', 'Idea'), t('b', 'open', 'Money')];
    const flow = buildThoughtFlow(all.slice(1), topicsOf(all));
    const fork = flow.rows.find(r => r.kind === 'fork') as { color: string };
    expect(fork.color).toBe(topicsOf(all)[1].color);
  });

  it('cycles icons in order', () => {
    expect(['open', 'unsure', 'good', 'bad'].map(s => nextStatus(s as Thought['status']))).toEqual(['unsure', 'good', 'bad', 'open']);
  });
});
