// What happened to playback and why, for the Diagnostics view: who paused (the viewer, the
// TV app, the system), audio focus and lifecycle changes, and audio track choices. Memory
// only, no titles or addresses.
export interface MediaLogEntry {
  at: number;
  source: "player" | "host" | "system" | "page" | "audio";
  event: string;
}
const entries: MediaLogEntry[] = [];
const listeners = new Set<() => void>();
export function logMedia(source: MediaLogEntry["source"], event: string) {
  entries.push({ at: Date.now(), source, event: event.slice(0, 200) });
  if (entries.length > 60) entries.shift();
  for (const listener of listeners) listener();
}
export function mediaLog(): MediaLogEntry[] {
  return [...entries];
}
export function onMediaLog(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
