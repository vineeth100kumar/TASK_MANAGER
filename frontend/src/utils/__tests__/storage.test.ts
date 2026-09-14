import { describe, it, expect, beforeEach } from 'vitest';
import { storage } from '../storage';

describe('storage utility', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('stores and retrieves string values', () => {
    storage.set('test_key', 'hello_world');
    expect(storage.get('test_key')).toBe('hello_world');
  });

  it('returns default value when key does not exist', () => {
    expect(storage.get('missing_key', 'default_val')).toBe('default_val');
  });

  it('removes keys', () => {
    storage.set('remove_me', '123');
    storage.remove('remove_me');
    expect(storage.get('remove_me')).toBe('');
  });

  it('stores and retrieves JSON values', () => {
    const data = { theme: 'dark', score: 100 };
    storage.setJSON('settings', data);
    expect(storage.getJSON('settings', { theme: 'light', score: 0 })).toEqual(data);
  });

  it('returns fallback when JSON parsing fails', () => {
    localStorage.setItem('corrupt', 'not valid json {{{');
    expect(storage.getJSON('corrupt', { safe: true })).toEqual({ safe: true });
  });
});
