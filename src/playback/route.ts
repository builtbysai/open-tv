import type { Stream } from "../domain/content";
import { AppError } from "../domain/errors";
import { mediaUrl } from "../domain/urls";
import { limitedText } from "../providers/http";
import type { RelayConnection } from "./transport";

// How a media address reaches the player when the app is served over HTTPS, where plain
// HTTP is blocked as mixed content. One resolver, one fixed order, first route that works:
//   1. direct   the address is HTTPS already (and an HLS playlist doesn't pull in HTTP)
//   2. https    the same address over HTTPS answers with media (probed, never assumed)
//   3. host     the TV app fetches it for the page (/__http/ and /__https/ on its origin)
//   4. relay    the relay you configured, for the sources it allows
//   5. blocked  with the specific reason
// The winning route is kept per stream host for a day; a playback failure on it clears it
// and the resolver runs again once. Media never goes through anything you didn't set up.

export type Route = "direct" | "https" | "host" | "relay";
export type BlockedReason =
  "no-https" | "no-relay" | "relay-refused" | "host-ineligible";
export interface Resolution {
  url: string;
  route: Route;
  // The stream's host, under which the route is remembered.
  host: string;
  cached: boolean;
}
export interface PlaybackResolver {
  (
    url: string,
    signal: AbortSignal,
    format?: Stream["format"],
  ): Promise<Resolution>;
  // Forgets the remembered route for this address's host.
  invalidate?(url: string): void;
}
export const routeLabels: Record<Route, string> = {
  direct: "Direct over HTTPS",
  https: "The address's HTTPS version",
  host: "Through the TV app",
  relay: "Through your relay",
};
export class TransportBlocked extends AppError {
  constructor(
    readonly reason: BlockedReason,
    message: string,
  ) {
    super("authorization", message);
  }
}
const messages = {
  noHttps:
    "This HTTP source needs an authorized HTTPS endpoint or a configured HTTPS relay. Its HTTPS address did not answer. Settings → This device has the relay.",
  ipLiteral:
    "This HTTP source is a bare IP address, which has no HTTPS version. It needs the TV app or a configured HTTPS relay. Settings → This device has the relay.",
  mixed:
    "This HTTPS stream loads its video over plain HTTP, so it needs the TV app or a configured HTTPS relay. Settings → This device has the relay.",
  relay:
    "The configured relay could not authorize this source. Check its source allowlist, access secret and HTTPS connection.",
  credentials:
    "This address contains a user name or password, which Open TV never sends on your behalf. Use the provider's address without credentials.",
};

const KEY = "opentv:transport-routes:v1";
export const ROUTE_TTL = 24 * 3600 * 1000;
type Stored = Record<string, { route: Route; at: number }>;
const ROUTES: Route[] = ["direct", "https", "host", "relay"];

export interface TransportOptions {
  relay: RelayConnection | null;
  // Inside the Google TV app, whose host can fetch HTTP for the page.
  inApp?: boolean;
  // The page's own scheme and origin (only https: pages block plain HTTP).
  protocol?: string;
  origin?: string;
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
  fetcher?: typeof fetch;
  now?: () => number;
}

const ipLiteral = (host: string) =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith("[");

function read(storage: TransportOptions["storage"], now: number): Stored {
  try {
    const raw = JSON.parse(storage?.getItem(KEY) || "{}") as Stored;
    const kept: Stored = {};
    for (const [host, entry] of Object.entries(raw ?? {}))
      if (
        entry &&
        ROUTES.includes(entry.route) &&
        typeof entry.at === "number" &&
        now - entry.at < ROUTE_TTL
      )
        kept[host] = entry;
    return kept;
  } catch {
    return {};
  }
}
function write(storage: TransportOptions["storage"], stored: Stored) {
  try {
    // At most a few hundred hosts; the oldest go first.
    const entries = Object.entries(stored)
      .sort((a, b) => b[1].at - a[1].at)
      .slice(0, 300);
    storage?.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* Kept for this visit only. */
  }
}
export function rememberedRoutes(
  storage: TransportOptions["storage"] = safeStorage(),
  now = Date.now(),
): Stored {
  return read(storage, now);
}
export function forgetRoutes(
  storage: TransportOptions["storage"] = safeStorage(),
) {
  write(storage, {});
}
function safeStorage() {
  try {
    return localStorage;
  } catch {
    return null;
  }
}

