import { useCallback, useEffect, useMemo, useState } from "react";
import { readGuideUrl } from "../persistence/guide";
import { whenIdle } from "./idle";
import { GuideService } from "../guide/service";
import { classify } from "../domain/privacy";
import type { GuideProgram } from "../providers/contracts";

// One guide. Programs that look 18+ stay out of it while 18+ is hidden.
export function useGuide(adult: boolean) {
  const [service] = useState(() => new GuideService());
  const [state, setState] = useState(service.snapshot);
  const [foreground, setForeground] = useState(
    () => document.visibilityState !== "hidden",
  );
  useEffect(() => service.subscribe(setState), [service]);
  // A remembered guide reconnects once the screen is usable.
  useEffect(() => {
    const url = readGuideUrl();
    if (!url) return;
    let canceled = false;
    void whenIdle().then(() => {
      if (!canceled) void service.connect(url).catch(() => {});
    });
    return () => {
      canceled = true;
    };
  }, [service]);
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
      service.cancel();
    };
  }, [service]);
  useEffect(() => {
    if (!foreground) {
      service.cancel();
      return;
    }
    const tick = () => {
      if (navigator.onLine !== false && document.visibilityState !== "hidden")
        void service.check();
    };
    tick();
    const timer = setInterval(tick, 60000);
    window.addEventListener("online", tick);
    return () => {
      clearInterval(timer);
      service.cancel();
      window.removeEventListener("online", tick);
    };
  }, [foreground, service]);
  const connect = useCallback(
    (url: string) => {
      if (!foreground || document.visibilityState === "hidden")
        return Promise.resolve();
      return service.connect(url);
    },
    [service, foreground],
  );
  const importGuide = useCallback(
    (programs: GuideProgram[]) => service.import(programs),
    [service],
  );
  const clear = useCallback(() => service.clear(), [service]);
  const refresh = useCallback(() => {
    if (foreground && document.visibilityState !== "hidden")
      void service.check(true);
  }, [service, foreground]);
  const general = useMemo(
    () =>
      state.programs.filter(
        (p) =>
          classify(`${p.title} ${p.description || ""}`, "general") ===
          "general",
      ),
    [state.programs],
  );
  return {
    state,
    displayState: state,
    programs: adult ? state.programs : general,
    connect,
    // The service's state right now, for a caller that awaited connect.
    current: () => service.snapshot,
    importGuide,
    clear,
    refresh,
  };
}
export type GuideConnection = ReturnType<typeof useGuide>;
