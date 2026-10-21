import { useEffect, useState } from "react";
import { mediaLog, onMediaLog } from "../playback/media-log";
// Recent playback events in one glance: who paused, lifecycle and audio-track choices.
export function PlaybackLog() {
  const [entries, setEntries] = useState(mediaLog);
  useEffect(() => onMediaLog(() => setEntries(mediaLog())), []);
  return (
    <section className="settings-section" id="settings-playback-log">
      <h2>Playback log</h2>
      <p className="muted">
        What happened to playback this session and why. Quote it when sound or
        pausing misbehaves.
      </p>
      {entries.length ? (
        <ol className="playback-log" aria-label="Playback log" tabIndex={0}>
          {entries
            .slice()
            .reverse()
            .map((entry, index) => (
              <li key={`${entry.at}-${index}`}>
                <time>{new Date(entry.at).toLocaleTimeString()}</time>{" "}
                <strong>{entry.source}</strong> {entry.event}
              </li>
            ))}
        </ol>
      ) : (
        <p className="fine-print">Nothing yet. Play something first.</p>
      )}
    </section>
  );
}
