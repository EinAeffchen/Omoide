import { useState, useRef, useEffect, useCallback } from "react";

export type CursorResponse<T> = {
  items: T[];
  next_cursor: string | null;
};

export function useInfinite<T>(
  fetchPage: (
    cursor?: string
  ) => Promise<CursorResponse<T>>,
  resetDeps: any[] = [],
  disabled: boolean = false
) {
  const [items, setItems] = useState<T[]>([]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const loaderRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(() => {
    if (loading || !hasMore) return;
    setLoading(true);

    fetchPage(cursor)
      .then(({ items: newItems, next_cursor }) => {
        setItems((prev) => [...prev, ...newItems]);
        setCursor(next_cursor || undefined);
        setHasMore(next_cursor !== null);
        setError(null);
      })
      .catch((err) => {
        console.error(err);
        setError(err instanceof Error ? err.message : String(err));
        setHasMore(false);
      })
      .finally(() => setLoading(false));
  }, [cursor, fetchPage, hasMore, loading]);

  useEffect(() => {
    const controller = new AbortController();

    setItems([]);
    setCursor(undefined);
    setHasMore(true);
    setLoading(true);
    setError(null);

    fetchPage(undefined)
      .then(({ items: firstItems, next_cursor }) => {
        if (!controller.signal.aborted) {
          setItems(firstItems);
          setCursor(next_cursor || undefined);
          setHasMore(next_cursor !== null);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!controller.signal.aborted) {
          console.error(err);
          setError(err instanceof Error ? err.message : String(err));
          setHasMore(false);
          setLoading(false);
        }
      });

    return () => controller.abort();
  }, resetDeps);

  useEffect(() => {
    if (disabled) return;
    if (loading || !hasMore) return;
    const el = loaderRef.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) {
          obs.disconnect();
          loadMore();
        }
      },
      { rootMargin: "200px" }
    );

    obs.observe(el);
    return () => {
      obs.disconnect();
    };
  }, [hasMore, loading, loadMore]);

  return { items, setItems, hasMore, loading, error, loaderRef, disabled };
}
