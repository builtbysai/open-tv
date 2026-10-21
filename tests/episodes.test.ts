import { describe, expect, it } from "vitest";
import { item } from "./fixtures";
import {
  nextEpisode,
  resumeEpisode,
  sortedEpisodes,
} from "../src/domain/episodes";
import type { Content } from "../src/domain/content";
const ep = (season: number, episode: number, patch: Partial<Content> = {}) =>
  item({
    id: `s${season}e${episode}`,
    title: `Episode ${episode}`,
    type: "episode",
    seriesId: "show",
    season,
    episode,
    ...patch,
  });
const aliases = (c: Content) => [c.id];
describe("series navigation", () => {
  const pool = [
    ep(1, 2),
    ep(2, 1),
    ep(1, 1),
    ep(0, 1),
    ep(1, 3, { availability: "unavailable" }),
  ];
  it("orders episodes and skips unplayable entries", () => {
    expect(sortedEpisodes(pool, "show").map((c) => c.id)).toEqual([
      "s0e1",
      "s1e1",
      "s1e2",
      "s2e1",
    ]);
  });
  it("finds the next episode across seasons and none at the end", () => {
    expect(nextEpisode(ep(1, 2), pool)?.id).toBe("s2e1");
    expect(nextEpisode(ep(2, 1), pool)).toBeUndefined();
    expect(nextEpisode(item({ id: "movie" }), pool)).toBeUndefined();
  });
  it("resumes in-progress episodes, advances past finished ones, and starts at season 1", () => {
    const episodes = sortedEpisodes(pool, "show");
    const progress = (c: Content) => (c.id === "s1e2" ? 300 : 0);
    expect(
      resumeEpisode(episodes, [{ id: "s1e2" }], progress, aliases)?.id,
    ).toBe("s1e2");
    expect(
      resumeEpisode(episodes, [{ id: "s1e1" }], () => 0, aliases)?.id,
    ).toBe("s1e2");
    expect(resumeEpisode(episodes, [], () => 0, aliases)?.id).toBe("s1e1");
    expect(resumeEpisode([], [], () => 0, aliases)).toBeUndefined();
  });
});
