import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";

interface SelectionContextValue {
  isSelecting: boolean;
  selectedIds: Set<number>;
  toggleSelecting: () => void;
  toggle: (id: number) => void;
  clear: () => void;
}

const defaultValue: SelectionContextValue = {
  isSelecting: false,
  selectedIds: new Set(),
  toggleSelecting: () => {},
  toggle: () => {},
  clear: () => {},
};

export const SelectionContext = createContext<SelectionContextValue>(defaultValue);

export const SelectionProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  const toggleSelecting = useCallback(() => {
    setIsSelecting((prev) => {
      if (prev) setSelectedIds(new Set());
      return !prev;
    });
  }, []);

  const toggle = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const clear = useCallback(() => {
    setSelectedIds(new Set());
    setIsSelecting(false);
  }, []);

  const value = useMemo(
    () => ({ isSelecting, selectedIds, toggleSelecting, toggle, clear }),
    [isSelecting, selectedIds, toggleSelecting, toggle, clear]
  );

  return (
    <SelectionContext.Provider value={value}>
      {children}
    </SelectionContext.Provider>
  );
};

export const useSelection = () => useContext(SelectionContext);
