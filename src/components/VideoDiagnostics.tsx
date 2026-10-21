import { useEffect, useRef, useState } from "react";
import type { Content } from "../domain/content";
import { stableId } from "../domain/content";
import { videoSample } from "../domain/video-sample";
import { probeVideo, type VideoEvidence } from "../playback/probe";
import type { PlaybackResolver } from "../playback/transport";
import { readVideoHealth, saveVideoHealth } from "../persistence/video-health";
import { exportJson } from "../persistence/export";
export function VideoDiagnostics({
  items,
  resolveUrl,
}: {
  items: Content[];
  resolveUrl: PlaybackResolver;
}) {
  const video = useRef<HTMLVideoElement>(null),
    active = useRef<AbortController | null>(null);
  const [running, setRunning] = useState(false),
    [rows, setRows] = useState<
      { id: string; title: string; evidence: VideoEvidence }[]
    >([]),
    [message, setMessage] = useState("");
  useEffect(() => {
    const cancel = () => {
      active.current?.abort();
      setRunning(false);
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") cancel();
    };
    window.addEventListener("opentv:suspend", cancel);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      active.current?.abort();
      window.removeEventListener("opentv:suspend", cancel);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  const run = async () => {
    if (running || !video.current) return;
    let recent = {};
    try {
      recent = readVideoHealth(localStorage);
    } catch {
      /* No cache. */
    }
    const sample = videoSample(items, recent),
      controller = new AbortController();
    active.current = controller;
    setRows([]);
    setRunning(true);
    setMessage(
      sample.length
        ? "Checking one stream at a time…"
        : "Nothing new to check. Results last 24 hours.",
    );
    for (const entry of sample) {
      if (controller.signal.aborted) break;
      const evidence = await probeVideo(video.current, entry.stream, {
        signal: controller.signal,
        resolveUrl,
      });
      if (controller.signal.aborted) break;
      const id = stableId(entry.stream.url);
      setRows((old) => [...old, { id, title: entry.item.title, evidence }]);
      try {
        saveVideoHealth(localStorage, id, evidence);
      } catch {
        /* Disposable evidence. */
      }
    }
    if (controller.signal.aborted) return;
    active.current = null;
    setRunning(false);
    if (sample.length) setMessage("Sample complete.");
  };
  return (
    <section className="settings-section">
      <h2>Video checks</h2>
      <p className="muted">
        Test up to four public streams. Results last 24 hours.
      </p>
      <video
        ref={video}
        muted
        playsInline
        hidden={!running}
        className="probe-video"
      />
      <div className="actions">
        <button
          className="button secondary"
          disabled={running}
          onClick={() => void run()}
        >
          {running ? "Checking sample…" : "Check public stream sample"}
        </button>
        {running && (
          <button
            className="button text"
            onClick={() => {
              active.current?.abort();
              setRunning(false);
              setMessage("Check canceled.");
            }}
          >
            Cancel stream sample
          </button>
        )}
        <button
          className="button text"
          disabled={!rows.length}
          onClick={() =>
            exportJson("open-tv-video-health.json", {
              version: 1,
              method: "decoded-frame-sample",
              checkedAt: Date.now(),
              checks: Object.fromEntries(
                rows.map((row) => [row.id, row.evidence]),
              ),
            })
          }
        >
          Export check results
        </button>
      </div>
      {message && <p role="status">{message}</p>}
      {!!rows.length && (
        <ul className="video-check-results">
          {rows.map((row) => (
            <li key={row.id}>
              <strong>{row.title}</strong>
              <span>
                {row.evidence.status}
                {row.evidence.status === "video-confirmed"
                  ? ` · ${row.evidence.width}×${row.evidence.height}`
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="fine-print">
        Results reflect the moment of the check. Check private sources from
        their title.
      </p>
    </section>
  );
}
