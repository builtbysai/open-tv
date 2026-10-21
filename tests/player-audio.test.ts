import { describe, expect, it, vi } from "vitest";
import {
  PlayerService,
  type PlaybackSnapshot,
} from "../src/playback/player-service";
import { item } from "./fixtures";

type Handler = (event: string, data?: unknown) => void;
const instances: FakeHls[] = [];
class FakeHls {
  static Events = {
    MANIFEST_LOADED: "manifestLoaded",
    MANIFEST_PARSED: "manifestParsed",
    AUDIO_TRACKS_UPDATED: "audioTracksUpdated",
    SUBTITLE_TRACKS_UPDATED: "subtitleTracksUpdated",
    ERROR: "error",
  };
  static ErrorDetails = {
    MANIFEST_INCOMPATIBLE_CODECS_ERROR: "manifestIncompatibleCodecsError",
    BUFFER_INCOMPATIBLE_CODECS_ERROR: "bufferIncompatibleCodecsError",
    BUFFER_ADD_CODEC_ERROR: "bufferAddCodecError",
  };
  static isSupported = () => true;
  handlers = new Map<string, Handler[]>();
  levels: { height: number; bitrate: number; audioCodec?: string }[] = [];
  audioTracks: unknown[] = [];
  subtitleTracks: unknown[] = [];
  audioTrack = 0;
  source = "";
  constructor() {
    instances.push(this);
  }
  on(event: string, handler: Handler) {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), handler]);
  }
  emit(event: string, data?: unknown) {
    for (const handler of this.handlers.get(event) ?? []) handler(event, data);
  }
  attachMedia() {}
  loadSource(url: string) {
    this.source = url;
  }
  destroy() {}
}
vi.mock("hls.js", () => ({ default: FakeHls }));

// A browser with MediaSource for AAC but no Dolby or DTS, and no native HLS.
class FakeVideo extends EventTarget {
  src = "";
  paused = true;
  ended = false;
  duration = 600;
  currentTime = 0;
  canPlayType(type: string) {
    return /mp4a\.40\.2|audio\/mpeg/.test(type) ? "probably" : "";
  }
  async play() {
    this.paused = false;
  }
  pause() {
    this.paused = true;
  }
  removeAttribute() {
    this.src = "";
  }
  load() {}
}
const track = (
  name: string,
  lang: string,
  audioCodec: string,
  def = false,
) => ({
  name,
  lang,
  audioCodec,
  channels: audioCodec === "ac-3" ? "6" : "2",
  default: def,
});
async function start(url: string) {
  const video = new FakeVideo();
  const states: PlaybackSnapshot[] = [];
  const service = new PlayerService(
    video as unknown as HTMLVideoElement,
    (s) => states.push(s),
    async (address) => ({
      url: address,
      route: "direct" as const,
      host: "media.example",
      cached: false,
    }),
  );
  await service.play(item({ streams: [{ url, format: "hls" }] }));
  return { service, states, hls: instances.at(-1)! };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("player audio track choice", () => {
  it("switches hls.js to the decodable track and says why", async () => {
    const { service, states, hls } = await start(
      "https://cdn.example/movie/master.m3u8",
    );
    hls.audioTracks = [
      track("English 5.1", "en", "ac-3", true),
      track("English", "en", "mp4a.40.2"),
    ];
    hls.emit(FakeHls.Events.AUDIO_TRACKS_UPDATED);
    expect(hls.audioTrack).toBe(1);
    const last = states.at(-1)!;
    expect(last.audioId).toBe(1);
    expect(last.audioNote).toMatch(/can't play AC-3/);
    expect(last.audio.map((t) => t.label)).toEqual([
      "English 5.1 · AC-3 (Dolby Digital) · 6 ch · can't play here",
      "English · AAC · 2 ch",
    ]);
    service.destroy();
  });
  it("asks a Jellyfin server to convert audio it cannot decode", async () => {
    const { service, states, hls } = await start(
      "https://jf.example/Videos/abc/master.m3u8?api_key=k&AudioCodec=ac3",
    );
    hls.audioTracks = [track("English", "en", "ac-3", true)];
    hls.emit(FakeHls.Events.AUDIO_TRACKS_UPDATED);
    await settle();
    const converted = new URL(instances.at(-1)!.source);
    expect(instances.at(-1)).not.toBe(hls);
    expect(converted.searchParams.get("AudioCodec")).toBe("aac");
    expect(states.at(-1)?.phase).not.toBe("error");
    service.destroy();
  });
  it("fails honestly, naming the codec, when nothing can play the audio", async () => {
    const { service, states, hls } = await start(
      "https://cdn.example/movie/master.m3u8",
    );
    hls.emit(FakeHls.Events.MANIFEST_LOADED, {
      audioTracks: [],
      levels: [{ audioCodec: "ec-3" }],
    });
    hls.emit(FakeHls.Events.ERROR, {
      details: FakeHls.ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR,
      fatal: true,
    });
    await settle();
    const last = states.at(-1)!;
    expect(last.phase).toBe("error");
    expect(last.message).toMatch(
      /E-AC-3 \(Dolby Digital Plus\), which this device can't play/,
    );
    service.destroy();
  });
});
