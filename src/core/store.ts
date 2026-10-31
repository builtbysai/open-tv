import { signal, type Signal } from "@preact/signals";

// A signal that survives a restart. Reads are validated, writes tolerate disabled or full
// storage, and a malformed value falls back instead of breaking the app.
export function persisted<T>(
  key: string,
  fallback: T,
  validate: (value: unknown) => T | null = (v) => v as T,
): Signal<T> {
  let initial = fallback;
  try {
    const raw = localStorage.getItem(key);
    if (raw !== null) {
      const checked = validate(JSON.parse(raw));
      if (checked !== null) initial = checked;
    }
  } catch {
    /* Corrupt or unavailable: start from the fallback. */
  }
  const s = signal(initial);
  let timer: ReturnType<typeof setTimeout> | undefined;
  s.subscribe((value) => {
    // Coalesce bursts (progress ticks) into one write.
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* Quota or disabled storage: keep running in memory. */
      }
    }, 250);
  });
  return s;
}

export function readJson<T>(key: string, validate: (v: unknown) => T | null): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? null : validate(JSON.parse(raw));
  } catch {
    return null;
  }
}
export function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* Quota or disabled storage. */
  }
}
export function removeKey(key: string) {
  try {
    localStorage.removeItem(key);
  } catch {
    /* Storage can be disabled. */
  }
}
