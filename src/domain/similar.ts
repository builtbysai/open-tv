import { isAudio, type Content } from "./content";
const isEpisodic = (item: Content) =>
  item.type === "series" || item.type === "episode";
const isLive = (item: Content) => item.type === "live" || isAudio(item);
// Titles of the same kind that share genres, with a small nudge for era and origin.
export function similarTo(
  item: Content,
  pool: Content[],
  limit = 12,
): Content[] {
  if (isLive(item) || !item.genres.length) return [];
  const genres = new Set(item.genres);
  const scored: { item: Content; score: number }[] = [];
  for (const other of pool) {
    if (
      other.id === item.id ||
      other.type === "episode" ||
      isLive(other) ||
      isEpisodic(other) !== isEpisodic(item) ||
      other.availability !== "playable"
    )
      continue;
    const shared = other.genres.filter((g) => genres.has(g)).length;
    if (!shared) continue;
    const union = genres.size + other.genres.length - shared;
    let score = (shared / union) * 40;
    if (item.year && other.year) {
      const gap = Math.abs(item.year - other.year);
      score += gap <= 5 ? 10 : gap <= 15 ? 5 : 0;
    }
    if (other.countries.some((c) => item.countries.includes(c))) score += 8;
    if (other.languages.some((l) => item.languages.includes(l))) score += 4;
    if (other.artwork) score += 2;
    scored.push({ item: other, score });
  }
  return scored
    .sort(
      (a, b) => b.score - a.score || a.item.title.localeCompare(b.item.title),
    )
    .slice(0, limit)
    .map((entry) => entry.item);
}
