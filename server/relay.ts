import http, { type IncomingMessage, type ServerResponse } from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIP } from "node:net";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export interface RelaySource {
  id: string;
  url: string;
  allowedOrigins: string[];
  allowPrivateHosts?: string[];
  allowedPathPrefixes?: string[];
}
export interface RelayConfig {
  publicBase?: string;
  origins: string[];
  sources: RelaySource[];
  port?: number;
  maxConcurrent?: number;
  requestsPerMinute?: number;
}
interface Ticket {
  source: string;
  url: string;
  expires: number;
}
class RelayError extends Error {
  status: number;
  constructor(status: number) {
    super("relay-request-failed");
    this.status = status;
  }
}
const hostname = (url: URL) => url.hostname.replace(/^\[|\]$/g, "");
function upstreamUrl(value: string): URL {
  const url = new URL(value);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.hostname.includes("*") ||
    url.hash ||
    value.length > 8192
  )
    throw new RelayError(403);
  return url;
}
export function publicAddress(value: string): boolean {
  if (isIP(value) === 4) {
    const [a, b, c] = value.split(".").map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  // Reject mapped, transition, local, multicast and documentation IPv6 space.
  return (
    isIP(value) === 6 &&
    /^[23][0-9a-f]{3}:/i.test(value) &&
    !/^(2001:(?:0{1,4}:|0?db8:|0{0,3}2:|0{0,2}10:|0{0,2}20:)|2002:|3fff:)/i.test(
      value,
    )
  );
}
export function validateConfig(value: RelayConfig): RelayConfig {
  if (
    !value ||
    !Array.isArray(value.sources) ||
    value.sources.length > 100 ||
    !Array.isArray(value.origins) ||
    !value.origins.length
  )
    throw new Error(
      "Configure explicit viewer origins and at most 100 authorized sources.",
    );
  for (const origin of value.origins) {
    const url = upstreamUrl(origin);
    if (url.origin !== origin)
      throw new Error("Viewer origins must be exact HTTP(S) origins.");
  }
  if (value.publicBase) {
    const base = upstreamUrl(value.publicBase);
    if (
      base.origin !== value.publicBase ||
      (base.protocol !== "https:" &&
        !["127.0.0.1", "localhost", "::1"].includes(hostname(base)))
    )
      throw new Error(
        "Use an HTTPS publicBase, or loopback HTTP for local tests.",
      );
  }
  const ids = new Set<string>();
  for (const source of value.sources) {
    if (
      !source ||
      !/^[a-z0-9_-]{1,80}$/i.test(source.id) ||
      ids.has(source.id) ||
      !Array.isArray(source.allowedOrigins) ||
      !source.allowedOrigins.length ||
      source.allowedOrigins.length > 20
    )
      throw new Error("Invalid or duplicate relay source.");
    ids.add(source.id);
    const url = upstreamUrl(source.url);
    for (const origin of source.allowedOrigins)
      if (upstreamUrl(origin).origin !== origin)
        throw new Error(
          "Upstream origins must be exact origins, with no wildcards.",
        );
    if (!source.allowedOrigins.includes(url.origin))
      throw new Error("Entry point origin is not allowed.");
    if (
      source.allowedPathPrefixes &&
      (!Array.isArray(source.allowedPathPrefixes) ||
        !source.allowedPathPrefixes.length ||
        source.allowedPathPrefixes.length > 20 ||
        source.allowedPathPrefixes.some(
          (prefix) =>
            typeof prefix !== "string" ||
            !prefix.startsWith("/") ||
            !prefix.endsWith("/") ||
            /[?%#\\]/.test(prefix) ||
            prefix.split("/").some((part) => part === ".." || part === "."),
        ))
    )
      throw new Error("Use explicit normalized directory path prefixes.");
    assertDestination(url, source);
    if (
      source.allowPrivateHosts &&
      (!Array.isArray(source.allowPrivateHosts) ||
        source.allowPrivateHosts.some(
          (h) => typeof h !== "string" || !h || /[\s/*]/.test(h),
        ))
    )
      throw new Error(
        "Private host exceptions must be explicit administrator-owned hosts.",
      );
  }
  return value;
}
export function seal(ticket: Ticket, secret: string): string {
  const iv = randomBytes(12),
    key = createHash("sha256").update(secret).digest(),
    cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(JSON.stringify(ticket)),
    cipher.final(),
  ]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString(
    "base64url",
  );
}
export function unseal(
  token: string,
  secret: string,
  now = Date.now(),
): Ticket {
  try {
    if (token.length > 16000 || !/^[\w-]+$/.test(token)) throw new Error();
    const bytes = Buffer.from(token, "base64url"),
      decipher = createDecipheriv(
        "aes-256-gcm",
        createHash("sha256").update(secret).digest(),
        bytes.subarray(0, 12),
      );
    decipher.setAuthTag(bytes.subarray(12, 28));
    const result = JSON.parse(
      Buffer.concat([
        decipher.update(bytes.subarray(28)),
        decipher.final(),
      ]).toString(),
    ) as Ticket;
    if (
      !result ||
      typeof result.source !== "string" ||
      typeof result.url !== "string" ||
      !Number.isFinite(result.expires) ||
      result.expires <= now ||
      result.expires > now + 6 * 3600000 + 60000
    )
      throw new Error();
    return result;
  } catch {
    throw new RelayError(403);
  }
}
function assertDestination(url: URL, source: RelaySource) {
  if (!source.allowedOrigins.includes(url.origin)) throw new RelayError(403);
  let pathname: string;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    throw new RelayError(403);
  }
  if (
    /[\\\u0000-\u001f]/.test(pathname) ||
    /%[a-f0-9]{2}/i.test(pathname) ||
    pathname.split("/").some((part) => part === ".." || part === ".")
  )
    throw new RelayError(403);
  const entryPath = decodeURIComponent(new URL(source.url).pathname);
  const prefixes = source.allowedPathPrefixes || [
    entryPath.slice(0, entryPath.lastIndexOf("/") + 1),
  ];
  if (!prefixes.some((prefix) => pathname.startsWith(prefix)))
    throw new RelayError(403);
}
export function createDnsResolver(
  resolve: (host: string) => Promise<LookupAddress[]> = (host) =>
    lookup(host, { all: true }),
  now = Date.now,
) {
  const cache = new Map<
    string,
    { expires: number; promise: Promise<LookupAddress[]> }
  >();
  return async (
    host: string,
    signal: AbortSignal,
  ): Promise<LookupAddress[]> => {
    if (signal.aborted) throw new RelayError(499);
    const family = isIP(host);
    if (family) return [{ address: host, family }];
    let entry = cache.get(host);
    if (!entry || entry.expires <= now()) {
      const promise = new Promise<LookupAddress[]>((accept, reject) => {
        const timer = setTimeout(() => reject(new RelayError(504)), 5000);
        resolve(host).then(
          (addresses) => {
            clearTimeout(timer);
            accept(addresses);
          },
          (error) => {
            clearTimeout(timer);
            reject(error);
          },
        );
      });
      if (cache.size >= 128) cache.delete(cache.keys().next().value!);
      entry = { expires: now() + 30000, promise };
      cache.set(host, entry);
      const current = entry;
      void promise.catch(() => {
        if (cache.get(host) === current) cache.delete(host);
      });
    }
    return new Promise((accept, reject) => {
      const canceled = () => reject(new RelayError(499));
      signal.addEventListener("abort", canceled, { once: true });
      entry!.promise.then(
        (addresses) => {
          signal.removeEventListener("abort", canceled);
          if (signal.aborted) reject(new RelayError(499));
          else accept(addresses);
        },
        (error) => {
          signal.removeEventListener("abort", canceled);
          reject(error);
        },
      );
    });
  };
}
/** DNS is checked and the selected address pinned to the connection, including redirects. */
async function connect(
  url: URL,
  source: RelaySource,
  method: string,
  headers: http.OutgoingHttpHeaders,
  signal: AbortSignal,
  resolveDns: ReturnType<typeof createDnsResolver>,
  redirects = 0,
): Promise<IncomingMessage> {
  assertDestination(url, source);
  const host = hostname(url),
    addresses = await resolveDns(host, signal);
  if (
    !addresses.length ||
    (!source.allowPrivateHosts?.includes(host) &&
      addresses.some((a) => !publicAddress(a.address)))
  )
    throw new RelayError(403);
  if (signal.aborted) throw new RelayError(499);
  const address = addresses[0];
  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method,
        headers: { ...headers, "accept-encoding": "identity" },
        signal,
        family: address.family,
        lookup: (_name, _options, callback) =>
          callback(null, address.address, address.family),
      },
      resolve,
    );
    request.setTimeout(20000, () =>
      request.destroy(new Error("upstream-timeout")),
    );
    request.once("error", reject);
    request.end();
  });
  (response as IncomingMessage & { relayFinalUrl: URL }).relayFinalUrl = url;
  if (
    response.statusCode &&
    response.statusCode >= 300 &&
    response.statusCode < 400
  ) {
    const location = response.headers.location;
    response.destroy();
    if (!location || redirects >= 3) throw new RelayError(502);
    return connect(
      upstreamUrl(new URL(location, url).href),
      source,
      method,
      headers,
      signal,
      resolveDns,
      redirects + 1,
    );
  }
  return response;
}
async function smallBody(
  input: AsyncIterable<Buffer | string>,
  limit: number,
): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of input) {
    const b = Buffer.from(chunk);
    length += b.length;
    if (length > limit) throw new RelayError(413);
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}
export function rewriteHls(
  text: string,
  base: URL,
  source: RelaySource,
  resource: (url: string) => string,
): string {
  if (!text.trimStart().startsWith("#EXTM3U")) throw new RelayError(502);
  const replace = (value: string) => {
    // Variable substitution requires a provider-aware parser; fail closed rather than relay a wrong target.
    if (value.includes("{$")) throw new RelayError(422);
    const url = upstreamUrl(new URL(value, base).href);
    assertDestination(url, source);
    return resource(url.href);
  };
  return text
    .split(/\r?\n/)
    .map((line) => {
      if (!line.trim()) return line;
      return line.startsWith("#")
        ? line.replace(
            /URI="([^"]+)"/g,
            (_match, uri: string) => `URI="${replace(uri)}"`,
          )
        : replace(line.trim());
    })
    .join("\n");
}
export function createRelay(input: RelayConfig, secret: string) {
  const config = validateConfig(input);
  if (!secret || secret.length < 32)
    throw new Error(
      "RELAY_SECRET must contain at least 32 characters. Generate a private random secret; never commit it.",
    );
  const byId = new Map(config.sources.map((source) => [source.id, source]));
  const resolveDns = createDnsResolver();
  let active = 0,
    windowStart = Date.now(),
    resources = 0,
    sessions = 0;
  const limit = (session = false) => {
    if (Date.now() - windowStart >= 60000) {
      windowStart = Date.now();
      resources = 0;
      sessions = 0;
    }
    if (
      session
        ? ++sessions > 20
        : ++resources >
          Math.max(1, Math.min(config.requestsPerMinute ?? 360, 1800))
    )
      throw new RelayError(429);
  };
  const server = http.createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const abort = new AbortController();
      res.once("close", () => abort.abort());
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("Referrer-Policy", "no-referrer");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Vary", "Origin");
      let upstream: IncomingMessage | undefined;
      try {
        const origin = req.headers.origin;
        if (origin && !config.origins.includes(origin))
          throw new RelayError(403);
        if (origin) res.setHeader("Access-Control-Allow-Origin", origin);
        res.setHeader(
          "Access-Control-Expose-Headers",
          "Content-Range,Accept-Ranges,Content-Length",
        );
        const path = new URL(req.url || "/", "http://localhost");
        if (path.search) throw new RelayError(400);
        if (req.method === "OPTIONS") {
          res.setHeader(
            "Access-Control-Allow-Methods",
            "GET,HEAD,POST,OPTIONS",
          );
          res.setHeader(
            "Access-Control-Allow-Headers",
            "Authorization,Content-Type,Range,If-Range",
          );
          res.writeHead(204);
          res.end();
          return;
        }
        if (path.pathname === "/health" && req.method === "GET") {
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({ ready: true, sources: config.sources.length }),
          );
          return;
        }
        const address = server.address();
        const base =
          config.publicBase ||
          `http://127.0.0.1:${typeof address === "object" && address ? address.port : 8788}`;
        const resource = (source: RelaySource, url: string, expires: number) =>
          `${base}/v1/resource/${seal({ source: source.id, url, expires }, secret)}`;
        if (path.pathname === "/v1/session" && req.method === "POST") {
          const expected = Buffer.from(`Bearer ${secret}`),
            supplied = Buffer.from(req.headers.authorization || "");
          if (
            supplied.length !== expected.length ||
            !timingSafeEqual(supplied, expected)
          )
            throw new RelayError(401);
          limit(true);
          const body = JSON.parse((await smallBody(req, 12000)).toString()) as {
            url?: unknown;
          };
          if (!body || typeof body.url !== "string") throw new RelayError(400);
          const source = config.sources.find((s) => s.url === body.url);
          if (!source) throw new RelayError(403);
          const expires = Date.now() + 6 * 3600000;
          res.setHeader("Content-Type", "application/json");
          res.end(
            JSON.stringify({
              playbackUrl: resource(source, source.url, expires),
              expires,
            }),
          );
          return;
        }
        if (
          !path.pathname.startsWith("/v1/resource/") ||
          !["GET", "HEAD"].includes(req.method || "")
        )
          throw new RelayError(404);
        const ticket = unseal(
            path.pathname.slice("/v1/resource/".length),
            secret,
          ),
          source = byId.get(ticket.source);
        if (!source) throw new RelayError(403);
        const url = upstreamUrl(ticket.url);
        assertDestination(url, source);
        limit();
        if (active >= Math.max(1, Math.min(config.maxConcurrent ?? 12, 48)))
          throw new RelayError(429);
        const range = req.headers.range;
        if (
          range &&
          (!/^bytes=(?:\d+-\d*|-\d+)$/.test(range) || range.length > 100)
        )
          throw new RelayError(416);
        active++;
        try {
          const headers: http.OutgoingHttpHeaders = {};
          if (range) headers.range = range;
          if (
            range &&
            req.headers["if-range"] &&
            String(req.headers["if-range"]).length < 200
          )
            headers["if-range"] = String(req.headers["if-range"]);
          upstream = await connect(
            url,
            source,
            req.method!,
            headers,
            abort.signal,
            resolveDns,
          );
          const status = upstream.statusCode || 502;
          if (status < 200 || status >= 300) {
            upstream.destroy();
            throw new RelayError(
              [401, 403, 404, 416, 429].includes(status) ? status : 502,
            );
          }
          const type = String(
            upstream.headers["content-type"] || "application/octet-stream",
          )
            .split(";")[0]
            .toLowerCase();
          if (
            upstream.headers["content-encoding"] &&
            upstream.headers["content-encoding"] !== "identity"
          )
            throw new RelayError(502);
          const isHls = /mpegurl/.test(type) || /\.m3u8$/i.test(url.pathname);
          if (isHls) {
            if (req.method === "HEAD") {
              upstream.destroy();
              res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
              res.writeHead(200);
              res.end();
              return;
            }
            const text = (await smallBody(upstream, 512000)).toString("utf8");
            // Resolve relative playlist references against the final redirect URL.
            const finalUrl =
              (upstream as IncomingMessage & { relayFinalUrl?: URL })
                .relayFinalUrl || url;
            const playlist = rewriteHls(text, finalUrl, source, (u) =>
              resource(source, u, ticket.expires),
            );
            res.setHeader("Content-Type", "application/vnd.apple.mpegurl");
            res.setHeader("Content-Length", Buffer.byteLength(playlist));
            res.writeHead(200);
            res.end(req.method === "HEAD" ? undefined : playlist);
          } else {
            if (
              !/^(video\/|audio\/|application\/(?:octet-stream|mp4)|binary\/octet-stream|text\/vtt)/.test(
                type,
              )
            )
              throw new RelayError(415);
            res.setHeader("Content-Type", type);
            for (const name of [
              "content-length",
              "content-range",
              "accept-ranges",
              "etag",
              "last-modified",
            ])
              if (upstream.headers[name])
                res.setHeader(name, upstream.headers[name]!);
            res.writeHead(status);
            await new Promise<void>((resolve, reject) => {
              upstream!.once("error", reject);
              upstream!.once("end", resolve);
              res.once("close", resolve);
              upstream!.pipe(res);
            });
          }
        } finally {
          active--;
          upstream?.destroy();
        }
      } catch (error) {
        upstream?.destroy();
        if (res.destroyed) return;
        if (res.headersSent) {
          res.destroy();
          return;
        }
        const status =
          error instanceof RelayError
            ? error.status
            : error instanceof SyntaxError
              ? 400
              : 502;
        res.setHeader("Content-Type", "application/json");
        if (status === 429) res.setHeader("Retry-After", "60");
        res.writeHead(status);
        res.end(JSON.stringify({ error: "relay-request-failed", status }));
      }
    },
  );
  server.headersTimeout = 15000;
  server.requestTimeout = 30000;
  server.maxConnections = 64;
  return server;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const path = process.argv[2];
  if (!path)
    throw new Error("Usage: node server/relay.ts /private/path/relay.json");
  const config = JSON.parse(await readFile(path, "utf8")) as RelayConfig;
  const relay = createRelay(config, process.env.RELAY_SECRET || "");
  relay.listen(config.port ?? 8788, "127.0.0.1", () =>
    console.log(
      "Open TV allowlisted relay listening on loopback. No request URLs, tokens or viewing data are logged.",
    ),
  );
}
