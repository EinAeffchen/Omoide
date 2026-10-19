import { create } from "zustand";
import { isAbortError } from "../services/api";

/** One page of a cursor-paginated list, as returned by the backend. */
export interface PageResponse<T> {
  items: T[];
  next_cursor: string | null;
  total?: number;
}

/** Loads one page; `cursor` is null for the first page. */
export type PageFetcher<T> = (
  cursor: string | null,
  signal: AbortSignal
) => Promise<PageResponse<T>>;

export type ItemId = number | string;

export interface ListState<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  isLoading: boolean;
  error: string | null;
  /** Server-reported total, when the endpoint provides one. */
  total: number | null;
}

interface ListStoreState {
  /** Lists keyed by a caller-chosen key (e.g. "favorites-newest"). */
  lists: Record<string, ListState<unknown>>;

  /** Load the first page unless the list is cached or already loading.
   * `force` drops the cached list and refetches. */
  fetchInitial: <T>(
    listKey: string,
    fetcher: PageFetcher<T>,
    options?: { force?: boolean; signal?: AbortSignal }
  ) => Promise<void>;
  /** Append the next page; ignored while a request is in flight. */
  loadMore: <T>(
    listKey: string,
    fetcher: PageFetcher<T>,
    options?: { signal?: AbortSignal }
  ) => Promise<void>;
  /** Abort the in-flight request of a list, if any. */
  cancel: (listKey: string) => void;
  removeItems: (
    listKey: string,
    ids: Iterable<ItemId>,
    options?: { removedCount?: number }
  ) => void;
  updateItems: <T>(listKey: string, update: (item: T) => T) => void;
  addItem: <T>(listKey: string, item: T, position?: "start" | "end") => void;
  clearList: (listKey: string) => void;
  clearListsByPrefix: (prefix: string) => void;
}

export const defaultListState: ListState<never> = {
  items: [],
  nextCursor: null,
  hasMore: true,
  isLoading: false,
  error: null,
  total: null,
};

/** Duplicate groups are keyed by `group_id`, everything else by `id`. */
export const itemIdOf = (item: unknown): ItemId => {
  const record = item as { id?: ItemId; group_id?: ItemId };
  return (record.group_id ?? record.id) as ItemId;
};

// In-flight requests per list. Kept outside the store state so aborting
// never triggers a render.
const controllers = new Map<string, AbortController>();

function startRequest(listKey: string, external?: AbortSignal) {
  controllers.get(listKey)?.abort();
  const controller = new AbortController();
  controllers.set(listKey, controller);
  if (external) {
    if (external.aborted) controller.abort();
    else
      external.addEventListener("abort", () => controller.abort(), {
        once: true,
      });
  }
  return controller;
}

const isCurrent = (listKey: string, controller: AbortController) =>
  controllers.get(listKey) === controller && !controller.signal.aborted;

const errorText = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

