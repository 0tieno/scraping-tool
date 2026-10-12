import { useCallback, useEffect, useRef, useState } from "react";

/** Minimal hash router: "#/opportunity/abc" → ["opportunity", "abc"]. Hash routing keeps the server SPA-agnostic. */
export function useRoute(): string[] {
  const parse = () => window.location.hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const onChange = () => setRoute(parse());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export const navigate = (path: string) => {
  window.location.hash = path.startsWith("/") ? path : `/${path}`;
};

export interface AsyncState<T> {
  data: T | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

/** Runs an async loader whenever deps change; ignores stale responses from superseded requests. */
export function useAsync<T>(loader: () => Promise<T>, deps: unknown[]): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);

  useEffect(() => {
    const current = ++seq.current;
    setLoading(true);
    loader()
      .then((d) => {
        if (current !== seq.current) return;
        setData(d);
        setError(null);
      })
      .catch((e: Error) => current === seq.current && setError(e))
      .finally(() => current === seq.current && setLoading(false));
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, error, loading, reload };
}

export function useDebounced<T>(value: T, ms = 300): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

export function useInterval(fn: () => void, ms: number | null): void {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    if (ms === null) return;
    const id = setInterval(() => saved.current(), ms);
    return () => clearInterval(id);
  }, [ms]);
}
