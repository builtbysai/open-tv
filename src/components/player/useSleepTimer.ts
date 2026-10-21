import { useCallback, useEffect, useRef, useState } from "react";

export const SLEEP_PRESETS = [15, 30, 60, 90] as const;
// One deadline is the only truth: the label, the panel and the timeout all read it, so
// cancelling clears everything at once.
export function useSleepTimer(onExpire: () => void) {
  const [endsAt, setEndsAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const expire = useRef(onExpire);
  expire.current = onExpire;
  useEffect(() => {
    if (!endsAt) return;
    setNow(Date.now());
    const wait = Math.max(0, endsAt - Date.now());
    const timeout = setTimeout(() => {
      setEndsAt(0);
      expire.current();
    }, wait);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearTimeout(timeout);
      clearInterval(tick);
    };
  }, [endsAt]);
  const set = useCallback((minutes: number) => {
    const start = Date.now();
    setNow(start);
    setEndsAt(start + minutes * 60000);
  }, []);
  const cancel = useCallback(() => setEndsAt(0), []);
  const left = endsAt ? Math.max(0, endsAt - now) : 0;
  const seconds = Math.ceil(left / 1000);
  const label = !endsAt
    ? ""
    : seconds >= 90
      ? `${Math.ceil(seconds / 60)} min`
      : `${seconds} s`;
  return { active: endsAt > 0, label, set, cancel };
}
export type SleepTimer = ReturnType<typeof useSleepTimer>;
