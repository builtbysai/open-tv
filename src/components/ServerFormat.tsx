import { useState } from "react";
import {
  DEFAULT_EPISODE,
  DEFAULT_MOVIE,
  addressFormats,
  serverMediaUrl,
  validTemplate,
  type MediaServer,
} from "../domain/servers";

// How a server addresses titles: a common layout, or your own pattern with {id},
// {season} and {episode}. A preview shows the exact address for a sample title.
export function ServerFormat({
  base,
  initial,
}: {
  base: string;
  initial?: Pick<MediaServer, "movie" | "episode">;
}) {
  const preset =
    addressFormats.find(
      (f) =>
        f.movie === (initial?.movie ?? DEFAULT_MOVIE) &&
        f.episode === (initial?.episode ?? DEFAULT_EPISODE),
    )?.id ?? "custom";
  const [format, setFormat] = useState<string>(preset);
  const [movie, setMovie] = useState(initial?.movie ?? DEFAULT_MOVIE);
  const [episode, setEpisode] = useState(initial?.episode ?? DEFAULT_EPISODE);
  const chosen = addressFormats.find((f) => f.id === format);
  const movieT = chosen?.movie ?? movie;
  const episodeT = chosen?.episode ?? episode;
  const sample = (template: string, tv: boolean) => {
    if (!validTemplate(template, tv))
      return "Use {base}, {id} and, for episodes, {season} and {episode}.";
    try {
      return serverMediaUrl(
        {
          id: "ot-preview",
          name: "Preview",
          base: base || "https://your-server.example",
          classification: "general",
          enabled: true,
          movie: movieT,
          episode: episodeT,
        },
        tv
          ? { type: "episode", providerItemId: "1396", season: 1, episode: 1 }
          : { type: "movie", providerItemId: "603" },
      );
    } catch {
      return "Enter the server's address first.";
    }
  };
  return (
    <fieldset className="server-format form-wide">
      <legend>Address format</legend>
      <select
        aria-label="Address format"
        value={format}
        onChange={(e) => setFormat(e.target.value)}
      >
        {addressFormats.map((f) => (
          <option key={f.id} value={f.id}>
            {f.label}
          </option>
        ))}
        <option value="custom">My own pattern…</option>
      </select>
      {format === "custom" && (
        <>
          <label>
            Films
            <input
              value={movie}
              onChange={(e) => setMovie(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
          <label>
            Episodes
            <input
              value={episode}
              onChange={(e) => setEpisode(e.target.value)}
              spellCheck={false}
              autoComplete="off"
            />
          </label>
        </>
      )}
      <input type="hidden" name="movie" value={movieT} />
      <input type="hidden" name="episode" value={episodeT} />
      <p className="fine-print server-preview">
        Film (TMDB 603): <code>{sample(movieT, false)}</code>
        <br />
        Episode (TMDB 1396, S1 E1): <code>{sample(episodeT, true)}</code>
      </p>
    </fieldset>
  );
}
