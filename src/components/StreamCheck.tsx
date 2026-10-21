import { useEffect, useRef, useState } from "react";
import { CircleCheck, ScanLine } from "lucide-react";
import { stableId, type Content } from "../domain/content";
import { sensitiveUrl } from "../domain/urls";
import {
  probeVideo,
  type VideoEvidence,
  type ProbeOptions,
} from "../playback/probe";
import { readVideoHealth, saveVideoHealth } from "../persistence/video-health";
import { routeLabels } from "../playback/route";

const messages: Record<VideoEvidence["status"], string> = {
  "video-confirmed": "Video frames decoded successfully",
  "audio-only": "Audio plays, but no video decoded",
  unconfirmed: "Video could not be confirmed within the time limit",
  blocked:
    "HTTP media needs an authorized HTTPS endpoint or configured HTTPS relay",
  unsupported: "This player can’t be checked",
  failed: "Sample failed. Network, region or codec issue.",
  aborted: "Check canceled",
};
export function StreamCheck({
  item,
  resolveUrl,
}: {
  item: Content;
  resolveUrl?: ProbeOptions["resolveUrl"];
}) {
  const [index, setIndex] = useState(0),
    [running, setRunning] = useState(false),
    [result, setResult] = useState<VideoEvidence>();
  const video = useRef<HTMLVideoElement>(null),
    active = useRef<AbortController | null>(null);
  const stream = item.streams[index];
  useEffect(() => {
    setResult(undefined);
    if (
      stream &&
      item.classification === "general" &&
      !sensitiveUrl(stream.url)
    ) {
      try {
        setResult(readVideoHealth(localStorage)[stableId(stream.url)]);
      } catch {
        /* Restricted storage. */
      }
    }
    return () => {
      active.current?.abort();
    };
  }, [stream, item.classification]);
  useEffect(() => {
    if (!running || !stream || !video.current) return;
    const controller = new AbortController();
    active.current = controller;
    void probeVideo(video.current, stream, {
      signal: controller.signal,
      resolveUrl,
    }).then((evidence) => {
      if (controller.signal.aborted) return;
      setResult(evidence);
      setRunning(false);
      if (item.classification === "general" && !sensitiveUrl(stream.url)) {
        try {
          saveVideoHealth(localStorage, stableId(stream.url), evidence);
        } catch {
          /* Optional diagnostics only. */
        }
      }
    });
    return () => {
      controller.abort();
      active.current = null;
    };
  }, [running, stream, item.classification, resolveUrl]);
  if (!stream) return null;
  return (
    <section className="stream-check" aria-label="Stream video check">
      <h3>
        <ScanLine size={18} /> Video check
      </h3>
      <p className="fine-print">Play a short muted sample to test video.</p>
      {item.streams.length > 1 && (
        <label>
          Stream alternative
          <select
            disabled={running}
            value={index}
            onChange={(e) => setIndex(Number(e.target.value))}
          >
            {item.streams.map((s, i) => (
              <option key={i} value={i}>
                Alternative {i + 1}
                {s.quality ? ` · ${s.quality}` : ""}
              </option>
            ))}
          </select>
        </label>
      )}
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
          disabled={running || stream.format === "embed"}
          onClick={() => setRunning(true)}
        >
          {running ? "Checking video…" : "Check video"}
        </button>
        {running && (
          <button
            className="button text"
            onClick={() => {
              active.current?.abort();
              setRunning(false);
            }}
          >
            Cancel check
          </button>
        )}
      </div>
      {result && (
        <p role="status" data-probe-status={result.status}>
          {result.status === "video-confirmed" && <CircleCheck size={16} />}{" "}
          {result.status === "blocked" && result.blocked
            ? result.blocked
            : messages[result.status]}
          {result.status === "video-confirmed" &&
            ` · ${result.width}×${result.height} · ${result.frames} frames`}
          {result.route && result.status !== "blocked" && (
            <span className="probe-route">
              {" "}
              · {routeLabels[result.route].toLowerCase()}
            </span>
          )}
          <span className="fine-print">
            {" "}
            · Checked {new Date(result.checkedAt).toLocaleString()} on this
            device
          </span>
        </p>
      )}
    </section>
  );
}
