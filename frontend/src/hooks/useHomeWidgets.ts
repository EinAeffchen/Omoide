import { useEffect, useState } from "react";
import { getConfig } from "../services/config";
import { HomeWidgetState, mergeHomeWidgets } from "../homeWidgets";

/** Homepage widget visibility + order, read from the saved library config. */
export function useHomeWidgets() {
  const [widgets, setWidgets] = useState<HomeWidgetState[]>(() =>
    mergeHomeWidgets(null)
  );

  useEffect(() => {
    let cancelled = false;
    getConfig()
      .then((cfg) => {
        if (!cancelled) setWidgets(mergeHomeWidgets(cfg.general.home_widgets));
      })
      .catch(() => {
        // Keep the default/legacy fallback already in state.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return { widgets };
}
