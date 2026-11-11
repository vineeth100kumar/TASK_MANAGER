import { describe, expect, it } from 'vitest';
import { sizeText, timeLeft } from './drop';

describe('drop', () => {
  it('says how long a link has left', () => {
    expect(timeLeft(1000, 1000 + 30)).toBe('under a minute');
    expect(timeLeft(10 * 60, 0)).toBe('10 min');
    expect(timeLeft(2 * 3600 + 15 * 60, 0)).toBe('2 h 15 min');
    expect(timeLeft(20 * 3600, 0)).toBe('20 h');
    expect(timeLeft(6 * 86400 + 5 * 3600, 0)).toBe('6 d 5 h');
    // Just under a week reads 6 d 23 h, never 6 d 24 h.
    expect(timeLeft(7 * 86400 - 1, 0)).toBe('6 d 23 h');
  });
  it('sizes files', () => {
    expect(sizeText(512)).toBe('512 B');
    expect(sizeText(2048)).toBe('2.0 KB');
    expect(sizeText(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});
