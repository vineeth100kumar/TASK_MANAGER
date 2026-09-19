import { describe, it, expect, beforeEach } from 'vitest';
import { getApiSecret, setApiSecret, clearApiSecret, hasApiSecret } from '../config';

describe('the access key', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('is empty until one is given', () => {
    // It used to fall back to 'sage_rpi5_secret_ios_key_2026', a constant in a
    // public repository that the backend accepted on every route.
    expect(getApiSecret()).toBe('');
    expect(hasApiSecret()).toBe(false);
  });

  it('never exposes a built-in default', () => {
    expect(getApiSecret()).not.toContain('sage_rpi5');
  });

  it('keeps what it is given, trimmed', () => {
    setApiSecret('  a-real-key  ');
    expect(getApiSecret()).toBe('a-real-key');
    expect(hasApiSecret()).toBe(true);
  });

  it('can be forgotten', () => {
    setApiSecret('a-real-key');
    clearApiSecret();
    expect(hasApiSecret()).toBe(false);
  });
});
