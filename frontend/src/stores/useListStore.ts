import { create } from "zustand";
import { CursorPage } from "../types";

// A generic state shape for any paginated list
export interface ListState<T> {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
  isLoading: boolean;
  error: string | null;
}

// The state for the entire store, holding multiple lists
interface ListStoreState {
  // lists is a dictionary where the key is a unique string (e.g., an API endpoint)
  // and the value is the state of that list.
  lists: Record<string, ListState<any>>;

  // Generic actions that work with any data type T
  fetchInitial: <T>(
    listKey: string,
    fetcher: () => Promise<CursorPage<T>>
  ) => Promise<void>;
  loadMore: <T>(
    listKey: string,
    fetcher: (cursor?: string) => Promise<CursorPage<T>>
  ) => Promise<void>;
  removeItem: (listKey: string, itemId: number | string) => void;
  removeItems: (listKey: string, itemIds: (number | string)[]) => void;
  clearList: (listKey: string) => void;
  clearListsByPrefix: (prefix: string) => void;
  addItem: <T>(listKey: string, item: T, position?: "start" | "end") => void;
  updateItem: <T extends { id: any }>(listKey: string, item: T) => void;
}

// The default state for any new list
export const defaultListState: ListState<any> = {
  items: [],
  nextCursor: null,
  hasMore: true,
  isLoading: false,
  error: null,
};

export const useListStore = create<ListStoreState>((set, get) => ({
  lists: {},

  fetchInitial: async <T>(
    listKey: string,
    fetcher: () => Promise<CursorPage<T>>
  ) => {
    const existingList = get().lists[listKey];
    // Do not fetch if the list is already loading or if it already has content.
    // A new search will have a new listKey, so this check will allow the fetch.
    if (
      existingList?.isLoading ||
      (existingList && existingList.items.length > 0)
    ) {
      return;
    }

    set((state) => ({
      lists: {
        ...state.lists,
        [listKey]: { ...defaultListState, isLoading: true },
      },
    }));

    try {
      const response = await fetcher();
      set((state) => ({
        lists: {
          ...state.lists,
          [listKey]: {
            items: response.items,
            nextCursor: response.next_cursor,
            hasMore: response.next_cursor !== null,
            isLoading: false,
            error: null,
          },
        },
      }));
    } catch (error) {
      console.error(`Failed to fetch initial data for ${listKey}:`, error);
      set((state) => ({
        lists: {
          ...state.lists,
          [listKey]: {
            ...defaultListState,
            isLoading: false,
            hasMore: false,
            error: error instanceof Error ? error.message : String(error),
          },
        },
      }));
    }
  },

  loadMore: async <T>(
    listKey: string,
    fetcher: (cursor: string | null) => Promise<CursorPage<T>>
  ) => {
    const currentList = get().lists[listKey] as ListState<T> | undefined;
    if (!currentList || currentList.isLoading || !currentList.hasMore) return;

    set((state) => ({
      lists: { ...state.lists, [listKey]: { ...currentList, isLoading: true } },
    }));

    try {
      const response = await fetcher(currentList.nextCursor);
      // Merge from the latest state, not the pre-await snapshot: items removed
      // (or lists cleared) while the page was in flight must stay removed.
      set((state) => {
        const latest = state.lists[listKey];
        if (!latest) return state;
        return {
          lists: {
            ...state.lists,
            [listKey]: {
              ...latest,
              items: [...latest.items, ...response.items],
              nextCursor: response.next_cursor,
              hasMore: response.next_cursor !== null,
              isLoading: false,
              error: null,
            },
          },
        };
      });
    } catch (error) {
      console.error(`Failed to load more data for ${listKey}:`, error);
      set((state) => {
        const latest = state.lists[listKey];
        if (!latest) return state;
        return {
          lists: {
            ...state.lists,
            [listKey]: {
              ...latest,
              isLoading: false,
              hasMore: false,
              error: error instanceof Error ? error.message : String(error),
            },
          },
        };
      });
    }
  },
  removeItem: (listKey: string, itemId: number | string) => {
    set((state) => {
      const currentList = state.lists[listKey];
      if (!currentList) return state; // If the list doesn't exist, do nothing

      const updatedItems = currentList.items.filter((item: any) => {
        const itemIdentifier =
          item.group_id !== undefined ? item.group_id : item.id;

        return itemIdentifier !== itemId;
      });

      return {
        lists: {
          ...state.lists,
          [listKey]: {
            ...currentList,
            items: updatedItems,
          },
        },
      };
    });
  },
  removeItems: (listKey, itemIds) => {
    set((state) => {
      const currentList = state.lists[listKey];
      if (!currentList) return state;

      // Create a Set of IDs for efficient lookup
      const idsToRemove = new Set(itemIds);
      const updatedItems = currentList.items.filter(
        (item: any) => !idsToRemove.has(item.id)
      );

      return {
        lists: {
          ...state.lists,
          [listKey]: {
            ...currentList,
            items: updatedItems,
          },
        },
      };
    });
  },
  clearList: (listKey: string) => {
    set((state) => {
      const newLists = { ...state.lists };
      delete newLists[listKey];
      return { lists: newLists };
    });
  },
  // Drops every cached list whose key starts with the prefix, so stale
  // variants (e.g. the other sort order) refetch on their next mount.
  clearListsByPrefix: (prefix: string) => {
    set((state) => {
      const newLists: Record<string, ListState<any>> = {};
      for (const [key, value] of Object.entries(state.lists)) {
        if (!key.startsWith(prefix)) newLists[key] = value;
      }
      return { lists: newLists };
    });
  },
  addItem: (listKey, item, position = "end") => {
    set((state) => {
      const currentList = state.lists[listKey];
      if (!currentList) return state;

      const updatedItems =
        position === "start"
          ? [item, ...currentList.items]
          : [...currentList.items, item];

      return {
        lists: {
          ...state.lists,
          [listKey]: {
            ...currentList,
            items: updatedItems,
          },
        },
      };
    });
  },

  updateItem: (listKey, updatedItem) => {
    set((state) => {
      const currentList = state.lists[listKey];
      if (!currentList) return state;
      const updatedItems = currentList.items.map((item: any) =>
        item.data.id === updatedItem.id ? { ...item, data: updatedItem } : item
      );
      return {
        lists: {
          ...state.lists,
          [listKey]: { ...currentList, items: updatedItems },
        },
      };
    });
  },
}));
