import { useEffect, useState } from "react";

/**
 * Per-browser view preference limited to a fixed set of string values,
 * persisted in localStorage. Falls back to `defaultValue` when storage is
 * unavailable or holds an unknown value.
 */
export function useLocalStoragePreference<T extends string>(
  key: string,
  allowed: readonly T[],
  defaultValue: T
): [T, (value: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const stored = localStorage.getItem(key);
      return allowed.includes(stored as T) ? (stored as T) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Storage unavailable; keep the in-memory value.
    }
  }, [key, value]);

  return [value, setValue];
}
