import type { Content } from "./content";
const playable = (item: Content) =>
  item.availability === "playable" && item.streams.length > 0;
export function sortedEpisodes(pool: Content[], seriesId: string): Content[] {
  return pool
    .filter(
      (c) =>
        ["episode", "anime"].includes(c.type) &&
        c.seriesId === seriesId &&
        playable(c),
    )
    .sort(
      (a, b) =>
        (a.season ?? 1) - (b.season ?? 1) ||
        (a.episode || 1) - (b.episode || 1),
    );
}
export function nextEpisode(
  current: Content,
  pool: Content[],
): Content | undefined {
  if (!current.seriesId) return undefined;
  const episodes = sortedEpisodes(pool, current.seriesId);
  const index = episodes.findIndex((c) => c.id === current.id);
  return index >= 0 ? episodes[index + 1] : undefined;
}
// Picks what a series' Play button should start: an episode in progress, the one
// after the last one watched, or the first regular episode.
export function resumeEpisode(
  episodes: Content[],
  history: { id: string }[],
  progress: (item: Content) => number,
  aliases: (item: Content) => string[],
): Content | undefined {
  const list = episodes.filter(playable);
  if (!list.length) return undefined;
  for (const entry of history) {
    const index = list.findIndex((c) => aliases(c).includes(entry.id));
    if (index < 0) continue;
    return progress(list[index]) > 10
      ? list[index]
      : (list[index + 1] ?? list[0]);
  }
  return list.find((c) => (c.season ?? 1) > 0) ?? list[0];
}
export const episodeLabel = (item: Content) =>
  `S${item.season ?? 1} E${item.episode ?? 1}`;
