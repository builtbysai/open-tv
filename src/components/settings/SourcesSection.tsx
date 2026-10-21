import { useState } from "react";
import { Plus, RefreshCw, Download, ExternalLink, Check } from "lucide-react";
import { persistableUrl } from "../../domain/urls";
import { exportJson } from "../../persistence/export";
import { canPersistServer } from "../../domain/servers";
import type { Source } from "../../domain/content";
import { sources as builtIn } from "../../providers/registry";
import type { SettingsProps } from "./types";
import { RemoveSource } from "./RemoveSource";
export function SourcesSection({
  servers,
  sources,
  status,
  onSource,
  onReclassify,
  onRemoveSource,
  adult,
}: Pick<
  SettingsProps,
  | "servers"
  | "sources"
  | "status"
  | "onSource"
  | "onReclassify"
  | "onRemoveSource"
  | "adult"
>) {
  const [showAvailable, setShowAvailable] = useState(false);
  const shown = sources.filter(
    (s) =>
      (s.classification === "general" || adult) &&
      (showAvailable ||
        s.enabled ||
        !/^(iptv|radio|archive|nasa|community)-/.test(s.id)),
  );
  // Parts of one big list (an extension split into regions) show as a single entry.
  const groups = new Map<string, Source[]>();
  for (const source of shown) {
    const match = source.extension ? /^(.*)-\d+$/.exec(source.id) : null;
    if (match) groups.set(match[1], [...(groups.get(match[1]) ?? []), source]);
  }
  const listed: (Source | { key: string; name: string; parts: Source[] })[] =
    [];
  const placed = new Set<string>();
  for (const source of shown) {
    const match = source.extension ? /^(.*)-\d+$/.exec(source.id) : null;
    const parts = match ? groups.get(match[1]) : undefined;
    if (match && parts && parts.length > 1) {
      if (placed.has(match[1])) continue;
      placed.add(match[1]);
      const name = parts[0].name.includes(" · ")
        ? parts[0].name.slice(0, parts[0].name.lastIndexOf(" · "))
        : parts[0].name;
      listed.push({ key: match[1], name, parts });
    } else listed.push(source);
  }
  const row = (source: Source) => (
    <div className="source-row" key={source.id}>
      <div className={`source-mark ${source.enabled ? "enabled" : ""}`}>
        {source.enabled ? <Check size={18} /> : <Plus size={18} />}
      </div>
      <div className="source-copy">
        <h3>{source.name}</h3>
        <details className="source-details">
          <summary tabIndex={0}>Details</summary>
          <p>{source.description}</p>
        </details>
        <span
          className={
            status[source.id]?.startsWith("Error")
              ? "source-error"
              : "source-status"
          }
        >
          {status[source.id] ||
            (source.enabled ? "Ready to sync" : "Not connected")}
        </span>
      </div>
      <div className="source-controls">
        {source.provenance && (
          <a
            className="icon-button"
            href={source.provenance}
            target="_blank"
            rel="noreferrer"
            aria-label={`About ${source.name}`}
          >
            <ExternalLink size={16} />
          </a>
        )}
        {adult &&
          source.classification === "general" &&
          source.kind === "m3u" &&
          !source.extension &&
          !builtIn.some((d) => d.id === source.id) && (
            <button
              className="button text small"
              onClick={() => onReclassify(source, "adult")}
            >
              Move to 18+
            </button>
          )}
        {source.enabled && source.kind !== "xtream" && (
          <button
            className="icon-button"
            aria-label={`Refresh ${source.name}`}
            onClick={() => onSource(source, true)}
          >
            <RefreshCw size={16} />
          </button>
        )}
        <button
          className="button secondary small"
          onClick={() =>
            source.kind === "xtream" && !source.enabled
              ? document
                  .querySelector<HTMLInputElement>("#account-connection input")
                  ?.focus()
              : onSource({ ...source, enabled: !source.enabled })
          }
        >
          {source.enabled
            ? "Disconnect"
            : source.kind === "xtream"
              ? "Sign in again"
              : "Connect"}
        </button>
        <RemoveSource source={source} onRemove={onRemoveSource} />
      </div>
    </div>
  );
  return (
    <section className="settings-section" id="settings-sources">
      <div className="section-title">
        <div>
          <h2>Sources</h2>
        </div>
        <button
          className="button secondary"
          onClick={() => {
            const allowed = sources.filter(
              (s) =>
                s.url &&
                persistableUrl(new URL(s.url, location.href).href) &&
                s.classification === "general" &&
                s.kind !== "xtream",
            );
            exportJson("open-tv-sources.json", {
              version: 1,
              sources: allowed,
              servers: servers.filter(canPersistServer),
            });
          }}
        >
          <Download size={16} />
          Export sources
        </button>
      </div>
      <p className="muted">
        Connect a source to browse its channels and titles.
      </p>
      <div className="source-list">
        {listed.map((entry) =>
          "parts" in entry ? (
            <div className="source-row source-group" key={entry.key}>
              <div
                className={`source-mark ${entry.parts.every((p) => p.enabled) ? "enabled" : ""}`}
              >
                {entry.parts.every((p) => p.enabled) ? (
                  <Check size={18} />
                ) : (
                  <Plus size={18} />
                )}
              </div>
              <div className="source-copy">
                <h3>{entry.name}</h3>
                <span className="source-status">
                  {entry.parts.filter((p) => p.enabled).length} of{" "}
                  {entry.parts.length} parts connected
                </span>
                <details className="source-details">
                  <summary tabIndex={0}>Parts</summary>
                  <div className="source-list nested">
                    {entry.parts.map((part) => row(part))}
                  </div>
                </details>
              </div>
              <div className="source-controls">
                <button
                  className="button secondary small"
                  onClick={() => {
                    const connect = !entry.parts.every((p) => p.enabled);
                    for (const part of entry.parts)
                      if (part.enabled !== connect)
                        onSource({ ...part, enabled: connect });
                  }}
                >
                  {entry.parts.every((p) => p.enabled)
                    ? "Disconnect all"
                    : "Connect all"}
                </button>
              </div>
            </div>
          ) : (
            row(entry)
          ),
        )}
      </div>
      <button
        className="button text source-expand"
        aria-expanded={showAvailable}
        onClick={() => setShowAvailable((value) => !value)}
      >
        {showAvailable ? "Show fewer sources" : "Browse more sources"}
      </button>
    </section>
  );
}
