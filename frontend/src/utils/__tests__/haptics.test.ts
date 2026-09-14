import { describe, it, expect, vi } from 'vitest';
import { haptics } from '../haptics';

describe('haptics', () => {
  it('safely runs methods without throwing even if navigator.vibrate is undefined', () => {
    expect(() => haptics.light()).not.toThrow();
    expect(() => haptics.medium()).not.toThrow();
    expect(() => haptics.warning()).not.toThrow();
    expect(() => haptics.celebrate()).not.toThrow();
  });

  it('calls navigator.vibrate if available', () => {
    const vibrateMock = vi.fn();
    Object.defineProperty(window.navigator, 'vibrate', {
      value: vibrateMock,
      writable: true,
      configurable: true
    });

    haptics.light();
    expect(vibrateMock).toHaveBeenCalledWith(10);

    haptics.medium();
    expect(vibrateMock).toHaveBeenCalledWith(25);

    haptics.warning();
    expect(vibrateMock).toHaveBeenCalledWith([40, 30, 40]);
  });
});
