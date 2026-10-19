import { useCallback, useState } from "react";

/** A set of selected ids with the usual toggle/select-all/clear helpers. */
export function useIdSelection<Id = number>() {
  const [selectedIds, setSelectedIds] = useState<Set<Id>>(() => new Set());

  const toggle = useCallback((id: Id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAll = useCallback((ids: Iterable<Id>) => {
    setSelectedIds(new Set(ids));
  }, []);

  const deselect = useCallback((ids: Iterable<Id>) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelectedIds(new Set()), []);

  return { selectedIds, toggle, selectAll, deselect, clear };
}
