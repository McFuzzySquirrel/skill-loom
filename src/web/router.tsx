import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useSyncExternalStore,
  type AnchorHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';

/**
 * Minimal history-based router.
 *
 * The verified dependency set in PRD 6.1 does not pin a routing package, so the
 * shell keeps this small instead of adding an unverified dependency. It supports
 * push/replace navigation, back/forward, modified clicks, and exact segment
 * matching with `:param` placeholders.
 */

export interface NavigateOptions {
  replace?: boolean;
  /** Skip a registered unsaved-changes guard, e.g. after a successful save. */
  skipGuard?: boolean;
}

/**
 * Return false to cancel a pending navigation and keep the current location.
 * A guard is responsible for explaining why and for offering the next step.
 */
export type NavigationGuard = (to: string) => boolean;

export interface RouterValue {
  pathname: string;
  search: string;
  hash: string;
  navigate: (to: string, options?: NavigateOptions) => void;
  /** Register one screen's unsaved-changes guard; pass null to clear it. */
  setNavigationGuard: (guard: NavigationGuard | null) => void;
}

export interface RouteMatch {
  params: Record<string, string>;
}

const RouterContext = createContext<RouterValue | null>(null);

function locationKey(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function subscribeToHistory(onChange: () => void): () => void {
  window.addEventListener('popstate', onChange);
  window.addEventListener('hashchange', onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener('hashchange', onChange);
  };
}

function serverLocationKey(): string {
  return '/';
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const key = useSyncExternalStore(subscribeToHistory, locationKey, serverLocationKey);
  const guardRef = useRef<NavigationGuard | null>(null);
  const lastKeyRef = useRef(locationKey());

  const location = useMemo(() => {
    const url = new URL(key, window.location.origin);
    return { pathname: url.pathname, search: url.search, hash: url.hash };
  }, [key]);

  const setNavigationGuard = useCallback((guard: NavigationGuard | null) => {
    guardRef.current = guard;
  }, []);

  const navigate = useCallback((to: string, options: NavigateOptions = {}) => {
    const target = new URL(to, window.location.origin);
    const nextKey = `${target.pathname}${target.search}${target.hash}`;
    if (nextKey === locationKey()) {
      return;
    }

    if (
      options.skipGuard !== true &&
      guardRef.current !== null &&
      !guardRef.current(nextKey)
    ) {
      return;
    }

    if (options.replace === true) {
      window.history.replaceState(null, '', target);
    } else {
      window.history.pushState(null, '', target);
    }
    lastKeyRef.current = nextKey;
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);

  /**
   * Back and forward move the URL before React can render, so a dirty screen
   * must intercept the capture-phase event. A blocked entry restores the
   * previous URL and stops the store subscriber from publishing the new route.
   */
  useEffect(() => {
    const handlePopState = (event: PopStateEvent) => {
      const nextKey = locationKey();
      if (nextKey === lastKeyRef.current) {
        return;
      }

      const guard = guardRef.current;
      if (guard !== null && !guard(nextKey)) {
        window.history.pushState(null, '', lastKeyRef.current);
        event.stopImmediatePropagation();
        return;
      }

      lastKeyRef.current = nextKey;
    };

    window.addEventListener('popstate', handlePopState, true);
    return () => {
      window.removeEventListener('popstate', handlePopState, true);
    };
  }, []);

  const value = useMemo<RouterValue>(
    () => ({ ...location, navigate, setNavigationGuard }),
    [location, navigate, setNavigationGuard],
  );

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useRouter(): RouterValue {
  const router = useContext(RouterContext);
  if (router === null) {
    throw new Error('useRouter must be used inside a RouterProvider.');
  }
  return router;
}

export interface LinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  to: string;
  replace?: boolean;
}

/**
 * Client-side link that keeps real anchor semantics so keyboard activation,
 * middle-click, and open-in-new-tab continue to work.
 */
export function Link({ to, replace = false, onClick, ...rest }: LinkProps) {
  const { navigate } = useRouter();

  const handleClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      rest.target !== undefined
    ) {
      return;
    }
    event.preventDefault();
    navigate(to, { replace });
  };

  return <a {...rest} href={to} onClick={handleClick} />;
}

/** Replace the current history entry with another route. */
export function Redirect({ to }: { to: string }) {
  const { navigate } = useRouter();

  useEffect(() => {
    navigate(to, { replace: true });
  }, [navigate, to]);

  return null;
}

function splitPath(value: string): string[] {
  return value.split('/').filter((segment) => segment !== '');
}

/**
 * Match one route pattern against a pathname. Patterns are exact; `:name`
 * segments become decoded params. A trailing slash is ignored.
 */
export function matchRoute(pattern: string, pathname: string): RouteMatch | null {
  if (pattern === '/') {
    return splitPath(pathname).length === 0 ? { params: {} } : null;
  }

  const patternSegments = splitPath(pattern);
  const pathSegments = splitPath(pathname);
  if (patternSegments.length !== pathSegments.length) {
    return null;
  }

  const params: Record<string, string> = {};
  for (let index = 0; index < patternSegments.length; index += 1) {
    const patternSegment = patternSegments[index]!;
    const pathSegment = pathSegments[index]!;

    if (patternSegment.startsWith(':')) {
      try {
        params[patternSegment.slice(1)] = decodeURIComponent(pathSegment);
      } catch {
        params[patternSegment.slice(1)] = pathSegment;
      }
      continue;
    }

    if (patternSegment !== pathSegment) {
      return null;
    }
  }

  return { params };
}
