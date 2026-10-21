import { useEffect, useState } from "react";
import {
  ArrowDown,
  ArrowUp,
  Check,
  Music2,
  Pencil,
  Plus,
  Trash2,
  Undo2,
} from "lucide-react";
import { serverAddress } from "../../domain/servers";
import {
  musicProviderLabels,
  musicProviderTypes,
  type MusicProvider,
  type MusicProviderType,
} from "../../music/types";
import { ago } from "../../persistence/servers";
import type { MusicState } from "../../app/useMusic";

const hints: Record<MusicProviderType, string> = {
  invidious:
    "The address of an Invidious instance, for example https://your-instance.example",
  piped:
    "The API address of a Piped instance (not its website), for example https://your-api.example",
  audius: "Audius, an open music service: https://api.audius.co",
  archive: "The Internet Archive is built in",
};
// Where music comes from besides the built-in Internet Archive. Instances come and go, so
// you give the address of one you trust and can change it whenever it stops answering.
export function MusicProviders({ music }: { music: MusicState }) {
  const [editing, setEditing] = useState<MusicProvider | null>(null);
  const [open, setOpen] = useState(false);
  const [removed, setRemoved] = useState<MusicProvider | null>(null);
  const [error, setError] = useState("");
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 60000);
    return () => clearInterval(timer);
  }, []);
  const { providers, checks, checking } = music;
  const close = () => {
    setOpen(false);
    setEditing(null);
    setError("");
  };
  return (
    <section
      className="settings-section"
      id="music-providers"
      aria-labelledby="music-providers-title"
    >
      <div className="section-title">
        <div>
          <h2 id="music-providers-title">
            <Music2 size={23} /> Music providers
          </h2>
        </div>
        <button
          className="button secondary"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus size={16} /> Add provider
        </button>
      </div>
      {removed && (
        <div className="undo-banner" role="status">
          <span>Removed “{removed.name}”.</span>
          <button
            className="button text"
            onClick={() => {
              music.save(removed);
              setRemoved(null);
            }}
          >
            <Undo2 size={15} /> Undo
          </button>
        </div>
      )}
      <div className="source-list">
        {providers.map((p, index) => {
          const check = checks[p.id];
          return (
            <div className="source-row server-row" key={p.id}>
              <div className={`source-mark ${p.enabled ? "enabled" : ""}`}>
                <Music2 size={18} />
              </div>
              <div className="source-copy">
                <h3>{p.name}</h3>
                <p className="server-address">
                  {musicProviderLabels[p.type]} · {p.base}
                </p>
                <span className="source-status">
                  {index + 1} of {providers.length}
                  {p.enabled ? "" : " · Off"} ·{" "}
                  {checking.includes(p.id)
                    ? "Checking…"
                    : check
                      ? `${check.ok ? "Answering" : "Not answering"} · checked ${ago(check.at)}`
                      : "Not checked"}
                </span>
                {check && !check.ok && check.reason && (
                  <span className="source-status">{check.reason}</span>
                )}
              </div>
              <div className="source-controls">
                <button
                  className="button text"
                  disabled={checking.includes(p.id)}
                  onClick={() => void music.check(p)}
                >
                  Check
                </button>
                <button
                  className="icon-button"
                  aria-label={`Try ${p.name} earlier`}
                  disabled={index === 0}
                  onClick={() => music.move(p.id, -1)}
                >
                  <ArrowUp size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Try ${p.name} later`}
                  disabled={index === providers.length - 1}
                  onClick={() => music.move(p.id, 1)}
                >
                  <ArrowDown size={16} />
                </button>
                <button
                  className="icon-button"
                  aria-label={`Edit provider ${p.name}`}
                  onClick={() => {
                    setEditing(p);
                    setOpen(true);
                  }}
                >
                  <Pencil size={16} />
                </button>
                <button
                  className="button secondary small"
                  onClick={() => music.save({ ...p, enabled: !p.enabled })}
                >
                  {p.enabled ? "Turn off" : "Turn on"}
                </button>
                <button
                  className="icon-button"
                  aria-label={`Remove provider ${p.name}`}
                  onClick={() => {
                    music.remove(p.id);
                    setRemoved(p);
                    if (editing?.id === p.id) close();
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      <p className="fine-print">
        The Internet Archive is built in: openly licensed concerts and albums,
        with no account. Add Audius (free, no account) or the address of an
        Invidious or Piped instance for more.
      </p>
      {providers.length > 1 && (
        <p className="fine-print">
          Providers are tried from the top. When one stops answering, the next
          one is used.
        </p>
      )}
      {open && (
        <form
          key={editing?.id || "new"}
          className="form-grid server-form"
          aria-label={editing ? "Edit music provider" : "Add music provider"}
          onSubmit={(event) => {
            event.preventDefault();
            const f = new FormData(event.currentTarget);
            const name = String(f.get("name") || "").trim();
            const base = serverAddress(String(f.get("base") || "").trim());
            const id = editing?.id || music.newId();
            if (!base) {
              setError(
                "Enter a plain web address such as https://your-instance.example, with no extra path or query.",
              );
              return;
            }
            const clash = providers.find(
              (p) => p.id !== id && p.name.toLowerCase() === name.toLowerCase(),
            );
            if (clash) {
              setError(
                `A provider named “${clash.name}” already exists. Give this one a different name.`,
              );
              return;
            }
            music.save({
              id,
              name,
              type: f.get("type") as MusicProviderType,
              base,
              enabled: editing?.enabled ?? true,
            });
            close();
            setRemoved(null);
          }}
        >
          <label>
            Name
            <input
              name="name"
              autoFocus
              required
              maxLength={100}
              defaultValue={editing?.name || ""}
              placeholder="My music instance"
            />
          </label>
          <label>
            Type
            <select name="type" defaultValue={editing?.type || "invidious"}>
              {musicProviderTypes.map((t) => (
                <option key={t} value={t}>
                  {musicProviderLabels[t]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Address
            <input
              name="base"
              type="url"
              required
              autoComplete="off"
              defaultValue={editing?.base || ""}
              placeholder="https://your-instance.example"
            />
          </label>
          <p className="fine-print form-wide">
            {hints[(editing?.type || "invidious") as MusicProviderType]}. Piped
            needs its API address; Invidious its normal address. Many public
            Invidious and Piped instances block other sites; Audius allows them.
            Check runs right after you save.
          </p>
          {error && (
            <p className="source-error form-wide" role="alert">
              {error}
            </p>
          )}
          <div className="actions form-wide">
            <button className="button primary">
              <Check size={16} /> {editing ? "Save provider" : "Add provider"}
            </button>
            <button className="button text" type="button" onClick={close}>
              Cancel
            </button>
          </div>
        </form>
      )}
      <label className="checkbox music-lookups">
        <input
          type="checkbox"
          checked={music.lookups}
          onChange={(event) => music.setLookups(event.target.checked)}
        />
        Look up lyrics and album art. This sends the song title and artist to
        LRCLIB and MusicBrainz.
      </label>
    </section>
  );
}
