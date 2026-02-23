import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useAuth } from "@/hooks/useAuth";

const STORAGE_KEY_PREFIX = "epermit:selectedProjectId";

type SelectedProjectContextValue = {
  selectedProjectId: string | null;
  setSelectedProjectId: (id: string | null) => void;
};

const SelectedProjectContext = createContext<SelectedProjectContextValue | null>(null);

function getStorageKey(userId: string) {
  return `${STORAGE_KEY_PREFIX}:${userId}`;
}

export function SelectedProjectProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [selectedProjectId, setState] = useState<string | null>(null);

  // Restore selection only from localStorage. Never auto-select first project or derive from projects list.
  useEffect(() => {
    if (!user) {
      setState(null);
      return;
    }
    try {
      const raw = localStorage.getItem(getStorageKey(user.id));
      const value = raw === "" || raw === "null" ? null : raw;
      setState(value);
    } catch {
      setState(null);
    }
  }, [user?.id]);

  const setSelectedProjectId = useCallback(
    (id: string | null) => {
      setState(id);
      if (user) {
        try {
          if (id == null) {
            localStorage.removeItem(getStorageKey(user.id));
          } else {
            localStorage.setItem(getStorageKey(user.id), id);
          }
        } catch {
          // ignore
        }
      }
    },
    [user?.id]
  );

  const value = useMemo(
    () => ({ selectedProjectId, setSelectedProjectId }),
    [selectedProjectId, setSelectedProjectId]
  );

  return (
    <SelectedProjectContext.Provider value={value}>
      {children}
    </SelectedProjectContext.Provider>
  );
}

export function useSelectedProject(): SelectedProjectContextValue {
  const ctx = useContext(SelectedProjectContext);
  if (ctx == null) {
    throw new Error("useSelectedProject must be used within SelectedProjectProvider");
  }
  return ctx;
}

/** Safe version for use in components that may render outside the provider (e.g. sidebar on public layout). */
export function useSelectedProjectOptional(): SelectedProjectContextValue | null {
  return useContext(SelectedProjectContext);
}
