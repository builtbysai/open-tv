import { describe, expect, it } from "vitest";
import {
  canDecode,
  chooseAudioTrack,
  codecName,
  transcodeAudioUrl,
  undecodableMessage,
  type CodecProbe,
} from "../src/playback/audio-tracks";
import {
  AUDIO_CHOICE_KEY,
  readAudioChoice,
  saveAudioChoice,
} from "../src/persistence/audio-choice";
import { seekStep } from "../src/playback/seek";

// A typical TV browser: AAC, MP3 and Opus, no Dolby or DTS.
const tv: CodecProbe = {
  isTypeSupported: (type) => /mp4a\.40\.2|mp4a\.40\.34|opus/.test(type),
  canPlayType: (type) => (type === "audio/mpeg" ? "probably" : ""),
};
const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
};

describe("audio track choice", () => {
  it("probes codecs with MediaSource and the media element", () => {
    expect(canDecode("mp4a.40.2", tv)).toBe("yes");
    expect(canDecode("mp3", tv)).toBe("yes");
    expect(canDecode("opus", tv)).toBe("yes");
    expect(canDecode("ac-3", tv)).toBe("no");
    expect(canDecode("ec-3", tv)).toBe("no");
    expect(canDecode("dtsc", tv)).toBe("no");
    expect(canDecode(undefined, tv)).toBe("unknown");
    expect(canDecode("ac-3", {})).toBe("unknown");
    expect(codecName("ec-3")).toBe("E-AC-3 (Dolby Digital Plus)");
  });
  it("prefers a decodable track over an undecodable default that comes first", () => {
    const choice = chooseAudioTrack(
      [
        { id: 0, codec: "ac-3", lang: "en", default: true, channels: 6 },
        { id: 1, codec: "mp4a.40.2", lang: "en", channels: 2 },
      ],
      { languages: ["en-US"], probe: tv },
    );
    expect(choice.id).toBe(1);
    expect(choice.undecodable).toEqual(["AC-3 (Dolby Digital)"]);
    expect(choice.fallback).toMatch(/AAC.*AC-3/);
  });
  it("lets language decide among decodable tracks, never over decodability", () => {
    const tracks = [
      { id: 0, codec: "ec-3", lang: "fr", default: true },
      { id: 1, codec: "mp4a.40.2", lang: "en" },
      { id: 2, codec: "mp4a.40.2", lang: "fr" },
    ];
    expect(
      chooseAudioTrack(tracks, { languages: ["fr-FR"], probe: tv }).id,
    ).toBe(2);
    expect(chooseAudioTrack(tracks, { languages: ["en"], probe: tv }).id).toBe(
      1,
    );
    expect(chooseAudioTrack(tracks, { languages: ["de"], probe: tv }).id).toBe(
      1,
    );
  });
  it("keeps the default when it is decodable and no language matches", () => {
    const choice = chooseAudioTrack(
      [
        { id: 0, codec: "mp4a.40.2", lang: "ja" },
        { id: 1, codec: "mp4a.40.2", lang: "ko", default: true },
      ],
      { languages: ["en"], probe: tv },
    );
    expect(choice.id).toBe(1);
    expect(choice.fallback).toBeUndefined();
  });
  it("honours the viewer's remembered track when it can be decoded", () => {
    const tracks = [
      { id: 0, codec: "mp4a.40.2", lang: "en", default: true },
      { id: 1, codec: "mp4a.40.2", lang: "es" },
      { id: 2, codec: "ac-3", lang: "de" },
    ];
    const probe = tv;
    expect(
      chooseAudioTrack(tracks, {
        languages: ["en"],
        probe,
        remembered: { lang: "es" },
      }).id,
    ).toBe(1);
    expect(
      chooseAudioTrack(tracks, {
        languages: ["en"],
        probe,
        remembered: { lang: "de" },
      }).id,
    ).toBe(0);
  });
  it("reports no track when none is decodable, naming the codecs", () => {
    const choice = chooseAudioTrack(
      [
        { id: 0, codec: "ac-3", default: true },
        { id: 1, codec: "dtsc" },
      ],
      { probe: tv },
    );
    expect(choice.id).toBeNull();
    expect(choice.undecodable).toEqual(["AC-3 (Dolby Digital)", "DTS"]);
    expect(undecodableMessage(choice.undecodable)).toMatch(
      /AC-3 \(Dolby Digital\), DTS, which this device can't play/,
    );
  });
  it("never rejects a track whose codec nobody named", () => {
    expect(chooseAudioTrack([{ id: 0 }], { probe: tv }).id).toBe(0);
  });
  it("asks a Jellyfin or Emby server to convert the audio to AAC", () => {
    const hls = transcodeAudioUrl(
      "https://media.example/Videos/abc/master.m3u8?MediaSourceId=abc&api_key=k&AudioCodec=aac,mp3,ac3",
    )!;
    const url = new URL(hls);
    expect(url.pathname).toBe("/Videos/abc/master.m3u8");
    expect(url.searchParams.get("AudioCodec")).toBe("aac");
    expect(url.searchParams.get("AllowAudioStreamCopy")).toBe("false");
    expect(url.searchParams.get("api_key")).toBe("k");
    const file = new URL(
      transcodeAudioUrl(
        "https://media.example/emby/Videos/9/stream.mkv?static=true&api_key=k",
      )!,
    );
    expect(file.pathname).toBe("/emby/Videos/9/master.m3u8");
    expect(file.searchParams.has("static")).toBe(false);
    // Asked once: an address that already asks for converted AAC is not asked again.
    expect(transcodeAudioUrl(hls)).toBeNull();
    expect(transcodeAudioUrl("https://cdn.example/movie.mkv")).toBeNull();
  });
});

describe("remembered audio choice", () => {
  it("is kept per title, small and bounded", () => {
    const storage = memory();
    saveAudioChoice(storage, "title-1", { lang: "es", codec: "mp4a.40.2" });
    expect(readAudioChoice(storage, "title-1")).toEqual({
      lang: "es",
      codec: "mp4a.40.2",
      name: undefined,
    });
    for (let i = 0; i < 150; i++)
      saveAudioChoice(storage, `t${i}`, { lang: "en", name: "x".repeat(500) });
    const saved = JSON.parse(storage.getItem(AUDIO_CHOICE_KEY)!);
    expect(Object.keys(saved)).toHaveLength(100);
    expect(readAudioChoice(storage, "title-1")).toBeUndefined();
    expect(readAudioChoice(storage, "t149")?.name).toHaveLength(80);
  });
  it("survives broken storage", () => {
    const storage = memory();
    storage.setItem(AUDIO_CHOICE_KEY, "{not json");
    expect(readAudioChoice(storage, "a")).toBeUndefined();
  });
});

describe("held seek keys", () => {
  it("step by the base amount, then faster the longer the key is held", () => {
    expect(seekStep(10, 0)).toBe(10);
    expect(seekStep(10, 1500)).toBe(30);
    expect(seekStep(10, 5000)).toBe(60);
    expect(seekStep(30, 1500)).toBe(30);
  });
});
