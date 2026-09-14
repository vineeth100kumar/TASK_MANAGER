/**
 * Safe localStorage wrapper that handles disabled storage, Private Browsing mode,
 * quota exceeded errors, and JSON serialization.
 */
export const storage = {
  get(key: string, defaultValue: string = ''): string {
    try {
      const val = localStorage.getItem(key);
      return val !== null ? val : defaultValue;
    } catch {
      return defaultValue;
    }
  },

  set(key: string, value: string): boolean {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },

  remove(key: string): boolean {
    try {
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  },

  getJSON<T>(key: string, defaultValue: T): T {
    try {
      const val = localStorage.getItem(key);
      if (val === null) return defaultValue;
      return JSON.parse(val) as T;
    } catch {
      return defaultValue;
    }
  },

  setJSON<T>(key: string, value: T): boolean {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }
};
