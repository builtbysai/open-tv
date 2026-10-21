import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import { seekBy, seekStep, seekWindow } from "../../playback/seek";

// Remote seeking: each press moves a target that is shown at once, and the video jumps
// there after a short pause, so a run of presses (or a held key) costs one seek.
export function useSeekPreview(
  video: RefObject<HTMLVideoElement | null>,
  delay = 700,
) {
  const [preview, setPreview] = useState<number | null>(null);
  const target = useRef<number | null>(null);
  const heldSince = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const commit = useCallback(() => {
    clearTimeout(timer.current);
    const element = video.current,
      to = target.current;
    target.current = null;
    setPreview(null);
    if (element && to !== null) seekBy(element, to - element.currentTime);
  }, [video]);
  const nudge = useCallback(
    (seconds: number, repeat = false) => {
      const element = video.current;
      const window = element && seekWindow(element);
      if (!element || !window) return false;
      const now = performance.now();
      if (!repeat || !heldSince.current) heldSince.current = now;
      const step =
        seekStep(Math.abs(seconds), now - heldSince.current) *
        Math.sign(seconds);
      const from = target.current ?? element.currentTime;
      target.current = Math.max(
        window.start,
        Math.min(window.end, from + step),
      );
      setPreview(target.current);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        heldSince.current = 0;
        commit();
      }, delay);
      return true;
    },
    [video, delay, commit],
  );
  useEffect(() => () => clearTimeout(timer.current), []);
  return { preview, nudge, commit };
}
