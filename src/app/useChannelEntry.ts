import { useEffect, useRef, useState } from "react";
import type { Content } from "../domain/content";
// TV remote number keys: type a channel number to jump to it, or press 0 on its own to
// return to the previous channel. Numbers follow the order of the channel list.
export function useChannelEntry(
  active: boolean,
  channels: Content[],
  currentId: string | undefined,
  onPlay: (item: Content) => void,
) {
  const [entry, setEntry] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined),
    previous = useRef<string | undefined>(undefined),
    current = useRef<string | undefined>(currentId);
  if (current.current !== currentId) {
    previous.current = current.current;
    current.current = currentId;
  }
  const latest = useRef({ channels, onPlay });
  latest.current = { channels, onPlay };
  useEffect(() => {
    if (!active) return;
    const key = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.altKey ||
        !/^[0-9]$/.test(event.key) ||
        target?.closest("input, textarea, select")
      )
        return;
      event.preventDefault();
      setEntry((old) => {
        if (event.key === "0" && !old) {
          const back = latest.current.channels.find(
            (c) => c.id === previous.current,
          );
          if (back) latest.current.onPlay(back);
          return "";
        }
        const next = (old + event.key).slice(0, 4);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => {
          const channel = latest.current.channels[Number(next) - 1];
          if (channel) latest.current.onPlay(channel);
          setEntry("");
        }, 1500);
        return next;
      });
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      clearTimeout(timer.current);
      setEntry("");
    };
  }, [active]);
  return entry;
}
