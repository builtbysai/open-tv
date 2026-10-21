// A public publish/subscribe relay carries only encrypted, short-lived chunks.
export const PAIR_RELAY = "https://ntfy.sh";
const PREFIX = "OTV1";
const CHUNK = 3000;
export const pairTopic = (room: string) => `opentv-${room}`;
export function splitMessage(id: string, payload: string): string[] {
  const parts: string[] = [];
  for (let i = 0; i < payload.length; i += CHUNK)
    parts.push(payload.slice(i, i + CHUNK));
  return parts.map((part, i) => `${PREFIX}.${id}.${i}.${parts.length}.${part}`);
}
export interface Chunk {
  id: string;
  index: number;
  total: number;
  data: string;
}
export function parseChunk(message: string): Chunk | null {
  const match =
    /^OTV1\.([A-Za-z0-9_-]{4,16})\.(\d{1,3})\.(\d{1,3})\.([A-Za-z0-9_-]+)$/.exec(
      message,
    );
  if (!match) return null;
  const index = Number(match[2]),
    total = Number(match[3]);
  return total >= 1 && total <= 40 && index < total
    ? { id: match[1], index, total, data: match[4] }
    : null;
}
// Collects chunks per transfer and returns the joined payload once complete.
export class Assembler {
  private parts = new Map<string, Map<number, string>>();
  add(chunk: Chunk): { id: string; payload: string } | null {
    const entry = this.parts.get(chunk.id) ?? new Map<number, string>();
    this.parts.set(chunk.id, entry);
    entry.set(chunk.index, chunk.data);
    if (entry.size < chunk.total) return null;
    this.parts.delete(chunk.id);
    return {
      id: chunk.id,
      payload: Array.from(
        { length: chunk.total },
        (_, i) => entry.get(i) ?? "",
      ).join(""),
    };
  }
}
export async function publish(
  room: string,
  messages: string[],
  signal?: AbortSignal,
  relay = defaultRelay(),
) {
  for (const message of messages) {
    const response = await fetch(`${relay}/${pairTopic(room)}`, {
      method: "POST",
      body: message,
      signal,
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error("relay");
  }
}
export const defaultRelay = () =>
  (import.meta.env?.VITE_PAIR_RELAY as string | undefined) || PAIR_RELAY;
// One long-lived request, as the relay recommends; it resolves when the stream ends.
export async function subscribe(
  room: string,
  since: string,
  onMessage: (id: string, message: string) => void,
  signal: AbortSignal,
  relay = defaultRelay(),
): Promise<void> {
  const response = await fetch(
    `${relay}/${pairTopic(room)}/json?since=${encodeURIComponent(since)}`,
    { signal, credentials: "omit", referrerPolicy: "no-referrer" },
  );
  if (!response.ok || !response.body) throw new Error("relay");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let newline = buffer.indexOf("\n");
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      newline = buffer.indexOf("\n");
      if (!line) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.event === "message" && typeof entry.message === "string")
          onMessage(String(entry.id), entry.message);
      } catch {
        /* Ignore malformed lines. */
      }
    }
    if (buffer.length > 100_000) throw new Error("relay");
  }
}
