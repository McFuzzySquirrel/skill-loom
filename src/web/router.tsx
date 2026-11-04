import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
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
}

export interface RouterValue {
  pathname: string;
  search: string;
  hash: string;
  navigate: (to: string, options?: NavigateOptions) => void;
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
  return () => {
    window.removeEventListener('popstate', onChange);
  };
}

function serverLocationKey(): string {
  return '/';
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const key = useSyncExternalStore(subscribeToHistory, locationKey, serverLocationKey);

  const location = useMemo(() => {
    const url = new URL(key, window.location.origin);
    return { pathname: url.pathname, search: url.search, hash: url.hash };
  }, [key]);

  const navigate = useCallback((to: string, options: NavigateOptions = {}) => {
    const target = new URL(to, window.location.origin);
    const nextKey = `${target.pathname}${target.search}${target.hash}`;
    if (nextKey === locationKey()) {
      return;
    }

    if (options.replace === true) {
      window.history.replaceState(null, '', target);
    } else {
      window.history.pushState(null, '', target);
    }
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, []);

  const value = useMemo<RouterValue>(
    () => ({ ...location, navigate }),
    [location, navigate],
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
