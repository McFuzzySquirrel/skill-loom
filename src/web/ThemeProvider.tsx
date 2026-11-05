import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type AppearanceChoice = 'system' | 'light' | 'dark';
export type ResolvedAppearance = Exclude<AppearanceChoice, 'system'>;

interface AppearanceContextValue {
  choice: AppearanceChoice;
  resolved: ResolvedAppearance;
  persistenceError: boolean;
  setChoice: (choice: AppearanceChoice) => void;
}

const STORAGE_KEY = 'skill-loom.appearance';
const AppearanceContext = createContext<AppearanceContextValue | null>(null);

function isAppearanceChoice(value: string | null): value is AppearanceChoice {
  return value === 'system' || value === 'light' || value === 'dark';
}

function readChoice(): AppearanceChoice {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isAppearanceChoice(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function systemAppearance(): ResolvedAppearance {
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<AppearanceChoice>(readChoice);
  const [system, setSystem] = useState<ResolvedAppearance>(systemAppearance);
  const [persistenceError, setPersistenceError] = useState(false);
  const resolved = choice === 'system' ? system : choice;

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: light)');
    const handleChange = (event: MediaQueryListEvent) => {
      setSystem(event.matches ? 'light' : 'dark');
    };
    media.addEventListener('change', handleChange);
    return () => media.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;
  }, [resolved]);

  const setChoice = useCallback((next: AppearanceChoice) => {
    setChoiceState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
      setPersistenceError(false);
    } catch {
      setPersistenceError(true);
    }
  }, []);

  const value = useMemo(
    () => ({ choice, resolved, persistenceError, setChoice }),
    [choice, persistenceError, resolved, setChoice],
  );

  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export function useAppearance(): AppearanceContextValue {
  const appearance = useContext(AppearanceContext);
  if (appearance === null) {
    throw new Error('useAppearance must be used inside a ThemeProvider.');
  }
  return appearance;
}
