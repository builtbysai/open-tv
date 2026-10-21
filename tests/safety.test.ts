import { describe, expect, it } from "vitest";
import { item } from "./fixtures";
import { stableId } from "../src/domain/content";
import { applyContentPolicy } from "../src/domain/content-policy";
import { buildSearchIndex, queryCatalog } from "../src/domain/privacy";
import { publicReportUrl, validNotice } from "../src/domain/reporting";
import {
  readVideoHealth,
  saveVideoHealth,
  VIDEO_HEALTH_KEY,
} from "../src/persistence/video-health";
import { videoSample } from "../src/domain/video-sample";
const empty = {
  blockedContentIds: [],
  blockedProviderIds: [],
  blockedStreamIds: [],
};
const evidence = {
  status: "video-confirmed" as const,
  checkedAt: Date.now(),
  width: 1920,
  height: 1080,
  frames: 2,
  elapsedMs: 300,
};
describe("content reporting and restrictions", () => {
  it("blocks canonical/alias/provider identities and strips blocked alternatives before any playback fallback", () => {
    const content = item({
      aliases: ["ot-old"],
      streams: [
        { url: "https://a.example/a.m3u8", format: "hls" },
        { url: "https://b.example/a.m3u8", format: "hls" },
      ],
      externalUrl: "https://watch.example/film",
    });
    expect(
      applyContentPolicy([content], {
        ...empty,
        blockedContentIds: ["ot-old"],
      }),
    ).toEqual([]);
    expect(
      applyContentPolicy([content], { ...empty, blockedProviderIds: ["test"] }),
    ).toEqual([]);
    const filtered = applyContentPolicy([content], {
      ...empty,
      blockedStreamIds: [stableId(content.streams[0].url)],
    });
    expect(filtered[0].streams).toEqual([content.streams[1]]);
    expect(content.streams).toHaveLength(2);
    expect(
      applyContentPolicy([content], {
        ...empty,
        blockedStreamIds: content.streams.map((s) => stableId(s.url)),
      }),
    ).toEqual([]);
  });
  it("never prefills restricted references, contact details, untrusted source strings or media credentials in a public report", () => {
    const url = new URL(
      publicReportUrl(
        { id: "ot-123", providerId: "safe", restricted: false },
        "Incorrect age classification",
      ),
    );
    expect(url.searchParams.get("content_id")).toBe("ot-123");
    expect(
      new URL(
        publicReportUrl(undefined, "bad", "https://reports.example/form"),
      ).searchParams.has("template"),
    ).toBe(false);
    expect(() =>
      publicReportUrl(undefined, "bad", "javascript:alert(1)"),
    ).toThrow();
    expect(
      publicReportUrl(
        { id: "ot-private", providerId: "account", restricted: true },
        "bad",
      ),
    ).not.toContain("private");
    expect(
      publicReportUrl(
        {
          id: "https://host/?password=secret",
          providerId: "email@example.com",
          restricted: false,
        },
        "bad",
      ),
    ).not.toMatch(/password|secret|email/);
  });
  it("requires all formal notice fields and statutory statements without transmitting them", () => {
    const notice = {
      name: "Owner",
      email: "owner@example.com",
      address: "Contact address",
      work: "Work description",
      location: "Open TV listing ot-123",
      signature: "Owner",
      goodFaith: true,
      accurate: true,
    };
    expect(validNotice(notice)).toBe(true);
    expect(validNotice({ ...notice, accurate: false })).toBe(false);
    expect(validNotice({ ...notice, location: "" })).toBe(false);
    expect(validNotice({ ...notice, email: "not an email" })).toBe(false);
  });
});
describe("video evidence and indexed discovery", () => {
  it("keeps cached search equivalent to plain search and enforces privacy before matching", () => {
    const items = [
      item({ title: "Ｆilm News" }),
      item({ id: "ot-adult", title: "Film News", classification: "adult" }),
    ];
    expect(
      queryCatalog(items, {
        text: "film",
        searchIndex: buildSearchIndex(items),
      }),
    ).toEqual(queryCatalog(items, { text: "film" }));
    expect(
      queryCatalog(items, {
        text: "film",
        searchIndex: buildSearchIndex(items),
      }),
    ).toHaveLength(1);
  });
  it("expires old/malformed evidence and never stores canceled checks", () => {
    let text = "{}";
    const storage = {
      getItem: () => text,
      setItem: (_key: string, v: string) => {
        text = v;
      },
    };
    saveVideoHealth(storage, "ot-stream", evidence);
    expect(readVideoHealth(storage)["ot-stream"]).toEqual(evidence);
    expect(readVideoHealth(storage, evidence.checkedAt + 86400001)).toEqual({});
    saveVideoHealth(storage, "ot-canceled", { ...evidence, status: "aborted" });
    expect(text).not.toContain("canceled");
    text = JSON.stringify({
      "ot-bad": { ...evidence, width: -1 },
      "https://secret": evidence,
      "ot-forged": { ...evidence, width: 0, height: 0, frames: 0 },
    });
    expect(readVideoHealth(storage)).toEqual({});
    expect(VIDEO_HEALTH_KEY).toContain(":v1");
  });
  it("bounds samples, skips private/credential/recent/local sources and samples one stream per host", () => {
    const candidates = [
      item({ classification: "adult" }),
      item({
        streams: [
          {
            url: "https://host.example/token.m3u8?token=private",
            format: "hls",
          },
        ],
      }),
      item({
        streams: [{ url: "https://127.0.0.1/live.m3u8", format: "hls" }],
      }),
      ...Array.from({ length: 8 }, (_, i) =>
        item({
          id: `ot-${i}`,
          streams: [
            { url: `https://host${i}.example/live.m3u8`, format: "hls" },
          ],
        }),
      ),
    ];
    const recent = { [stableId("https://host0.example/live.m3u8")]: evidence };
    const sample = videoSample(candidates, recent);
    expect(sample).toHaveLength(4);
    expect(sample.map((s) => s.item.id)).toEqual([
      "ot-1",
      "ot-2",
      "ot-3",
      "ot-4",
    ]);
  });
});