export const useListStore = create<ListStoreState>((set, get) => {
  const patch = (listKey: string, change: Partial<ListState<unknown>>) =>
    set((state) => {
      const current = state.lists[listKey];
      if (!current) return state;
      return {
        lists: { ...state.lists, [listKey]: { ...current, ...change } },
      };
    });

  const finish = (listKey: string, controller: AbortController) => {
    if (controllers.get(listKey) === controller) controllers.delete(listKey);
  };

  return {
    lists: {},

    fetchInitial: async (listKey, fetcher, options = {}) => {
      const existing = get().lists[listKey];
      if (
        !options.force &&
        existing &&
        (existing.isLoading || existing.items.length > 0)
      ) {
        return;
      }
      const controller = startRequest(listKey, options.signal);
      set((state) => ({
        lists: {
          ...state.lists,
          [listKey]: { ...defaultListState, isLoading: true },
        },
      }));
      try {
        const page = await fetcher(null, controller.signal);
        if (!isCurrent(listKey, controller)) return;
        patch(listKey, {
          items: page.items,
          nextCursor: page.next_cursor,
          hasMore: page.next_cursor !== null,
          isLoading: false,
          error: null,
          total: page.total ?? null,
        });
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
          // Leave an empty, idle list so the next mount fetches again.
          if (controllers.get(listKey) === controller)
            patch(listKey, { isLoading: false });
          return;
        }
        if (!isCurrent(listKey, controller)) return;
        console.error(`Failed to load ${listKey}:`, error);
        patch(listKey, {
          isLoading: false,
          hasMore: false,
          error: errorText(error),
        });
      } finally {
        finish(listKey, controller);
      }
    },

    loadMore: async (listKey, fetcher, options = {}) => {
      const current = get().lists[listKey];
      if (!current || current.isLoading || !current.hasMore) return;
      const controller = startRequest(listKey, options.signal);
      patch(listKey, { isLoading: true });
      try {
        const page = await fetcher(current.nextCursor, controller.signal);
        if (!isCurrent(listKey, controller)) return;
        // Merge into the latest state, not the pre-await snapshot: items
        // removed while the page was in flight must stay removed.
        set((state) => {
          const latest = state.lists[listKey];
          if (!latest) return state;
          return {
            lists: {
              ...state.lists,
              [listKey]: {
                ...latest,
                items: [...latest.items, ...page.items],
                nextCursor: page.next_cursor,
                hasMore: page.next_cursor !== null,
                isLoading: false,
                error: null,
                total: page.total ?? latest.total,
              },
            },
          };
        });
      } catch (error) {
        if (isAbortError(error) || controller.signal.aborted) {
          if (controllers.get(listKey) === controller)
            patch(listKey, { isLoading: false });
          return;
        }
        if (!isCurrent(listKey, controller)) return;
        console.error(`Failed to load more of ${listKey}:`, error);
        patch(listKey, {
          isLoading: false,
          hasMore: false,
          error: errorText(error),
        });
      } finally {
        finish(listKey, controller);
      }
    },

    cancel: (listKey) => controllers.get(listKey)?.abort(),

    removeItems: (listKey, ids, options = {}) => {
      const idSet = new Set(ids);
      set((state) => {
        const current = state.lists[listKey];
        if (!current) return state;
        const items = current.items.filter((item) => !idSet.has(itemIdOf(item)));
        const removed = options.removedCount ?? current.items.length - items.length;
        return {
          lists: {
            ...state.lists,
            [listKey]: {
              ...current,
              items,
              total:
                current.total === null
                  ? null
                  : Math.max(0, current.total - removed),
            },
          },
        };
      });
    },

    updateItems: (listKey, update) =>
      set((state) => {
        const current = state.lists[listKey];
        if (!current) return state;
        return {
          lists: {
            ...state.lists,
            [listKey]: {
              ...current,
              items: current.items.map((item) => update(item as never)),
            },
          },
        };
      }),

    addItem: (listKey, item, position = "end") =>
      set((state) => {
        const current = state.lists[listKey];
        if (!current) return state;
        const items =
          position === "start"
            ? [item, ...current.items]
            : [...current.items, item];
        return {
          lists: { ...state.lists, [listKey]: { ...current, items } },
        };
      }),

    clearList: (listKey) => {
      controllers.get(listKey)?.abort();
      set((state) => {
        const lists = { ...state.lists };
        delete lists[listKey];
        return { lists };
      });
    },

    // Drops every cached list whose key starts with the prefix, so stale
    // variants (e.g. the other sort order) refetch on their next mount.
    clearListsByPrefix: (prefix) => {
      for (const [key, controller] of controllers) {
        if (key.startsWith(prefix)) controller.abort();
      }
      set((state) => {
        const lists: Record<string, ListState<unknown>> = {};
        for (const [key, value] of Object.entries(state.lists)) {
          if (!key.startsWith(prefix)) lists[key] = value;
        }
        return { lists };
      });
    },
  };
});
