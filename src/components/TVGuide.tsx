import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Clock, Play, Upload, X } from "lucide-react";
import type { Content } from "../domain/content";
import type { GuideProgram } from "../providers/contracts";
import { guideStatusText, type GuideSnapshot } from "../guide/service";
import {
  GUIDE_HOUR,
  guideSegments,
  guideWindow,
  indexGuide,
} from "../domain/guide";
function ProgramDetails({
  channel,
  program,
  onClose,
  play,
}: {
  channel: Content;
  program: GuideProgram;
  onClose(): void;
  play(item: Content): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  const time = new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  return (
    <dialog
      ref={ref}
      className="detail-dialog program-dialog"
      onCancel={onClose}
      aria-labelledby="program-title"
    >
      <div className="detail-content">
        <button
          className="icon-button detail-close"
          onClick={onClose}
          aria-label="Close program"
        >
          <X />
        </button>
        <p className="eyebrow">{channel.title}</p>
        <h2 id="program-title">{program.title}</h2>
        <p className="muted">
          {time.format(program.start)} – {time.format(program.end)}
        </p>
        {program.description && (
          <p className="description">{program.description}</p>
        )}
        <button
          className="button primary"
          onClick={() => {
            onClose();
            play(channel);
          }}
        >
          <Play size={17} fill="currentColor" />
          Watch channel live
        </button>
      </div>
    </dialog>
  );
}
export function TVGuide({
  channels,
  programs,
  status,
  play,
  onImport,
}: {
  channels: Content[];
  programs: GuideProgram[];
  status: Pick<GuideSnapshot, "status" | "source" | "loadedAt" | "reason">;
  play(item: Content): void;
  // Absent for a Kids profile, which has no Settings.
  onImport?(): void;
}) {
  const [now, setNow] = useState(Date.now),
    [offset, setOffset] = useState(0),
    [selected, setSelected] = useState<{
      channel: Content;
      program: GuideProgram;
    } | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const index = useMemo(() => indexGuide(programs), [programs]);
  const window = guideWindow(now, offset);
  const ticks = Array.from(
    { length: 6 },
    (_, i) => window.start + (i * GUIDE_HOUR) / 2,
  );
  const time = new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const marker = ((now - window.start) / (window.end - window.start)) * 100;
  const matching = channels.some((c) => c.epgId && index.has(c.epgId));
  return (
    <section className="tv-guide" aria-label="TV schedule">
      <div className="guide-toolbar">
        <div>
          <p className="eyebrow">
            {new Intl.DateTimeFormat(undefined, {
              weekday: "long",
              month: "short",
              day: "numeric",
            }).format(window.start)}
          </p>
          <span className="guide-timezone">
            <Clock size={13} />
            {zone} · 3-hour view
          </span>
        </div>
        <div className="actions">
          <button
            className="icon-button"
            aria-label="Earlier programs"
            onClick={() => setOffset((value) => Math.max(-8, value - 1))}
            disabled={offset <= -8}
          >
            <ArrowLeft size={17} />
          </button>
          <button
            className="button text"
            onClick={() => {
              setOffset(0);
              setNow(Date.now());
            }}
          >
            Jump to now
          </button>
          <button
            className="icon-button"
            aria-label="Later programs"
            onClick={() => setOffset((value) => Math.min(8, value + 1))}
            disabled={offset >= 8}
          >
            <ArrowRight size={17} />
          </button>
        </div>
      </div>
      {status.source !== "none" && (
        <div className="guide-source-status">
          <p role="status">{guideStatusText(status)}</p>
          {onImport && (
            <button className="button text" onClick={onImport}>
              Manage guide
            </button>
          )}
        </div>
      )}
      {!matching && (
        <div className="guide-empty">
          <p>
            {programs.length
              ? "No schedules match these channels."
              : onImport
                ? "Import a guide to see what’s on."
                : "Ask a grown-up to add a TV guide from the main profile."}
          </p>
          {onImport && (
            <button className="button text" onClick={onImport}>
              <Upload size={15} />
              Import an XMLTV guide in Settings
            </button>
          )}
        </div>
      )}
      <div
        className="guide-scroller"
        tabIndex={0}
        aria-label="Scrollable program timeline"
      >
        <div className="timeline-grid">
          <div className="timeline-heading">
            <span className="timeline-channel">Channel</span>
            <div className="timeline-axis">
              {ticks.map((tick, index) => (
                <span key={tick} style={{ left: `${(index / 6) * 100}%` }}>
                  {time.format(tick)}
                </span>
              ))}
              {marker >= 0 && marker <= 100 && (
                <i className="now-pin" style={{ left: `${marker}%` }}>
                  Now
                </i>
              )}
            </div>
          </div>
          {channels.map((channel) => {
            const segments = guideSegments(
              index,
              channel.epgId || "",
              window.start,
              window.end,
            );
            return (
              <div className="timeline-row" key={channel.id}>
                <button
                  className="timeline-channel"
                  onClick={() => play(channel)}
                  aria-label={`Watch ${channel.title} live`}
                >
                  <span className="live-dot" />
                  <strong>{channel.title}</strong>
                </button>
                <div
                  className="timeline-track"
                  role="group"
                  aria-label={`${channel.title} programming`}
                >
                  {!segments.length && (
                    <span className="timeline-unavailable">
                      Program information unavailable
                    </span>
                  )}
                  {segments.map(({ program, left, width }, i) => (
                    <button
                      key={`${program.start}:${i}`}
                      className={`timeline-program ${program.start <= now && program.end > now ? "on-now" : ""}`}
                      style={{ left: `${left}%`, width: `${width}%` }}
                      onClick={() => setSelected({ channel, program })}
                      title={`${program.title} · ${time.format(program.start)} – ${time.format(program.end)}`}
                    >
                      <strong>{program.title}</strong>
                      <span>
                        {time.format(program.start)} –{" "}
                        {time.format(program.end)}
                      </span>
                    </button>
                  ))}
                  {marker >= 0 && marker <= 100 && (
                    <span
                      className="now-line"
                      style={{ left: `${marker}%` }}
                      aria-hidden="true"
                    />
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <p className="fine-print guide-note">
        Times come from your guide. Select a program for details or a channel to
        watch.
      </p>
      {selected && (
        <ProgramDetails
          {...selected}
          onClose={() => setSelected(null)}
          play={play}
        />
      )}
    </section>
  );
}
