import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { usePersistedState } from '../usePersistedState';

describe('usePersistedState', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('initializes with default value if localStorage is empty', () => {
    const { result } = renderHook(() => usePersistedState('test_key', 'initial'));
    expect(result.current[0]).toBe('initial');
  });

  it('persists updates to localStorage', () => {
    const { result } = renderHook(() => usePersistedState('test_key', 'initial'));
    
    act(() => {
      result.current[1]('updated');
    });

    expect(result.current[0]).toBe('updated');
    expect(JSON.parse(window.localStorage.getItem('sage_test_key')!)).toBe('updated');
  });
});