// An HLS playlist that is HTTPS but lists HTTP variants, segments, keys or renditions is
// still mixed content. Checks the playlist and, for a master playlist, its first variant.
export async function playlistNeedsHttp(
  url: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<boolean> {
  const read = async (address: string) => {
    const response = await fetcher(address, {
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: AbortSignal.any([signal, AbortSignal.timeout(4000)]),
    });
    if (!response.ok) return null;
    return limitedText(response, 512_000);
  };
  const references = (text: string, base: string) =>
    text
      .split(/\r?\n/)
      .flatMap((line) => {
        const value = line.trim();
        if (!value) return [];
        if (!value.startsWith("#")) return [value];
        return [...value.matchAll(/URI="([^"]+)"/g)].map((m) => m[1]);
      })
      .map((value) => {
        try {
          return new URL(value, base).href;
        } catch {
          return "";
        }
      })
      .filter(Boolean);
  try {
    const master = await read(url);
    if (!master?.trimStart().startsWith("#EXTM3U")) return false;
    const refs = references(master, url);
    if (refs.some((ref) => ref.startsWith("http://"))) return true;
    if (!master.includes("#EXT-X-STREAM-INF")) return false;
    const variant = refs.find((ref) => /\.m3u8?(\?|$)/i.test(ref)) ?? refs[0];
    if (!variant) return false;
    const media = await read(variant);
    return (
      !!media && references(media, variant).some((r) => r.startsWith("http://"))
    );
  } catch {
    // Unreadable here means the player will find out; it isn't a reason to proxy.
    return false;
  }
}

// The same address over HTTPS: drops an explicit :80, keeps any other port. Only counts
// when it answers like media (a playlist, or a media or binary type).
export async function probeHttps(
  url: string,
  format: Stream["format"] | undefined,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<string | null> {
  const parsed = new URL(url);
  parsed.protocol = "https:";
  if (parsed.port === "80") parsed.port = "";
  const secure = parsed.href;
  const timeout = () => AbortSignal.any([signal, AbortSignal.timeout(3500)]);
  try {
    const response = await fetcher(secure, {
      headers: { Range: "bytes=0-2047" },
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: timeout(),
    });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") || "";
    if (
      /mpegurl|video|audio|octet-stream|mp2t|mp4|webm|ogg|aac|mpeg/i.test(type)
    )
      return secure;
    const start = (await response.text()).slice(0, 16);
    return start.startsWith("#EXTM3U") ? secure : null;
  } catch {
    if (signal.aborted) return null;
    // No CORS on the HTTPS twin: a player can't read a playlist from it, but a plain
    // video or audio file still plays. Confirm the server is there at all.
    if (format === "hls") return null;
    try {
      await fetcher(secure, {
        method: "HEAD",
        mode: "no-cors",
        cache: "no-store",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        signal: timeout(),
      });
      return secure;
    } catch {
      return null;
    }
  }
}

export function hostRouteUrl(url: string, origin: string): string | null {
  const target = new URL(url);
  if (target.username || target.password) return null;
  const prefix = target.protocol === "http:" ? "__http" : "__https";
  return `${origin}/${prefix}/${target.host}${target.pathname}${target.search}`;
}

async function relaySession(
  connection: RelayConnection,
  url: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetcher(`${connection.base}/v1/session`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${connection.secret}`,
      },
      body: JSON.stringify({ url }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
    });
  } catch {
    throw new TransportBlocked("relay-refused", messages.relay);
  }
  try {
    if (!response.ok) throw new Error();
    const result = JSON.parse(await limitedText(response, 20000)) as {
      playbackUrl?: string;
    };
    const target = result.playbackUrl && new URL(result.playbackUrl);
    if (
      !target ||
      target.origin !== connection.base ||
      !target.pathname.startsWith("/v1/resource/") ||
      target.username ||
      target.password ||
      target.search ||
      target.hash
    )
      throw new Error();
    return target.href;
  } catch {
    throw new TransportBlocked("relay-refused", messages.relay);
  }
}

export function createTransport(options: TransportOptions): PlaybackResolver {
  const fetcher = options.fetcher ?? ((...args) => fetch(...args));
  const now = options.now ?? Date.now;
  const storage =
    options.storage === undefined ? safeStorage() : options.storage;
  const protocol =
    options.protocol ??
    (typeof location === "undefined" ? "http:" : location.protocol);
  const origin =
    options.origin ?? (typeof location === "undefined" ? "" : location.origin);
  const inApp =
    options.inApp ??
    (typeof navigator !== "undefined" &&
      /OpenTVAndroid\//.test(navigator.userAgent));
  const relay = options.relay;
  const remember = (host: string, route: Route) => {
    const stored = read(storage, now());
    stored[host] = { route, at: now() };
    write(storage, stored);
  };
  const resolver: PlaybackResolver = async (input, signal, format) => {
    // Credentials in an address are never sent anywhere on your behalf.
    try {
      const raw = new URL(input);
      if (raw.username || raw.password)
        throw new TransportBlocked("host-ineligible", messages.credentials);
    } catch (error) {
      if (error instanceof TransportBlocked) throw error;
    }
    const url = mediaUrl(input);
    if (!url) throw new AppError("format", "This media address is not valid.");
    const parsed = new URL(url);
    const host = parsed.host;
    const done = (target: string, route: Route, cached = false): Resolution => {
      if (!cached) remember(host, route);
      return { url: target, route, host, cached };
    };
    // A user-chosen "relay for everything" applies to every source, as configured.
    if (relay?.mode === "all")
      return done(await relaySession(relay, url, signal, fetcher), "relay");
    const secureContext = protocol === "https:";
    const plain = parsed.protocol === "http:";
    // A plain-HTTP page can play HTTP itself; a relay you configured for HTTP sources is
    // still used for them, as configured.
    if (!secureContext)
      return plain && relay
        ? done(await relaySession(relay, url, signal, fetcher), "relay")
        : { url, route: "direct", host, cached: false };
    // Each route, when it can apply to this address.
    const via = async (route: Route): Promise<string | null> => {
      switch (route) {
        case "direct":
          return plain ? null : url;
        case "https":
          return plain && !ipLiteral(parsed.hostname)
            ? probeHttps(url, format, signal, fetcher)
            : null;
        case "host":
          return inApp ? hostRouteUrl(url, origin) : null;
        case "relay":
          return relay ? relaySession(relay, url, signal, fetcher) : null;
      }
    };
    // HTTPS playlists that pull in HTTP media count as HTTP from here on.
    let needsHttp = plain;
    if (!plain && format === "hls")
      needsHttp = await playlistNeedsHttp(url, signal, fetcher);
    // Direct is the normal case and needs no memory.
    if (!needsHttp) return { url, route: "direct", host, cached: false };
    const cached = read(storage, now())[host];
    if (cached && cached.route !== "direct") {
      const target = await via(cached.route).catch(() => null);
      if (target) return done(target, cached.route, true);
      // It no longer works: forget it before trying the rest.
      resolver.invalidate?.(url);
    }
    for (const route of ["https", "host", "relay"] as const) {
      if (route === "https" && !plain) continue;
      const target = await via(route);
      if (signal.aborted) throw new AppError("network", "Canceled.");
      if (target) return done(target, route);
    }
    // Blocked: say exactly why.
    if (!plain) throw new TransportBlocked("no-relay", messages.mixed);
    if (ipLiteral(parsed.hostname))
      throw new TransportBlocked("no-relay", messages.ipLiteral);
    throw new TransportBlocked("no-https", messages.noHttps);
  };
  resolver.invalidate = (input: string) => {
    try {
      const host = new URL(input).host;
      const stored = read(storage, now());
      if (stored[host]) {
        delete stored[host];
        write(storage, stored);
      }
    } catch {
      /* Nothing to forget. */
    }
  };
  return resolver;
}
