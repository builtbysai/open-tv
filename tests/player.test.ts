import type { Resolution } from "../src/playback/route";
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  PlayerService,
  type PlaybackSnapshot,
} from "../src/playback/player-service";
import { item } from "./fixtures";
import { AppError } from "../src/domain/errors";
class FakeVideo extends EventTarget {
  src = "";
  paused = true;
  ended = false;
  duration = 600;
  currentTime = 0;
  canPlayType() {
    return "probably";
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
afterEach(() => vi.useRealTimers());
describe("central player recovery and cleanup", () => {
  it("cancels pending relay authorization and ignores its late result after switching sources", async () => {
    let finish!: (value: Resolution) => void;
    const video = new FakeVideo(),
      pending = new Promise<Resolution>((resolve) => {
        finish = resolve;
      });
    let signal: AbortSignal | undefined;
    const service = new PlayerService(
      video as unknown as HTMLVideoElement,
      () => {},
      (url, abort) => {
        if (url.includes("first")) {
          signal = abort;
          return pending;
        }
        return Promise.resolve({
          url,
          route: "direct" as const,
          host: "media.example",
          cached: false,
        });
      },
    );
    const first = service.play(
      item({
        streams: [{ url: "https://media.example/first.mp4", format: "video" }],
      }),
    );
    await service.play(
      item({
        streams: [{ url: "https://media.example/second.mp4", format: "video" }],
      }),
    );
    expect(signal?.aborted).toBe(true);
    finish({
      url: "https://relay.example/expired-ticket.mp4",
      route: "relay",
      host: "media.example",
      cached: false,
    });
    await first;
    expect(video.src).toBe("https://media.example/second.mp4");
    service.destroy();
  });
  it("fails a rejected relay authorization once without playback or a retry loop", async () => {
    vi.useFakeTimers();
    const video = new FakeVideo(),
      states: PlaybackSnapshot[] = [],
      resolve = vi.fn(async () => {
        throw new Error("sensitive upstream detail");
      });
    const service = new PlayerService(
      video as unknown as HTMLVideoElement,
      (s) => states.push(s),
      resolve,
    );
    await service.play(item());
    await vi.advanceTimersByTimeAsync(90000);
    expect(resolve).toHaveBeenCalledTimes(1);
    expect(video.src).toBe("");
    expect(states.at(-1)?.phase).toBe("error");
    expect(JSON.stringify(states)).not.toContain("sensitive upstream");
    service.destroy();
  });
  it("retries a first network failure without flashing an error, and keeps the start position", async () => {
    const video = new FakeVideo(),
      states: PlaybackSnapshot[] = [];
    let calls = 0;
    const service = new PlayerService(
      video as unknown as HTMLVideoElement,
      (s) => states.push(s),
      async (url) => {
        if (++calls === 1)
          throw new AppError("network", "No music provider is answering.");
        return {
          url,
          route: "direct" as const,
          host: "media.example",
          cached: false,
        };
      },
    );
    await service.play(item(), 42);
    await vi.waitFor(() => expect(video.src).toContain("live.m3u8"));
    expect(calls).toBe(2);
    expect(states.map((s) => s.phase)).not.toContain("error");
    expect(states.map((s) => s.phase)).toContain("recovering");
    video.dispatchEvent(new Event("loadedmetadata"));
    expect(video.currentTime).toBe(42);
    service.destroy();
  });
  it("shows the real reason once a network failure outlasts the retry", async () => {
    const video = new FakeVideo(),
      states: PlaybackSnapshot[] = [];
    const resolve = vi.fn(async () => {
      throw new AppError("network", "No music provider is answering.");
    });
    const service = new PlayerService(
      video as unknown as HTMLVideoElement,
      (s) => states.push(s),
      resolve,
    );
    await service.play(item());
    await vi.waitFor(() => expect(states.at(-1)?.phase).toBe("error"));
    expect(resolve).toHaveBeenCalledTimes(2);
    expect(states.at(-1)?.message).toBe("No music provider is answering.");
    expect(states.filter((s) => s.phase === "error")).toHaveLength(1);
    service.destroy();
  });
  it("exhausts the recovery chain across same-item alternatives, even after a playing event", async () => {
    const video = new FakeVideo();
    const states: PlaybackSnapshot[] = [];
    const service = new PlayerService(
      video as unknown as HTMLVideoElement,
      (s) => states.push(s),
    );
    const content = item({
      streams: [
        { url: "https://example.com/a.m3u8", format: "hls" },
        { url: "https://example.com/b.m3u8", format: "hls" },
      ],
    });
    await service.play(content);
    video.dispatchEvent(new Event("error"));
    await Promise.resolve();
    expect(video.src).toContain("a.m3u8");
    video.dispatchEvent(new Event("playing"));
    video.dispatchEvent(new Event("error"));
    await Promise.resolve();
    expect(video.src).toContain("b.m3u8");
    video.dispatchEvent(new Event("error"));
    await Promise.resolve();
    expect(states.at(-1)?.phase).toBe("error");
    expect(video.src).toBe("");
    const count = states.length;
    video.dispatchEvent(new Event("error"));
    expect(states).toHaveLength(count);
    service.destroy();
  });
  it("cancels stalled recovery on close and starts a fresh budget only on explicit play", async () => {
    vi.useFakeTimers();
    const video = new FakeVideo();
    const states: PlaybackSnapshot[] = [];
    const service = new PlayerService(
      video as unknown as HTMLVideoElement,
      (s) => states.push(s),
    );
    await service.play(item());
    service.stop();
    await vi.advanceTimersByTimeAsync(90000);
    expect(states.at(-1)?.phase).toBe("idle");
    expect(video.src).toBe("");
    await service.play(item());
    video.dispatchEvent(new Event("error"));
    await Promise.resolve();
    expect(states.at(-1)?.phase).toBe("loading");
    service.destroy();
  });
});
