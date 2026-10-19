import { useCallback, useEffect, useRef } from "react";
import { useInView } from "react-intersection-observer";
import {
  defaultListState,
  ItemId,
  ListState,
  PageFetcher,
  useListStore,
} from "../stores/useListStore";

export interface PagedListOptions {
  /** Skip loading (e.g. until a required parameter is known). */
  enabled?: boolean;
  /** Load the next page automatically when `loaderRef` scrolls into view. */
  infiniteScroll?: boolean;
  /** Reload on mount instead of reusing a cached list, for lists that other
   * screens can change (e.g. album contents). */
  refetchOnMount?: boolean;
}

export interface PagedList<T> extends ListState<T> {
  /** Attach to a sentinel element below the list for infinite scrolling. */
  loaderRef: (node?: Element | null) => void;
  loadMore: () => void;
  /** Drop the cached list and load it again from the first page. */
  reload: () => void;
  removeItems: (ids: Iterable<ItemId>, removedCount?: number) => void;
  updateItems: (update: (item: T) => T) => void;
}

/**
 * The one way to show a cursor-paginated list. Pages are cached in the list
 * store under `listKey` (so navigating back restores them instantly), every
 * request is cancellable, and requests started by this component are aborted
 * when it unmounts or the key changes. Components only re-render when their
 * own list changes.
 */
export function usePagedList<T>(
  listKey: string,
  fetchPage: PageFetcher<T>,
  {
    enabled = true,
    infiniteScroll = true,
    refetchOnMount = false,
  }: PagedListOptions = {}
): PagedList<T> {
  const list = useListStore(
    (state) => (state.lists[listKey] as ListState<T> | undefined) ?? defaultListState
  ) as ListState<T>;
  // Actions are stable references; selecting them individually keeps this
  // component out of re-renders caused by other lists.
  const fetchInitial = useListStore((state) => state.fetchInitial);
  const fetchMore = useListStore((state) => state.loadMore);
  const removeFromList = useListStore((state) => state.removeItems);
  const updateInList = useListStore((state) => state.updateItems);

  // Latest fetcher without making every render a new effect dependency.
  const fetchRef = useRef(fetchPage);
  fetchRef.current = fetchPage;
  const fetcher = useCallback<PageFetcher<T>>(
    (cursor, signal) => fetchRef.current(cursor, signal),
    []
  );

  // Aborting this controller cancels whatever this component started.
  const ownerRef = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const owner = new AbortController();
    ownerRef.current = owner;
    void fetchInitial(listKey, fetcher, {
      signal: owner.signal,
      force: refetchOnMount,
    });
    return () => owner.abort();
  }, [listKey, enabled, refetchOnMount, fetchInitial, fetcher]);

  const loadMore = useCallback(() => {
    if (!enabled) return;
    void fetchMore(listKey, fetcher, { signal: ownerRef.current?.signal });
  }, [enabled, fetchMore, listKey, fetcher]);

  const reload = useCallback(() => {
    if (!enabled) return;
    void fetchInitial(listKey, fetcher, {
      force: true,
      signal: ownerRef.current?.signal,
    });
  }, [enabled, fetchInitial, listKey, fetcher]);

  const { ref: loaderRef, inView } = useInView({ rootMargin: "400px" });
  const { hasMore, isLoading, error } = list;
  useEffect(() => {
    if (infiniteScroll && inView && hasMore && !isLoading && !error) loadMore();
  }, [infiniteScroll, inView, hasMore, isLoading, error, loadMore]);

  const removeItems = useCallback(
    (ids: Iterable<ItemId>, removedCount?: number) =>
      removeFromList(listKey, ids, { removedCount }),
    [removeFromList, listKey]
  );
  const updateItems = useCallback(
    (update: (item: T) => T) => updateInList<T>(listKey, update),
    [updateInList, listKey]
  );

  return { ...list, loaderRef, loadMore, reload, removeItems, updateItems };
}

/** Read a list another component loaded (e.g. for prev/next navigation),
 * without loading or cancelling anything. */
export function useCachedList<T>(listKey: string | null | undefined) {
  return useListStore((state) =>
    listKey ? (state.lists[listKey] as ListState<T> | undefined) : undefined
  );
}
