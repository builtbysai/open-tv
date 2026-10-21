import type { Stream } from "../domain/content";
import { mediaUrl, mixedContent } from "../domain/urls";
import { AppError } from "../domain/errors";
import type { PlaybackResolver, Route } from "./route";
import type Hls from "hls.js";

export type ProbeStatus =
  | "video-confirmed"
  | "audio-only"
  | "unconfirmed"
  | "blocked"
  | "unsupported"
  | "failed"
  | "aborted";
export interface VideoEvidence {
  status: ProbeStatus;
  // How the sample reached the player, or why it couldn't.
  route?: Route;
  blocked?: string;
  checkedAt: number;
  width: number;
  height: number;
  frames: number;
  elapsedMs: number;
}
export interface ProbeOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  resolveUrl?: PlaybackResolver;
}

/** A short, muted decode sample. An HTTP response or a playlist alone never passes. */
export function probeVideo(
  video: HTMLVideoElement,
  stream: Stream,
  options: ProbeOptions = {},
): Promise<VideoEvidence> {
  return new Promise((resolve) => {
    const started = performance.now(),
      abort = new AbortController();
    let finished = false,
      hls: Hls | undefined,
      frameId: number | undefined,
      frames = 0,
      previousTime = -1;
    let timer: ReturnType<typeof setTimeout> | undefined,
      interval: ReturnType<typeof setInterval> | undefined;
    const listeners: [string, EventListener][] = [];
    const hidden = () => {
      if (document.visibilityState === "hidden") canceled();
    };
    let route: Route | undefined, blocked: string | undefined;
    const finish = (status: ProbeStatus) => {
      if (finished) return;
      finished = true;
      const result: VideoEvidence = {
        status,
        ...(route ? { route } : {}),
        ...(blocked ? { blocked } : {}),
        checkedAt: Date.now(),
        width: video.videoWidth,
        height: video.videoHeight,
        frames,
        elapsedMs: Math.round(performance.now() - started),
      };
      abort.abort();
      clearTimeout(timer);
      clearInterval(interval);
      options.signal?.removeEventListener("abort", canceled);
      document.removeEventListener("visibilitychange", hidden);
      window.removeEventListener("opentv:suspend", canceled);
      for (const [name, fn] of listeners) video.removeEventListener(name, fn);
      if (frameId !== undefined) video.cancelVideoFrameCallback?.(frameId);
      hls?.destroy();
      video.pause();
      video.removeAttribute("src");
      video.load();
      resolve(result);
    };
    const canceled = () => finish("aborted");
    const listen = (name: string, fn: EventListener) => {
      listeners.push([name, fn]);
      video.addEventListener(name, fn);
    };
    const observeFrame: VideoFrameRequestCallback = (_now, metadata) => {
      if (finished) return;
      if (metadata.mediaTime !== previousTime) {
        frames++;
        previousTime = metadata.mediaTime;
      }
      if (video.videoWidth > 0 && video.videoHeight > 0 && frames >= 2)
        finish("video-confirmed");
      else frameId = video.requestVideoFrameCallback(observeFrame);
    };
    const start = async () => {
      if (options.signal?.aborted) {
        finish("aborted");
        return;
      }
      options.signal?.addEventListener("abort", canceled, { once: true });
      if (document.visibilityState === "hidden") {
        finish("aborted");
        return;
      }
      document.addEventListener("visibilitychange", hidden);
      window.addEventListener("opentv:suspend", canceled);
      if (stream.format === "embed") {
        finish("unsupported");
        return;
      }
      let url = mediaUrl(stream.url);
      if (!url) {
        finish("unsupported");
        return;
      }
      timer = setTimeout(
        () => finish("unconfirmed"),
        Math.max(1000, Math.min(options.timeoutMs ?? 12000, 15000)),
      );
      try {
        if (options.resolveUrl) {
          try {
            const resolved = await options.resolveUrl(
              url,
              abort.signal,
              stream.format,
            );
            url = resolved.url;
            route = resolved.route;
          } catch (error) {
            if (finished) return;
            blocked = error instanceof AppError ? error.message : undefined;
            finish("blocked");
            return;
          }
        }
        if (finished) return;
        if (mixedContent(url)) {
          finish("blocked");
          return;
        }
        video.muted = true;
        video.volume = 0;
        video.playsInline = true;
        video.preload = "auto";
        listen("error", () => finish("failed"));
        if (video.requestVideoFrameCallback)
          frameId = video.requestVideoFrameCallback(observeFrame);
        interval = setInterval(() => {
          if (video.videoWidth > 0 && video.videoHeight > 0) {
            // Older WebViews can expose decoded-frame evidence without the callback API.
            if (!video.requestVideoFrameCallback) {
              frames = video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
              if (frames >= 2 && video.currentTime > 0.1)
                finish("video-confirmed");
            }
          } else if (video.readyState >= 2 && video.currentTime > 0.75)
            finish("audio-only");
        }, 100);
        if (
          stream.format === "hls" &&
          !video.canPlayType("application/vnd.apple.mpegurl")
        ) {
          const { default: HlsClass } = await import("hls.js");
          if (finished) return;
          if (!HlsClass.isSupported()) {
            finish("unsupported");
            return;
          }
          hls = new HlsClass({
            lowLatencyMode: false,
            maxBufferLength: 2,
            maxMaxBufferLength: 3,
            backBufferLength: 0,
            maxBufferSize: 2_000_000,
            startLevel: 0,
            manifestLoadingMaxRetry: 0,
            levelLoadingMaxRetry: 0,
            fragLoadingMaxRetry: 0,
          });
          hls.on(HlsClass.Events.ERROR, (_event, data) => {
            if (data.fatal) finish("failed");
          });
          hls.on(HlsClass.Events.MANIFEST_PARSED, () => {
            if (!finished) {
              hls!.autoLevelCapping = 0;
              void video.play().catch(() => finish("unconfirmed"));
            }
          });
          hls.attachMedia(video);
          hls.loadSource(url);
        } else {
          video.src = url;
          await video.play();
        }
      } catch {
        if (!finished) finish(abort.signal.aborted ? "aborted" : "failed");
      }
    };
    void start();
  });
}
