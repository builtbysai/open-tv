import { useLayoutEffect, useRef, type RefObject } from "react";
import type { Route } from "../persistence/user-state";
// A content resize, not a fixed delay, finishes restoration after asynchronous catalogs render.
export function useScrollRestoration(
  container: RefObject<HTMLElement | null>,
  content: RefObject<HTMLDivElement | null>,
  route: Route,
  saved: number,
  onSave: (value: number) => void,
  position: RefObject<number>,
  contentKey: string,
) {
  const callback = useRef(onSave),
    savedRef = useRef(saved);
  callback.current = onSave;
  savedRef.current = saved;
  useLayoutEffect(() => {
    const element = container.current,
      body = content.current;
    if (!element || !body) return;
    const target = savedRef.current;
    position.current = target;
    let restoring = true,
      frame = 0,
      timer: ReturnType<typeof setTimeout> | undefined;
    const apply = () => {
      if (!restoring) return;
      element.scrollTop = Math.min(
        target,
        Math.max(0, element.scrollHeight - element.clientHeight),
      );
      if (element.scrollHeight - element.clientHeight >= target - 1) {
        restoring = false;
        position.current = element.scrollTop;
      }
    };
    const restore = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(apply);
    };
    const observer = new ResizeObserver(restore);
    observer.observe(body);
    restore();
    const cancel = () => {
      restoring = false;
      position.current = element.scrollTop;
    };
    const keyboard = (event: KeyboardEvent) => {
      if (
        [
          "ArrowDown",
          "ArrowUp",
          "PageDown",
          "PageUp",
          "Home",
          "End",
          " ",
        ].includes(event.key)
      )
        cancel();
    };
    const scroll = () => {
      if (restoring) return;
      position.current = element.scrollTop;
      if (timer) return;
      timer = setTimeout(() => {
        timer = undefined;
        callback.current(position.current);
      }, 150);
    };
    const settle = setTimeout(() => {
      if (restoring) {
        restoring = false;
        position.current = element.scrollTop;
      }
    }, 15000);
    element.addEventListener("wheel", cancel, { passive: true });
    element.addEventListener("touchstart", cancel, { passive: true });
    element.addEventListener("pointerdown", cancel);
    element.addEventListener("keydown", keyboard);
    element.addEventListener("scroll", scroll, { passive: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      clearTimeout(settle);
      clearTimeout(timer);
      element.removeEventListener("wheel", cancel);
      element.removeEventListener("touchstart", cancel);
      element.removeEventListener("pointerdown", cancel);
      element.removeEventListener("keydown", keyboard);
      element.removeEventListener("scroll", scroll);
    };
  }, [container, content, route, position, contentKey]);
  return position;
}
