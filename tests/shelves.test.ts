import { describe, expect, it } from "vitest";
import { item } from "./fixtures";
import { dedupeShelves, isOwnedTitle, rankOnServers } from "../src/app/shelves";
import type { Content } from "../src/domain/content";

const film = (id: string, patch: Partial<Content> = {}) =>
  item({
    id,
    title: id,
    type: "movie",
    streams: [{ url: `https://srv.example/${id}.mp4`, format: "video" }],
    ...patch,
  });
const now = Date.UTC(2026, 9, 1);
const day = 24 * 3600 * 1000;

describe("discovery shelves", () => {
  it("shows each title in one shelf only, earlier shelves first", () => {
    const a = film("a", { tmdbId: 1 });
    const b = film("b", { tmdbId: 2 });
    const tmdbA = film("tmdb:movie:1", { tmdbId: 1, providerId: "tmdb" });
    const shelves = dedupeShelves([
      { title: "Trending this week", items: [a, b] },
      { title: "Popular on your servers", items: [tmdbA, film("c")] },
      { title: "Top rated", items: [b] },
    ]);
    expect(shelves.map((s) => [s.title, s.items.map((i) => i.id)])).toEqual([
      ["Trending this week", ["a", "b"]],
      ["Popular on your servers", ["c"]],
    ]);
  });
  it("ranks owned titles by plays, progress and recent arrival", () => {
    const played = film("played");
    const watched = film("watched");
    const fresh = film("fresh", { addedAt: now - 2 * day });
    const old = film("old", { addedAt: now - 400 * day });
    const idle = film("idle");
    const ranked = rankOnServers(
      [idle, old, fresh, watched, played],
      {
        history: [
          { id: "played", at: now - day },
          { id: "watched", at: now - 3 * day },
        ],
        progress: { watched: 1800 },
      },
      now,
    );
    expect(ranked.map((c) => c.id)).toEqual(["watched", "played", "fresh"]);
  });
  it("counts plays across a title's aliases and leaves archive titles out", () => {
    const a = film("a", { aliases: ["a-old"] });
    const b = film("b");
    const archive = film("arch", { providerId: "open-cinema" });
    const ranked = rankOnServers(
      [b, a, archive],
      {
        history: [
          { id: "a", at: now - day },
          { id: "a-old", at: now - 2 * day },
          { id: "b", at: now },
          { id: "arch", at: now },
        ],
        progress: {},
      },
      now,
    );
    expect(ranked.map((c) => c.id)).toEqual(["a", "b"]);
  });
  it("treats playable films and identified series as owned", () => {
    expect(isOwnedTitle(film("x"))).toBe(true);
    expect(isOwnedTitle(film("y", { availability: "unavailable" }))).toBe(
      false,
    );
    expect(
      isOwnedTitle(
        film("s", { type: "series", availability: "unavailable", tmdbId: 5 }),
      ),
    ).toBe(true);
    expect(isOwnedTitle(item())).toBe(false);
  });
});
