import { useEffect, useState } from "react";
import {
  Plus,
  Pencil,
  Trash2,
  Undo2,
  Check,
  Server,
  Upload,
  Download,
} from "lucide-react";
import { exportJson } from "../persistence/export";
import { stableId, type Content } from "../domain/content";
import {
  DEFAULT_EPISODE,
  DEFAULT_MOVIE,
  guards,
  serverReachable,
  validTemplate,
  importServers,
  canPersistServer,
  type MediaServer,
} from "../domain/servers";
import { ServerFormat } from "./ServerFormat";
import {
  ago,
  readChecks,
  writeChecks,
  type ServerCheck,
} from "../persistence/servers";
const guardLabels: Record<(typeof guards)[number], string> = {
  open: "Open · trusted server",
  click: "Click guard · the first click is absorbed",
  sandbox: "Sandboxed · scripts only, no pop-ups (some servers refuse)",
};
const storage = () => {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
};
interface Props {
  servers: MediaServer[];
  media: Content[];
  onSave(server: MediaServer): boolean;
  onRemove(id: string): void;
}
export function ServerManager({ servers, media, onSave, onRemove }: Props) {
  const [editing, setEditing] = useState<MediaServer | null>(null),
    [open, setOpen] = useState(false),
    [removed, setRemoved] = useState<MediaServer | null>(null),
    [confirming, setConfirming] = useState<string | null>(null),
    [formError, setFormError] = useState(""),
    [base, setBase] = useState(""),
    [checking, setChecking] = useState<string[]>([]),
    [checks, setChecks] = useState<Record<string, ServerCheck>>(() => {
      const store = storage();
      return store ? readChecks(store) : {};
    });
  const [, tick] = useState(0);
  // Relative times ("5 min ago") move on without a reload.
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 60000);
    return () => clearInterval(timer);
  }, []);
  // A server is saved either way; this only says whether anything answers at its address.
  const check = async (server: MediaServer) => {
    setChecking((old) => [...old, server.id]);
    const ok = await serverReachable(server);
    setChecking((old) => old.filter((id) => id !== server.id));
    setChecks((old) => {
      const next = { ...old, [server.id]: { ok, at: Date.now() } };
      const store = storage();
      if (store) writeChecks(store, next);
      return next;
    });
  };
  const removeServer = (server: MediaServer) => {
    onRemove(server.id);
    setRemoved(server);
    setConfirming(null);
    if (editing?.id === server.id) {
      setOpen(false);
      setEditing(null);
    }
  };
  return (
    <section
      className="settings-section"
      id="media-servers"
      aria-labelledby="media-servers-title"
    >
      <div className="section-title">
        <div>
          <h2 id="media-servers-title">Media servers</h2>
        </div>
        <button
          className="button secondary"
          onClick={() => {
            setEditing(null);
            setBase("");
            setOpen(true);
          }}
        >
          <Plus size={16} /> Add server
        </button>
      </div>
      <div className="server-io">
        <label className="button text file-input">
          <Upload size={15} /> Import servers
          <input
            type="file"
            accept="application/json,.json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                const added = importServers(JSON.parse(await file.text()));
                let count = 0;
                for (const server of added)
                  if (
                    !servers.some((s) => s.base === server.base) &&
                    onSave(server)
                  )
                    count++;
                setFormError(
                  count
                    ? `Added ${count} server${count === 1 ? "" : "s"}.`
                    : "Nothing new to add from that file.",
                );
              } catch {
                setFormError("Choose a servers file (JSON).");
              }
            }}
          />
        </label>
        {servers.some(canPersistServer) && (
          <button
            className="button text"
            onClick={() =>
              exportJson("open-tv-servers.json", {
                version: 1,
                servers: servers.filter(canPersistServer).map((s) => ({
                  name: s.name,
                  base: s.base,
                  ...(s.guard ? { guard: s.guard } : {}),
                  ...(s.movie ? { movie: s.movie } : {}),
                  ...(s.episode ? { episode: s.episode } : {}),
                })),
              })
            }
          >
            <Download size={15} /> Export servers
          </button>
        )}
      </div>
      {removed && (
        <div className="undo-banner" role="status">
          <span>
            Removed “{removed.name}”. Its titles stay saved and unavailable
            until you restore or reassign the server.
          </span>
          <button
            className="button text"
            onClick={() => {
              if (onSave(removed)) setRemoved(null);
            }}
          >
            <Undo2 size={15} /> Undo server removal
          </button>
        </div>
      )}
      <div className="source-list">
        {servers.map((server) => {
          const count = media.filter(
            (item) => item.serverId === server.id,
          ).length;
          return (
            <div className="source-row server-row" key={server.id}>
              <div className={`source-mark ${server.enabled ? "enabled" : ""}`}>
                <Server size={18} />
              </div>
              <div className="source-copy">
                <h3>{server.name}</h3>
                <p className="server-address">{server.base}</p>
                <span className="source-status">
                  {count} linked {count === 1 ? "title" : "titles"} ·{" "}
                  {checking.includes(server.id)
                    ? "Checking…"
                    : !server.enabled
                      ? "Disconnected"
                      : !checks[server.id]
                        ? "Connected · not checked yet"
                        : checks[server.id].ok
                          ? `Connected · reachable, checked ${ago(checks[server.id].at)}`
                          : `Needs attention · not reachable, checked ${ago(checks[server.id].at)}. Check the address.`}
                </span>
              </div>
              {confirming === server.id && (
                <div
                  className="undo-banner form-wide"
                  role="alertdialog"
                  aria-label={`Remove ${server.name}?`}
                >
                  <span>
                    Remove “{server.name}”? Its {count} linked{" "}
                    {count === 1 ? "title stays" : "titles stay"} saved but
                    unavailable until you restore or reassign the server.
                  </span>
                  <button
                    className="button secondary small"
                    onClick={() => removeServer(server)}
                  >
                    Remove server
                  </button>
                  <button
                    className="button text"
                    onClick={() => setConfirming(null)}
                  >
                    Keep it
                  </button>
                </div>
              )}
              <div className="source-controls">
                <button
                  className="button text"
                  disabled={checking.includes(server.id)}
                  onClick={() => void check(server)}
                >
                  Check
                </button>
                <button
                  className="icon-button"
                  aria-label={`Edit server ${server.name}`}
                  onClick={() => {
                    setEditing(server);
                    setBase(server.base);
                    setOpen(true);
                  }}
                >
                  <Pencil size={16} />
                </button>
                <button
                  className="button secondary small"
                  onClick={() =>
                    onSave({ ...server, enabled: !server.enabled })
                  }
                >
                  {server.enabled ? "Disconnect server" : "Reconnect server"}
                </button>
                <button
                  className="icon-button"
                  aria-label={`Remove server ${server.name}`}
                  onClick={() => {
                    // A server with linked titles asks first; an empty one goes at once.
                    if (count > 0) return setConfirming(server.id);
                    removeServer(server);
                  }}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
      {!servers.length && !open && (
        <p className="server-empty muted">
          Save a server once, then add titles by ID.
        </p>
      )}
      {open && (
        <form
          key={editing?.id || "new"}
          className="form-grid server-form"
          aria-label={editing ? "Edit media server" : "Add media server"}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const id = editing?.id || stableId(`server:${crypto.randomUUID()}`);
            const next: MediaServer = {
              id,
              name: String(f.get("name") || "").trim(),
              base: String(f.get("base") || "").trim(),
              classification: f.get(
                "classification",
              ) as MediaServer["classification"],
              enabled: editing?.enabled ?? true,
              ...(f.get("guard") === "click" || f.get("guard") === "sandbox"
                ? { guard: f.get("guard") as MediaServer["guard"] }
                : {}),
            };
            const movie = validTemplate(f.get("movie"), false);
            const episode = validTemplate(f.get("episode"), true);
            if (!movie || !episode) {
              setFormError(
                "The address format needs {base} and {id}, and for episodes {season} and {episode}.",
              );
              return;
            }
            // The usual layout is the default and isn't stored.
            if (movie !== DEFAULT_MOVIE) next.movie = movie;
            if (episode !== DEFAULT_EPISODE) next.episode = episode;
            const clash = servers.find(
              (other) =>
                other.id !== id &&
                other.name.trim().toLowerCase() === next.name.toLowerCase(),
            );
            if (clash) {
              setFormError(
                `A server named “${clash.name}” already exists. Give this one a different name so you can tell them apart.`,
              );
              return;
            }
            setFormError("");
            const saved = onSave(next);
            if (saved) {
              void check(next);
              setOpen(false);
              setEditing(null);
              setRemoved(null);
            }
          }}
        >
          <label>
            Server name
            <input
              name="name"
              autoFocus
              required
              maxLength={100}
              defaultValue={editing?.name || ""}
              placeholder="My film server"
            />
          </label>
          <label>
            Server address
            <input
              name="base"
              type="url"
              required
              autoComplete="off"
              defaultValue={editing?.base || ""}
              placeholder="https://your-server.example"
              onChange={(e) => setBase(e.target.value)}
            />
          </label>
          <ServerFormat base={base} initial={editing ?? undefined} />
          <label>
            Server content
            <select
              name="classification"
              defaultValue={editing?.classification || "general"}
            >
              <option value="general">
                General · adult-looking titles stay hidden
              </option>
              <option value="adult">18+ · hidden until shown</option>
            </select>
          </label>
          <label>
            Embed protection
            <select name="guard" defaultValue={editing?.guard || "open"}>
              {guards.map((value) => (
                <option key={value} value={value}>
                  {guardLabels[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="checkbox">
            <input type="checkbox" required defaultChecked={!!editing} />I am
            authorized to use this server
          </label>
          {formError && (
            <p className="source-error form-wide" role="alert">
              {formError}
            </p>
          )}
          <p className="fine-print form-wide">
            Servers are saved on this device.
          </p>
          <div className="actions form-wide">
            <button className="button primary">
              <Check size={16} /> {editing ? "Save server" : "Create server"}
            </button>
            <button
              className="button text"
              type="button"
              onClick={() => {
                setOpen(false);
                setEditing(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
