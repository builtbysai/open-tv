import { Plus, Upload } from "lucide-react";
import type { Source } from "../../domain/content";
import { stableId } from "../../domain/content";
import { canPersistContent } from "../../domain/library";
import { mediaUrl } from "../../domain/urls";
import { parseM3U } from "../../providers/m3u";
import { canPersistServer, validateServer } from "../../domain/servers";
import type { SettingsProps, SettingsShared } from "./types";
export function PlaylistSection({
  onSaveServer,
  onSource,
  onItems,
  user,
  onDrafts,
  setMessage,
  mounted,
  report,
}: Pick<
  SettingsProps,
  "onSaveServer" | "onSource" | "onItems" | "user" | "onDrafts"
> &
  Pick<SettingsShared, "setMessage" | "mounted" | "report">) {
  return (
    <section className="settings-section" id="settings-playlists">
      <h2>Add a playlist</h2>
      <p className="muted">
        M3U or M3U8 from a URL or file. It keeps the classification you choose.
      </p>
      <form
        className="form-grid"
        onChange={(e) => {
          const f = new FormData(e.currentTarget);
          onDrafts({
            playlist: {
              name: String(f.get("name") || ""),
              classification:
                f.get("classification") === "adult" ? "adult" : "general",
            },
          });
        }}
        onSubmit={(e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          const url = mediaUrl(String(form.get("url")));
          if (!url) {
            setMessage("Enter a valid playlist URL without a login.");
            return;
          }
          const source: Source = {
            id: stableId(url),
            name: String(form.get("name")) || "My playlist",
            url,
            kind: "m3u",
            classification: form.get(
              "classification",
            ) as Source["classification"],
            enabled: true,
            refreshHours: 24,
            description:
              "User-supplied playlist. Confirm that your use is authorized.",
          };
          onSource(source);
        }}
      >
        <label>
          Name
          <input
            name="name"
            defaultValue={user.session.drafts.playlist?.name || ""}
            placeholder="Living room channels"
            maxLength={100}
          />
        </label>
        <label>
          Playlist URL
          <input
            name="url"
            type="url"
            placeholder="https://your-server/playlist.m3u"
            required
            autoComplete="off"
          />
        </label>
        <label>
          Classification
          <select
            name="classification"
            defaultValue={
              user.session.drafts.playlist?.classification || "general"
            }
          >
            <option value="general">
              General · adult-looking titles stay hidden
            </option>
            <option value="adult">18+ · hidden until shown</option>
          </select>
        </label>
        <button className="button primary" type="submit">
          <Plus size={17} />
          Connect playlist
        </button>
      </form>
      <div className="import-row">
        <label className="button secondary file-input">
          <Upload size={16} />
          Import M3U file
          <input
            type="file"
            accept=".m3u,.m3u8"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (file.size > 15000000) {
                setMessage("Choose a playlist smaller than 15 MB.");
                return;
              }
              try {
                // A file has no address to sync from, so its channels are kept with your
                // personal media on this device.
                const source: Source = {
                  id: "personal-media",
                  name: "Personal media",
                  kind: "library",
                  enabled: true,
                  classification: "general",
                  refreshHours: 0,
                  description: "Your media",
                };
                const text = await file.text();
                if (!mounted.current) return;
                const items = parseM3U(text, source);
                onItems(source, items);
                const kept = items.filter(canPersistContent).length;
                setMessage(
                  `Imported ${items.length} ${items.length === 1 ? "entry" : "entries"} into Library → Personal media.` +
                    (kept < items.length
                      ? ` ${items.length - kept} with sign-in addresses last for this session only.`
                      : ""),
                );
              } catch (error) {
                report(error);
              }
            }}
          />
        </label>
        <label className="button secondary file-input">
          <Upload size={16} />
          Import source registry
          <input
            type="file"
            accept=".json"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              if (file.size > 100000) {
                setMessage("Choose a source registry smaller than 100 KB.");
                return;
              }
              try {
                const data = JSON.parse(await file.text());
                if (!mounted.current) return;
                if (data.version !== 1 || !Array.isArray(data.sources))
                  throw new Error();
                for (const s of data.sources.slice(0, 50)) {
                  if (
                    !s ||
                    typeof s.name !== "string" ||
                    !mediaUrl(s.url) ||
                    s.kind !== "m3u" ||
                    !["general", "adult", "unknown"].includes(s.classification)
                  )
                    continue;
                  onSource({
                    id: stableId(s.url),
                    name: s.name.slice(0, 100),
                    url: s.url,
                    kind: "m3u",
                    classification: s.classification,
                    enabled: false,
                    refreshHours: 24,
                    description: "Imported source. Connect to load.",
                  });
                }
                if (Array.isArray(data.servers))
                  for (const value of data.servers.slice(0, 200)) {
                    const server = validateServer(value);
                    if (server && canPersistServer(server))
                      onSaveServer({ ...server, enabled: false });
                  }
                setMessage("Sources imported. Connect the ones you want.");
              } catch {
                setMessage("This source registry is invalid.");
              }
            }}
          />
        </label>
      </div>
    </section>
  );
}
