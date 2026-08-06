import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_ENABLED_WIDGETS,
  DEFAULT_HOME_WIDGET_ORDER,
  HomeWidgetId,
  isHomeWidgetId,
} from "../homeWidgets";

const STORAGE_KEY = "home_widgets_v1";
// Legacy per-widget flag this feature replaces; honored once as a migration
// so upgrading users don't see "On this day" reappear against their wishes.
const LEGACY_OTD_ENABLED_KEY = "otd_enabled";

export interface HomeWidgetState {
  id: HomeWidgetId;
  enabled: boolean;
}

const defaultEnabledFor = (id: HomeWidgetId): boolean => {
  if (id === "on_this_day") {
    const legacy = localStorage.getItem(LEGACY_OTD_ENABLED_KEY);
    if (legacy !== null) return legacy === "true";
  }
  return DEFAULT_ENABLED_WIDGETS.includes(id);
};

const buildDefault = (): HomeWidgetState[] =>
  DEFAULT_HOME_WIDGET_ORDER.map((id) => ({
    id,
    enabled: defaultEnabledFor(id),
  }));

const load = (): HomeWidgetState[] => {
  let stored: HomeWidgetState[] = [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        stored = parsed.filter(
          (entry): entry is HomeWidgetState =>
            entry &&
            typeof entry.id === "string" &&
            isHomeWidgetId(entry.id) &&
            typeof entry.enabled === "boolean"
        );
      }
    }
  } catch {
    stored = [];
  }
  if (stored.length === 0) return buildDefault();
  // Append any widget shipped after the user last saved their layout so new
  // features aren't silently missing from settings.
  const seen = new Set(stored.map((s) => s.id));
  const missing = DEFAULT_HOME_WIDGET_ORDER.filter((id) => !seen.has(id)).map(
    (id) => ({ id, enabled: defaultEnabledFor(id) })
  );
  return [...stored, ...missing];
};

/** Per-browser homepage widget visibility + order, persisted in localStorage. */
export function useHomeWidgets() {
  const [widgets, setWidgets] = useState<HomeWidgetState[]>(load);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(widgets));
  }, [widgets]);

  const toggle = useCallback((id: HomeWidgetId, enabled: boolean) => {
    setWidgets((prev) => prev.map((w) => (w.id === id ? { ...w, enabled } : w)));
  }, []);

  const move = useCallback((id: HomeWidgetId, direction: -1 | 1) => {
    setWidgets((prev) => {
      const index = prev.findIndex((w) => w.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }, []);

  const reset = useCallback(() => setWidgets(buildDefault()), []);

  return { widgets, toggle, move, reset };
}
