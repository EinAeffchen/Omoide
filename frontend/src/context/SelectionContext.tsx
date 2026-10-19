import React from "react";
import { create } from "zustand";

interface SelectionState {
  isSelecting: boolean;
  selectedIds: Set<number>;
  toggleSelecting: () => void;
  toggle: (id: number) => void;
  clear: () => void;
}

/**
 * App-wide media selection (the header's "select items" mode). A store
 * rather than React context, so toggling one card only re-renders that card
 * (via `useIsSelected`) instead of every card on the page.
 */
const useSelectionStore = create<SelectionState>((set) => ({
  isSelecting: false,
  selectedIds: new Set(),
  toggleSelecting: () =>
    set((state) => ({
      isSelecting: !state.isSelecting,
      selectedIds: state.isSelecting ? new Set() : state.selectedIds,
    })),
  toggle: (id) =>
    set((state) => {
      const selectedIds = new Set(state.selectedIds);
      if (selectedIds.has(id)) selectedIds.delete(id);
      else selectedIds.add(id);
      return { selectedIds };
    }),
  clear: () => set({ selectedIds: new Set(), isSelecting: false }),
}));

/** Kept for API compatibility; the selection no longer needs a provider. */
export const SelectionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => <>{children}</>;

/** The whole selection; use in toolbars that show counts or act on it. */
export const useSelection = () => useSelectionStore();

/** Per-item subscription for cards: re-renders only when this id flips. */
export const useIsSelected = (id: number | undefined) =>
  useSelectionStore((state) => id !== undefined && state.selectedIds.has(id));

export const useIsSelecting = () => useSelectionStore((state) => state.isSelecting);

export const useToggleSelected = () => useSelectionStore((state) => state.toggle);
