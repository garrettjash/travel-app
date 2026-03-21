import { createContext, ReactNode, useCallback, useContext, useMemo, useRef, useState } from "react";

type UndoEntry = {
  id: string;
  message: string;
  undo: () => void;
  timer: ReturnType<typeof setTimeout>;
};

type UndoContextValue = {
  addUndo: (message: string, undo: () => void, timeoutMs?: number) => void;
};

const UndoContext = createContext<UndoContextValue | undefined>(undefined);

export function UndoProvider({ children }: { children: ReactNode }) {
  const [entries, setEntries] = useState<UndoEntry[]>([]);
  const entriesRef = useRef<UndoEntry[]>([]);
  entriesRef.current = entries;

  const removeEntry = useCallback((id: string) => {
    setEntries((current) => {
      const target = current.find((entry) => entry.id === id);
      if (target) clearTimeout(target.timer);
      return current.filter((entry) => entry.id !== id);
    });
  }, []);

  const addUndo = useCallback((message: string, undo: () => void, timeoutMs = 10000) => {
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
    const timer = setTimeout(() => {
      setEntries((current) => current.filter((entry) => entry.id !== id));
    }, timeoutMs);
    const next: UndoEntry = { id, message, undo, timer };
    setEntries((current) => [next, ...current].slice(0, 4));
  }, []);

  const handleUndo = useCallback((id: string) => {
    const match = entriesRef.current.find((entry) => entry.id === id);
    if (!match) return;
    clearTimeout(match.timer);
    setEntries((current) => current.filter((entry) => entry.id !== id));
    match.undo();
  }, []);

  const value = useMemo(() => ({ addUndo }), [addUndo]);

  return (
    <UndoContext.Provider value={value}>
      {children}
      <div className="undo-toast-stack" aria-live="polite" aria-atomic="false">
        {entries.map((entry) => (
          <div key={entry.id} className="undo-toast">
            <span>{entry.message}</span>
            <button type="button" className="undo-toast-button" onClick={() => handleUndo(entry.id)}>
              Undo
            </button>
            <button
              type="button"
              className="undo-toast-dismiss"
              aria-label="Dismiss undo"
              onClick={() => removeEntry(entry.id)}
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </UndoContext.Provider>
  );
}

export function useUndo() {
  const context = useContext(UndoContext);
  if (!context) throw new Error("useUndo must be used within an UndoProvider");
  return context;
}
