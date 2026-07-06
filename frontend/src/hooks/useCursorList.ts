import { useCallback, useEffect, useRef, useState } from "react";
import { useInView } from "react-intersection-observer";

export interface CursorListPage<T> {
  items: T[];
  next_cursor: string | null;
  total: number;
}

export interface CursorListResult<T> {
  items: T[];
  total: number;
  hasMore: boolean;
  isLoading: boolean;
  error: string | null;
  loaderRef: (node?: Element | null) => void;
  selectedIds: Set<number>;
  toggleSelected: (id: number) => void;
  selectVisible: () => void;
  clearSelection: () => void;
  removeItems: (ids: Iterable<number>, removedCount?: number) => void;
  refetch: () => Promise<void>;
}

export function useCursorList<T extends { id: number }>(
  fetcher: (cursor: string | null) => Promise<CursorListPage<T>>,
  refreshKey = 0
): CursorListResult<T> {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const generationRef = useRef(0);
  const nextCursorRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  const { ref: loaderRef, inView } = useInView({ threshold: 0.5 });

  const fetchPage = useCallback(
    async (cursor: string | null, append: boolean) => {
      if (!append) {
        generationRef.current += 1;
        nextCursorRef.current = null;
        setHasMore(false);
      }
      const generation = generationRef.current;
      inFlightRef.current = true;
      setIsLoading(true);
      setError(null);
      try {
        const page = await fetcher(cursor);
        if (generation !== generationRef.current) return;
        setItems((prev) => (append ? [...prev, ...page.items] : page.items));
        setTotal(page.total);
        nextCursorRef.current = page.next_cursor;
        setHasMore(Boolean(page.next_cursor));
        if (!append) setSelectedIds(new Set());
      } catch (e) {
        if (generation !== generationRef.current) return;
        setError(e instanceof Error ? e.message : "Failed to load media");
      } finally {
        if (generation === generationRef.current) {
          inFlightRef.current = false;
          setIsLoading(false);
        }
      }
    },
    [fetcher]
  );

  useEffect(() => {
    fetchPage(null, false);
  }, [fetchPage, refreshKey]);

  useEffect(() => {
    if (
      inView &&
      hasMore &&
      !isLoading &&
      !inFlightRef.current &&
      nextCursorRef.current
    ) {
      fetchPage(nextCursorRef.current, true);
    }
  }, [inView, hasMore, isLoading, fetchPage]);

  const toggleSelected = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const selectVisible = useCallback(() => {
    setSelectedIds(new Set(items.map((item) => item.id)));
  }, [items]);

  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  const removeItems = useCallback(
    (ids: Iterable<number>, removedCount?: number) => {
      const idSet = ids instanceof Set ? ids : new Set(ids);
      setItems((prev) => prev.filter((item) => !idSet.has(item.id)));
      setTotal((prev) => Math.max(0, prev - (removedCount ?? idSet.size)));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        idSet.forEach((id) => next.delete(id));
        return next;
      });
    },
    []
  );

  const refetch = useCallback(() => fetchPage(null, false), [fetchPage]);

  return {
    items,
    total,
    hasMore,
    isLoading,
    error,
    loaderRef,
    selectedIds,
    toggleSelected,
    selectVisible,
    clearSelection,
    removeItems,
    refetch,
  };
}
