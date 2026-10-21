import { stableId, type Content } from "../src/domain/content";
export const item = (patch: Partial<Content> = {}): Content => ({
  id: stableId("channel"),
  providerId: "test",
  title: "Channel",
  type: "live",
  genres: ["News"],
  languages: ["English"],
  countries: ["GB"],
  classification: "general",
  availability: "playable",
  streams: [{ url: "https://example.com/live.m3u8", format: "hls" }],
  rights: { status: "provider-listed" },
  ...patch,
});
