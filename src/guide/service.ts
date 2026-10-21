import type { GuideProgram } from "../providers/contracts";
import { parseXMLTV } from "../providers/epg";
import { limitedText, sourceFetch } from "../providers/http";
import { mediaUrl, mixedContent } from "../domain/urls";
import { hostRouteUrl } from "../playback/route";

export const GUIDE_REFRESH_MS = 2 * 3600000;
export interface GuideSnapshot {
  programs: GuideProgram[];
  source: "none" | "file" | "remote";
  status: "empty" | "loading" | "ready" | "error";
  loadedAt: number;
  attemptAt: number;
  nextCheckAt: number;
  failures: number;
  // Plain words for the last failure.
  reason?: string;
}
// What went wrong, for the person reading the status line.
export function guideFailureReason(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError")
    return "The guide did not arrive within 45 seconds. It may be large; try again.";
  if (error instanceof TypeError)
    return "The browser could not reach the guide. It may be offline, or the host does not allow this site (CORS).";
  const text = error instanceof Error ? error.message : "";
  if (text === "unreachable")
    return "The TV app could not reach the guide host. It may be offline, or the address is wrong.";
  if (/exceeds|oversized/i.test(text))
    return "The guide is larger than 10 MB. Use a smaller regional guide.";
  if (/status (\d{3})/.test(text))
    return `The guide host answered with an error (${/status (\d{3})/.exec(text)?.[1]}).`;
  if (/redirect/i.test(text))
    return "The guide redirected somewhere that is not secure.";
  return "The file did not look like an XMLTV guide.";
}
// The status line over the schedule. Until a guide has loaded there is no last schedule to
// fall back on, so a failure says the guide hasn't loaded and why.
export function guideStatusText(
  state: Pick<GuideSnapshot, "status" | "source" | "loadedAt" | "reason">,
): string {
  const loaded = state.loadedAt > 0;
  if (state.status === "loading")
    return loaded ? "Refreshing your guide…" : "Loading your guide…";
  if (state.status === "error")
    return loaded
      ? "Refresh unavailable · showing the last schedule"
      : `The guide hasn’t loaded yet. ${state.reason ?? "It could not be fetched."}`;
  if (!loaded) return "The guide hasn’t loaded yet.";
  return `${state.source === "file" ? "Imported" : "Updated"} ${new Date(state.loadedAt).toLocaleString()}`;
}
// Inside the TV app the host fetches the guide natively (/__https/ on the app's origin): no
// CORS, and redirects are followed there, so a short address that hands the file on through
// a host without CORS headers still works.
export function guideFetchUrl(
  url: string,
  inApp = typeof navigator !== "undefined" &&
    /OpenTVAndroid\//.test(navigator.userAgent),
  origin = typeof location === "undefined" ? "" : location.origin,
): string {
  return (inApp && origin && hostRouteUrl(url, origin)) || url;
}
const empty = (): GuideSnapshot => ({
  programs: [],
  source: "none",
  status: "empty",
  loadedAt: 0,
  attemptAt: 0,
  nextCheckAt: 0,
  failures: 0,
});

// URLs (including authorized query tokens), schedules and validators stay in
// this instance. Nothing is written to profile storage, diagnostics or exports.
export class GuideService {
  private state = empty();
  private endpoint: string | null = null;
  private listeners = new Set<(state: GuideSnapshot) => void>();
  private active?: { controller: AbortController; promise: Promise<void> };
  private generation = 0;
  constructor(
    private fetcher: typeof sourceFetch = sourceFetch,
    private parse = parseXMLTV,
    private now = Date.now,
    private route: (url: string) => string = guideFetchUrl,
  ) {}
  get snapshot() {
    return this.state;
  }
  subscribe(listener: (state: GuideSnapshot) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  private publish(state: GuideSnapshot) {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
  cancel() {
    this.active?.controller.abort();
  }
  clear() {
    this.generation++;
    this.cancel();
    this.active = undefined;
    this.endpoint = null;
    this.publish(empty());
  }
  import(programs: GuideProgram[]) {
    this.clear();
    this.publish({
      ...empty(),
      programs,
      source: "file",
      status: "ready",
      loadedAt: this.now(),
    });
  }
  connect(value: string): Promise<void> {
    const endpoint = mediaUrl(value.trim());
    if (
      !endpoint ||
      value.length > 8192 ||
      new URL(endpoint).protocol !== "https:" ||
      new URL(endpoint).hash ||
      mixedContent(endpoint)
    )
      return Promise.reject(
        new Error(
          "Enter an HTTPS XMLTV address without a login or fragment. HTTP guides can be imported as files.",
        ),
      );
    if (endpoint === this.endpoint) return this.check(true);
    this.clear();
    this.endpoint = endpoint;
    this.publish({ ...empty(), source: "remote" });
    return this.check(true);
  }
  check(force = false): Promise<void> {
    if (this.active) return this.active.promise;
    const now = this.now();
    if (
      !this.endpoint ||
      (!force && now < this.state.nextCheckAt) ||
      (this.state.attemptAt > 0 && now - this.state.attemptAt < 15000)
    )
      return Promise.resolve();
    const controller = new AbortController(),
      generation = this.generation;
    const previous = this.state,
      endpoint = this.endpoint;
    this.publish({ ...previous, status: "loading", attemptAt: now });
    const run = async () => {
      try {
        const signal = AbortSignal.any([
          controller.signal,
          AbortSignal.timeout(45000),
        ]);
        // A guide host may hand the file on (a short address that redirects to where it is
        // stored); only an HTTPS destination without a login is accepted.
        const address = this.route(endpoint);
        const response = await this.fetcher(address, {
          signal,
          credentials: "omit",
          cache: "no-cache",
          redirect: "follow",
          referrerPolicy: "no-referrer",
        });
        // Through the TV app, the host reports where its own redirects ended.
        const landed =
          address !== endpoint
            ? response.headers.get("x-open-tv-url")
            : response.redirected
              ? response.url
              : null;
        if (landed) {
          const target = new URL(landed);
          if (
            target.protocol !== "https:" ||
            target.username ||
            target.password
          )
            throw new Error("redirect");
        }
        if (!response.ok)
          throw new Error(
            address !== endpoint &&
              response.statusText === "Could not reach the server"
              ? "unreachable"
              : `status ${response.status}`,
          );
        const text = await limitedText(response, 10000000);
        signal.throwIfAborted();
        const programs = this.parse(text);
        if (!programs.length) throw new Error();
        if (generation !== this.generation || controller.signal.aborted) return;
        const at = this.now();
        this.publish({
          programs,
          source: "remote",
          status: "ready",
          loadedAt: at,
          attemptAt: now,
          nextCheckAt: at + GUIDE_REFRESH_MS,
          failures: 0,
        });
      } catch (error) {
        if (generation !== this.generation) return;
        if (controller.signal.aborted) {
          this.publish({ ...previous, attemptAt: now });
        } else {
          const failures = Math.min(previous.failures + 1, 10);
          this.publish({
            ...previous,
            status: "error",
            attemptAt: now,
            failures,
            reason: guideFailureReason(error),
            nextCheckAt:
              this.now() + Math.min(6 * 3600000, 60000 * 2 ** (failures - 1)),
          });
        }
      } finally {
        if (this.active?.controller === controller) this.active = undefined;
      }
    };
    const promise = Promise.resolve().then(run);
    this.active = { controller, promise };
    return promise;
  }
}
