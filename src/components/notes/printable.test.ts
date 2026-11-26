import { describe, expect, it } from 'vitest';
import { Note, Thought } from '../../services/types';
import { codePage, mapPage, notePage, reportPage } from './printable';

const note = (over: Partial<Note> = {}): Note => ({ id: 'n', title: 'Plan <A>', content: 'plain', createdAt: '2026-11-01T00:00:00Z', updatedAt: '2026-11-02T00:00:00Z', ...over });
let i = 0;
const th = (text: string, status: Thought['status'], topic = '', parentId: string | null = null, id = `t${++i}`): Thought =>
  ({ id, mapId: 'n', text, status, topic, parentId, createdAt: `2026-11-01T00:00:${String(i).padStart(2, '0')}Z` });

describe('printable pages', () => {
  it('prints a note with its title and no scripts', () => {
    const html = notePage(note(), '<p>Hello</p><script>alert(1)</script><img src=x onerror="evil()">');
    expect(html).toContain('<p>Hello</p>');
    expect(html).toContain('Plan &lt;A&gt;');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
  });

  it('keeps a report as sent but adds print rules and drops scripts', () => {
    const html = reportPage(note({ kind: 'html' }), '<html><head><title>R</title></head><body><h1>Report</h1><script>x()</script></body></html>');
    expect(html).toContain('<h1>Report</h1>');
    expect(html).toContain('@page');
    expect(html).not.toContain('<script');
  });

  it('escapes code', () => {
    expect(codePage(note({ kind: 'code', language: 'py' }), 'a < b')).toContain('a &lt; b');
  });

  it('prints a map as an outline with marks, topics and nesting', () => {
    const a = th('Savings last 8 months', 'good', '', null, 'a');
    const b = th('Grant is slow', 'bad', 'Money', null, 'b');
    const c = th('Ask the bank', 'open', 'Money', 'b', 'c');
    const html = mapPage(note({ kind: 'map' }), [a, b, c]);
    expect(html).toContain('<h2>Money</h2>');
    expect(html).toContain('Savings last 8 months');
    expect(html.indexOf('Grant is slow')).toBeLessThan(html.indexOf('Ask the bank'));
    expect(html).toContain('class="kids"');
    expect(html).toContain('✓');
    expect(html).toContain('✗');
  });

  it('says so when a map is empty', () => {
    expect(mapPage(note({ kind: 'map' }), [])).toContain('No thoughts yet');
  });
});
