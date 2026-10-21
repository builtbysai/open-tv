import { useEffect, useState } from "react";
import { Play } from "lucide-react";
import type { Content, Stream } from "../domain/content";
import { probeUrl, type Presence } from "../domain/embed-library";
// A server with no saved name is shown by its address.
const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return "Server";
  }
};
const labels: Record<Presence | "checking", string> = {
  checking: "Checking…",
  available: "Responding",
  missing: "Not on this server",
  unknown: "Can’t be checked from here",
};
// Every server that has this title, whether it answers right now, and a way to play
// from a specific one. Servers that answer are listed first.
export function ServerSources({
  item,
  onPlay,
}: {
  item: Content;
  onPlay(item: Content): void;
}) {
  const servers = item.streams.filter((s) => s.format === "embed");
  const [state, setState] = useState<Record<string, Presence | "checking">>({});
  useEffect(() => {
    const controller = new AbortController();
    setState(Object.fromEntries(servers.map((s) => [s.url, "checking"])));
    for (const stream of servers)
      void probeUrl(stream.url, controller.signal).then((result) => {
        if (!controller.signal.aborted)
          setState((old) => ({ ...old, [stream.url]: result }));
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, servers.length]);
  if (servers.length === 0) return null;
  const rank = (s: Stream) =>
    ({ available: 0, checking: 1, unknown: 2, missing: 3 })[
      state[s.url] || "checking"
    ];
  const ordered = [...servers].sort((a, b) => rank(a) - rank(b));
  return (
    <section className="server-sources" aria-label="Servers with this title">
      <h3>Servers</h3>
      <ul>
        {ordered.map((stream) => (
          <li key={stream.url}>
            <span>
              {stream.quality || hostOf(stream.url)} ·{" "}
              <em className={`presence ${state[stream.url] || "checking"}`}>
                {labels[state[stream.url] || "checking"]}
              </em>
            </span>
            <button
              className="button text"
              onClick={() =>
                onPlay({
                  ...item,
                  streams: [
                    stream,
                    ...item.streams.filter((s) => s.url !== stream.url),
                  ],
                })
              }
            >
              <Play size={14} /> Play from here
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
