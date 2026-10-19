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

/**
 * Per-browser numeric view preference (slider positions, page sizes),
 * clamped to [min, max]. Falls back to `defaultValue` when nothing valid is
 * stored.
 */
export function useLocalStorageNumber(
  key: string,
  defaultValue: number,
  { min = -Infinity, max = Infinity }: { min?: number; max?: number } = {}
): [number, (value: number) => void] {
  const [value, setValue] = useState<number>(() => {
    try {
      const stored = Number(localStorage.getItem(key));
      const raw = localStorage.getItem(key);
      return raw !== null && Number.isFinite(stored)
        ? Math.min(max, Math.max(min, stored))
        : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, String(value));
    } catch {
      // Storage unavailable; keep the in-memory value.
    }
  }, [key, value]);

  return [value, setValue];
}
