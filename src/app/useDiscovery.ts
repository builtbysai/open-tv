import { useEffect, useState } from "react";
import type { DiscoverList, Discovery, TmdbProvider } from "../providers/tmdb";
export type DiscoveryState = {
  status: "idle" | "loading" | "ready" | "rejected" | "unavailable";
  lists: Partial<Record<DiscoverList, Discovery[]>>;
};
const names: DiscoverList[] = [
  "trending",
  "popular",
  "top",
  "series",
  "topSeries",
];
const idle: DiscoveryState = { status: "idle", lists: {} };
export function useDiscovery(
  provider: TmdbProvider | null,
  enabled: boolean,
): DiscoveryState {
  const [state, setState] = useState<DiscoveryState>(idle);
  useEffect(() => {
    if (!provider || !enabled) {
      setState(idle);
      return;
    }
    const controller = new AbortController();
    setState({ status: "loading", lists: {} });
    Promise.allSettled(
      names.map((n) => provider.discover(n, controller.signal)),
    ).then((results) => {
      if (controller.signal.aborted) return;
      const lists: DiscoveryState["lists"] = {};
      results.forEach((r, i) => {
        if (r.status === "fulfilled") lists[names[i]] = r.value;
      });
      const rejected = results.some(
        (r) => r.status === "rejected" && r.reason?.message === "rejected",
      );
      setState({
        status: Object.keys(lists).length
          ? "ready"
          : rejected
            ? "rejected"
            : "unavailable",
        lists,
      });
    });
    return () => controller.abort();
  }, [provider, enabled]);
  return state;
}
