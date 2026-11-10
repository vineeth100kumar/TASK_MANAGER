import { describe, expect, it } from 'vitest';
import { VOICE_PICKS, withVoice } from './reels';

describe('VOICE_PICKS', () => {
  it('offers two women and two men', () => {
    expect(VOICE_PICKS).toHaveLength(4);
    const women = VOICE_PICKS.filter(v => v.label.includes('woman'));
    const men = VOICE_PICKS.filter(v => v.label.includes('man') && !v.label.includes('woman'));
    expect(women).toHaveLength(2);
    expect(men).toHaveLength(2);
    // every id is a real Kokoro voice slug
    for (const v of VOICE_PICKS) expect(v.id).toMatch(/^(a|b)(f|m)_[a-z]+$/);
  });
});

describe('withVoice', () => {
  const base = '---\nautocontent: reel\ntitle: Test\nvoice: af_heart\n---\n\n## cover\nsay: hi\n';

  it("leaves the script alone for 'script' and ''", () => {
    expect(withVoice(base, 'script')).toBe(base);
    expect(withVoice(base, '')).toBe(base);
  });

  it('replaces an existing voice line', () => {
    const out = withVoice(base, 'am_michael');
    expect(out).toContain('voice: am_michael');
    expect(out).not.toContain('voice: af_heart');
    expect(out).toContain('## cover\nsay: hi');          // body untouched
  });

  it('adds a voice line when the script has none', () => {
    const noVoice = '---\nautocontent: reel\ntitle: Test\n---\n\n## cover\nsay: hi\n';
    const out = withVoice(noVoice, 'bm_george');
    expect(out).toMatch(/title: Test\nvoice: bm_george\n---/);
  });

  it("'mine' turns a Kokoro script into your-own-recording", () => {
    const out = withVoice(base, 'mine');
    expect(out).toContain('voice: mine');
    expect(out).not.toContain('voice: af_heart');
  });

  it("leaves a script with no frontmatter alone", () => {
    const noFront = '## cover\nsay: hi\n';
    expect(withVoice(noFront, 'am_michael')).toBe(noFront);
  });

  it("keeps the indentation of the voice line", () => {
    const indented = '---\n  voice: af_heart\n---\n';
    expect(withVoice(indented, 'am_michael')).toContain('  voice: am_michael');
  });
});
