import { useCallback, useEffect, useState } from "react";
import {
  bundledManifest,
  updateEndpoint,
  updateStorage,
} from "../config/updates";
import { CatalogUpdateService, UPDATE_STORAGE_KEY } from "../updates/service";
export function useCatalogUpdates() {
  const [service] = useState(
    () =>
      new CatalogUpdateService(
        updateEndpoint(),
        bundledManifest,
        updateStorage(),
      ),
  );
  const [state, setState] = useState(service.snapshot);
  const [foreground, setForeground] = useState(
    () => document.visibilityState !== "hidden",
  );
  useEffect(() => service.subscribe(setState), [service]);
  useEffect(() => {
    const suspend = () => {
      service.cancel();
      setForeground(false);
    };
    const resume = () => setForeground(document.visibilityState !== "hidden");
    const visibility = () =>
      document.visibilityState === "hidden" ? suspend() : resume();
    window.addEventListener("opentv:suspend", suspend);
    window.addEventListener("opentv:resume", resume);
    document.addEventListener("visibilitychange", visibility);
    return () => {
      window.removeEventListener("opentv:suspend", suspend);
      window.removeEventListener("opentv:resume", resume);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [service]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === UPDATE_STORAGE_KEY) service.restore();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [service]);
  useEffect(() => {
    if (!foreground) {
      service.cancel();
      return;
    }
    const tick = () => {
      if (document.visibilityState !== "hidden" && navigator.onLine !== false)
        void service.check();
      else service.cancel();
    };
    tick();
    const interval = setInterval(tick, 60000);
    window.addEventListener("online", tick);
    return () => {
      clearInterval(interval);
      service.cancel();
      window.removeEventListener("online", tick);
    };
  }, [service, foreground]);
  const refresh = useCallback(() => {
    if (foreground && document.visibilityState !== "hidden")
      void service.check(true);
  }, [service, foreground]);
  return {
    ...state,
    endpoint: service.endpoint,
    refresh,
    paused: !foreground,
  };
}
