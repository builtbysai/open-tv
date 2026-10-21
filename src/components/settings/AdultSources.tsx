import type { SettingsProps } from "./types";
import { RemoveSource } from "./RemoveSource";
// 18+ lists come from an extension file. Their names stay out of sight until 18+ content
// is shown.
export function AdultSources({
  adult,
  sources,
  status,
  onSource,
  onReclassify,
  onRemoveSource,
}: Pick<
  SettingsProps,
  | "adult"
  | "sources"
  | "status"
  | "onSource"
  | "onReclassify"
  | "onRemoveSource"
>) {
  if (!adult)
    return (
      <section className="settings-section" id="settings-adult-sources">
        <h3>18+ playlists</h3>
        <p className="muted">
          18+ lists come from an extension file (Extension, above). They are
          listed here, and can be connected, once you show 18+ content.
        </p>
      </section>
    );
  const listed = sources.filter((s) => s.classification !== "general");
  return (
    <section className="settings-section" id="settings-adult-sources">
      <h3>18+ playlists</h3>
      <p className="muted">
        Connect the ones you want. They are remembered like any other source and
        stay out of sight while 18+ content is hidden.
      </p>
      {!listed.length && (
        <p className="muted">
          No 18+ lists yet. Import an extension file that includes them.
        </p>
      )}
      <div className="source-list">
        {listed.map((source) => (
          <div className="source-row" key={source.id}>
            <div className="source-copy">
              <h3>{source.name}</h3>
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
              {!source.extension && (
                <button
                  className="button text small"
                  onClick={() => onReclassify(source, "general")}
                >
                  Move to General
                </button>
              )}
              <button
                className="button secondary small"
                onClick={() =>
                  onSource({ ...source, enabled: !source.enabled })
                }
              >
                {source.enabled ? "Disconnect" : "Connect"}
              </button>
              <RemoveSource source={source} onRemove={onRemoveSource} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
