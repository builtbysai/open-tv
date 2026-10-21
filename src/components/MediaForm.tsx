import { useState } from "react";
import { Plus, Check } from "lucide-react";
import { stableId, type Content } from "../domain/content";
import { classify } from "../domain/privacy";
import { mediaUrl, streamFormat } from "../domain/urls";
import { canPersistServer, type MediaServer } from "../domain/servers";
import type { MediaDraft } from "../domain/view-state";
export type { MediaDraft } from "../domain/view-state";
interface Props {
  initial?: Content;
  servers?: MediaServer[];
  draft?: MediaDraft;
  onDraft?(draft: MediaDraft | null): void;
  onSave(item: Content): void;
  onNotice(message: string): void;
}
export function MediaForm({
  initial,
  servers = [],
  draft,
  onDraft,
  onSave,
  onNotice,
}: Props) {
  const [formKey, setFormKey] = useState(0);
  const [serverId, setServerId] = useState(
    initial?.serverId || draft?.serverId || "",
  );
  const [type, setType] = useState<Content["type"]>(
    initial?.type || draft?.type || "movie",
  );
  const list = (value: FormDataEntryValue | null) =>
    String(value || "")
      .split(",")
      .map((v) => v.trim().slice(0, 80))
      .filter(Boolean)
      .slice(0, 30);
  // The classifier only suggests: what you choose is what is saved.
  const [looksAdult, setLooksAdult] = useState(false);
  const saveDraft = (form: HTMLFormElement) => {
    const f = new FormData(form);
    const title = String(f.get("title") || "");
    setLooksAdult(
      f.get("classification") === "general" &&
        classify(`${title} ${String(f.get("genres") || "")}`) === "adult",
    );
    if (!onDraft) return;
    const linked = String(f.get("serverId") || "");
    if (
      linked &&
      !servers.some((s) => s.id === linked && canPersistServer(s))
    ) {
      onDraft(null);
      return;
    }
    const itemId = String(f.get("itemId") || "");
    onDraft({
      title,
      description: String(f.get("description") || ""),
      type: f.get("type") as Content["type"],
      classification: f.get("classification") === "adult" ? "adult" : "general",
      series: String(f.get("series") || ""),
      season: f.get("season") !== null ? Number(f.get("season")) : 1,
      episode: Number(f.get("episode")) || 1,
      serverId: linked || undefined,
      providerItemId:
        linked && /^[a-z0-9_-]{1,100}$/i.test(itemId) ? itemId : undefined,
      genres: String(f.get("genres") || ""),
      languages: String(f.get("languages") || ""),
      countries: String(f.get("countries") || ""),
      year: f.get("year") ? Number(f.get("year")) : undefined,
      runtimeMinutes: f.get("duration") ? Number(f.get("duration")) : undefined,
    });
  };
  return (
    <form
      key={formKey}
      className="form-grid media-form"
      onChange={(e) => saveDraft(e.currentTarget)}
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const f = new FormData(form);
        const url = mediaUrl(String(f.get("url")));
        const artwork = f.get("artwork")
          ? mediaUrl(String(f.get("artwork")))
          : undefined;
        if ((!serverId && !url) || artwork === null) {
          onNotice("Enter valid media and artwork URLs without logins.");
          return;
        }
        const title = String(f.get("title") || "").trim();
        if (!title) {
          onNotice("Enter a title for your media.");
          return;
        }
        const isEpisode = type === "episode" || type === "anime";
        const linkedServer = servers.find((s) => s.id === serverId);
        const providerItemId = String(f.get("itemId") || "").trim();
        if (
          serverId &&
          (!linkedServer || !/^[a-z0-9_-]{1,100}$/i.test(providerItemId))
        ) {
          onNotice("Choose a server and enter a valid provider title ID.");
          return;
        }
        const item: Content = {
          ...initial,
          id:
            initial?.id ||
            (serverId
              ? stableId(`server-media:${crypto.randomUUID()}`)
              : stableId(url!)),
          serverId: serverId || undefined,
          providerItemId: serverId ? providerItemId : undefined,
          providerId: "personal-media",
          title,
          type,
          description: String(f.get("description") || "").trim() || undefined,
          artwork: artwork || undefined,
          genres: list(f.get("genres")),
          countries: list(f.get("countries")),
          languages: list(f.get("languages")),
          year: f.get("year") ? Number(f.get("year")) : undefined,
          duration: f.get("duration")
            ? Number(f.get("duration")) * 60
            : undefined,
          classification: f.get("classification") as Content["classification"],
          availability: "playable",
          streams: serverId
            ? []
            : [
                {
                  url: url!,
                  format: f.get("embed") ? "embed" : streamFormat(url!),
                },
              ],
          seriesId: isEpisode
            ? serverId
              ? stableId(`server-series:${serverId}:${providerItemId}`)
              : initial?.seriesId ||
                stableId(`series:${String(f.get("series")) || title}`)
            : undefined,
          season: isEpisode ? Number(f.get("season")) : undefined,
          episode: isEpisode ? Number(f.get("episode")) || 1 : undefined,
          rights: { status: "user-authorized" },
        };
        // Saved unresolved: a server title's address is rebuilt from the server on load,
        // so a server address with a query string never keeps it off the device.
        onSave(item);
        onDraft?.(null);
        if (!initial) {
          form.reset();
          setType("movie");
          setServerId("");
          setFormKey((key) => key + 1);
        }
      }}
    >
      <label>
        Title
        <input
          name="title"
          required
          maxLength={200}
          defaultValue={initial?.title || draft?.title || ""}
          placeholder="A film worth keeping"
        />
      </label>
      <label>
        Playback source
        <select
          name="serverId"
          aria-label="Playback source"
          value={serverId}
          onChange={(e) => {
            setServerId(e.target.value);
            if (
              e.target.value &&
              !["movie", "documentary", "episode", "anime"].includes(type)
            )
              setType("movie");
          }}
        >
          <option value="">Direct URL or embedded player</option>
          {serverId && !servers.some((s) => s.id === serverId) && (
            <option value={serverId}>Missing server · choose another</option>
          )}
          {servers.map((server) => (
            <option key={server.id} value={server.id}>
              {server.name}
              {server.enabled ? "" : " (disconnected)"}
            </option>
          ))}
        </select>
      </label>
      {serverId ? (
        <label key="provider-item">
          Provider title ID
          <input
            name="itemId"
            required
            pattern="[A-Za-z0-9_-]{1,100}"
            maxLength={100}
            defaultValue={
              initial?.providerItemId || draft?.providerItemId || ""
            }
            placeholder="TMDB, IMDb or your server’s title ID"
          />
        </label>
      ) : (
        <label key="direct-url">
          Media URL
          <input
            name="url"
            type="url"
            required
            autoComplete="off"
            defaultValue={initial?.streams[0]?.url || ""}
            placeholder="https://your-server/film.mp4"
          />
        </label>
      )}
      <label>
        Content type
        <select
          name="type"
          value={type}
          onChange={(e) => setType(e.target.value as Content["type"])}
        >
          <option value="movie">Movie</option>
          <option value="episode">Series episode</option>
          <option value="anime">Anime</option>
          <option value="documentary">Documentary</option>
          {!serverId && (
            <option value="audio">Audio (music, podcast, book)</option>
          )}
          {!serverId && <option value="radio">Live radio station</option>}
          {!serverId && <option value="live">Live channel</option>}
        </select>
      </label>
      <label>
        Classification
        <select
          name="classification"
          defaultValue={
            initial?.classification || draft?.classification || "general"
          }
        >
          <option value="general">General audience</option>
          <option value="adult">18+ · hidden until shown</option>
        </select>
        {looksAdult && (
          <span className="fine-print">
            This title looks 18+. Choose 18+ if it is; otherwise it stays
            general.
          </span>
        )}
      </label>
      <label className="form-wide">
        Description
        <textarea
          name="description"
          maxLength={10000}
          defaultValue={initial?.description || draft?.description || ""}
          rows={3}
        />
      </label>
      <label>
        Genres (comma separated)
        <input
          name="genres"
          maxLength={1000}
          defaultValue={
            initial?.genres.join(", ") || draft?.genres || "Personal collection"
          }
          placeholder="Drama, Documentary"
        />
      </label>
      <label>
        Languages (comma separated)
        <input
          name="languages"
          maxLength={1000}
          defaultValue={initial?.languages.join(", ") || draft?.languages || ""}
          placeholder="English, French"
        />
      </label>
      <label>
        Countries (comma separated)
        <input
          name="countries"
          maxLength={1000}
          defaultValue={initial?.countries.join(", ") || draft?.countries || ""}
          placeholder="United Kingdom"
        />
      </label>
      <div className="form-pair">
        <label>
          Release year
          <input
            name="year"
            type="number"
            min="1888"
            max="2200"
            defaultValue={initial?.year || draft?.year || ""}
          />
        </label>
        <label>
          Runtime (minutes)
          <input
            name="duration"
            type="number"
            min="0.01"
            max="1440"
            step="any"
            defaultValue={
              initial?.duration
                ? initial.duration / 60
                : draft?.runtimeMinutes || ""
            }
          />
        </label>
      </div>
      <label className="form-wide">
        Artwork URL (optional)
        <input
          name="artwork"
          type="url"
          autoComplete="off"
          defaultValue={
            initial?.artwork?.startsWith("http") ? initial.artwork : ""
          }
          placeholder="https://your-server/poster.jpg"
        />
      </label>
      {(type === "episode" || type === "anime") && (
        <>
          {!serverId && (
            <label>
              Series name
              <input name="series" defaultValue={draft?.series || ""} />
            </label>
          )}
          <div className="form-pair">
            <label>
              Season
              <input
                name="season"
                type="number"
                min="0"
                max="10000"
                defaultValue={initial?.season ?? draft?.season ?? 1}
              />
            </label>
            <label>
              Episode
              <input
                name="episode"
                type="number"
                min="1"
                max="10000"
                defaultValue={initial?.episode || draft?.episode || 1}
              />
            </label>
          </div>
        </>
      )}
      {!serverId && (
        <label className="checkbox">
          <input
            name="embed"
            type="checkbox"
            defaultChecked={initial?.streams[0]?.format === "embed"}
          />
          Use embedded player
        </label>
      )}
      <label className="checkbox">
        <input type="checkbox" required defaultChecked={!!initial} />I have
        permission to access this media
      </label>
      <p className="fine-print form-wide">
        Entries are saved on this device. 18+ entries are hidden while 18+ is.
      </p>
      <button className="button primary" type="submit">
        {initial ? <Check size={16} /> : <Plus size={16} />}{" "}
        {initial ? "Save changes" : "Add media"}
      </button>
    </form>
  );
}
