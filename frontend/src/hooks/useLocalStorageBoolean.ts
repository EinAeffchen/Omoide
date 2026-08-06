import { useEffect, useState } from "react";

/** Per-browser boolean preference persisted in localStorage (e.g. theme mode). */
export function useLocalStorageBoolean(
  key: string,
  defaultValue: boolean
): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState<boolean>(() => {
    const stored = localStorage.getItem(key);
    return stored === null ? defaultValue : stored === "true";
  });

  useEffect(() => {
    localStorage.setItem(key, String(value));
  }, [key, value]);

  return [value, setValue];
}
