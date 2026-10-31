import { useEffect, useRef, useState } from "preact/hooks";
import { TmdbError } from "../modules/movies/tmdb";

export interface Async<T> {
  value: T | null;
  loading: boolean;
  error: string;
  // "auth" when TMDB rejected the key: the screen offers Settings instead of Retry.
  kind: string;
  retry(): void;
}

// Loads something when `deps` change, cancels it when they change again or the screen goes.
export function useAsync<T>(load: (signal: AbortSignal) => Promise<T>, deps: unknown[]): Async<T> {
  const [state, setState] = useState<{ value: T | null; loading: boolean; error: string; kind: string }>({
    value: null,
    loading: true,
    error: "",
    kind: "",
  });
  const [tick, setTick] = useState(0);
  const loader = useRef(load);
  loader.current = load;
  useEffect(() => {
    const controller = new AbortController();
    setState((s) => ({ value: s.value, loading: true, error: "", kind: "" }));
    loader.current(controller.signal).then(
      (value) => {
        if (!controller.signal.aborted) setState({ value, loading: false, error: "", kind: "" });
      },
      (e: unknown) => {
        if (controller.signal.aborted) return;
        const kind = e instanceof TmdbError ? e.kind : "";
        setState({ value: null, loading: false, error: e instanceof Error ? e.message : "Something went wrong.", kind });
      },
    );
    return () => controller.abort();
  }, [...deps, tick]);
  return { ...state, retry: () => setTick((t) => t + 1) };
}
