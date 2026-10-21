import { isAudio, type Content } from "./content";
export interface SearchEntry {
  item: Content;
  title: string;
  words: string[];
  extra: string;
  year?: number;
}
export interface ParsedQuery {
  tokens: string[];
  year?: number;
  kind?: "movie" | "series" | "live" | "audio";
}
export const fold = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
const yearIn = (text: string) => {
  const found = /\b((?:19|20)\d{2})\b/.exec(text);
  return found ? Number(found[1]) : undefined;
};
export function buildRankedIndex(items: Content[]): SearchEntry[] {
  return items.map((item) => {
    const title = fold(item.title);
    return {
      item,
      title,
      words: title.split(" "),
      extra: fold(
        [...item.genres, ...item.languages, ...item.countries].join(" "),
      ),
      year: item.year || yearIn(item.title),
    };
  });
}
const kinds: Record<string, ParsedQuery["kind"]> = {
  movie: "movie",
  movies: "movie",
  film: "movie",
  films: "movie",
  series: "series",
  show: "series",
  shows: "series",
  channel: "live",
  channels: "live",
  live: "live",
  audio: "audio",
  music: "audio",
  podcast: "audio",
  podcasts: "audio",
  song: "audio",
  songs: "audio",
  album: "audio",
  albums: "audio",
};
export function parseQuery(text: string): ParsedQuery {
  let tokens = fold(text).split(" ").filter(Boolean);
  let year: number | undefined;
  let kind: ParsedQuery["kind"];
  const yearToken = tokens.find((t) => /^(?:19|20)\d{2}$/.test(t));
  if (yearToken && tokens.length > 1) {
    year = Number(yearToken);
    tokens = tokens.filter((t) => t !== yearToken);
  }
  const kindToken = tokens.find((t) => kinds[t]);
  if (kindToken) {
    kind = kinds[kindToken];
    if (tokens.length > 1) tokens = tokens.filter((t) => t !== kindToken);
    else tokens = [];
  }
  return { tokens, year, kind };
}
// Damerau-Levenshtein (optimal string alignment); returns max + 1 when exceeded.
export function distance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const d: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...Array<number>(b.length).fill(0),
  ]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(
        d[i - 1][j] + 1,
        d[i][j - 1] + 1,
        d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
        d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
    }
  return Math.min(d[a.length][b.length], max + 1);
}
function tokenScore(
  entry: SearchEntry,
  token: string,
  fuzzy: boolean,
  anchored: boolean,
): number {
  let best = 0;
  for (const word of entry.words) {
    if (word === token) return 100;
    if (token.length > 1 && word.startsWith(token)) best = Math.max(best, 80);
    else if (token.length > 2 && word.includes(token))
      best = Math.max(best, 45);
  }
  if (best) return best;
  if (token.length > 2 && entry.extra.includes(token)) return 25;
  if (fuzzy && (token.length >= 4 || (anchored && token.length === 3))) {
    const max = token.length >= 8 ? 2 : 1;
    for (const word of entry.words)
      if (word.length >= 3 && distance(token, word, max) <= max) return 40;
  }
  return 0;
}
const kindOf = (item: Content): ParsedQuery["kind"] =>
  isAudio(item)
    ? "audio"
    : item.type === "live"
      ? "live"
      : item.type === "series" || item.type === "episode"
        ? "series"
        : "movie";
export function rankSearch(
  index: SearchEntry[],
  text: string,
  limit = 600,
): Content[] {
  const query = parseQuery(text);
  if (!query.tokens.length && !query.kind) return [];
  const joined = query.tokens.join(" ");
  const scored: { item: Content; score: number }[] = [];
  const run = (fuzzy: boolean) => {
    scored.length = 0;
    for (const entry of index) {
      if (query.kind && kindOf(entry.item) !== query.kind) continue;
      let score = 0;
      let matched = true;
      for (const token of query.tokens) {
        const value = tokenScore(entry, token, fuzzy, query.tokens.length > 1);
        if (!value) {
          matched = false;
          break;
        }
        score += value;
      }
      if (!matched) continue;
      if (joined) {
        if (entry.title === joined) score += 500;
        else if (entry.title.startsWith(joined)) score += 250;
        else if (entry.title.includes(joined)) score += 80;
      }
      if (query.year && entry.year)
        score +=
          entry.year === query.year
            ? 120
            : Math.abs(entry.year - query.year) === 1
              ? 40
              : -150;
      score -= entry.title.length * 0.2;
      if (kindOf(entry.item) !== "live") score += 10;
      if (entry.item.availability === "playable") score += 5;
      if (entry.item.artwork) score += 2;
      scored.push({ item: entry.item, score });
    }
  };
  run(false);
  if (scored.length < 8 && query.tokens.length) run(true);
  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.item);
}
