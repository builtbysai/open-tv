// Everything the end-to-end tests talk to, on localhost:
//   4173  the app (a build pointed at the mocks below)
//   4180  mock TMDB (key "goodkey" works, anything else is 401)
//   4181  server "bridge":  speaks the Open TV bridge, allows framing from the app
//   4182  server "silent":  plays, but has no bridge
//   4183  server "refuse":  sends X-Frame-Options: DENY
//   4190  the relay (Node build of the same rules as the Worker)
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { build } from "vite";
import { startRelay } from "../control/src/node";

const APP = 4173, TMDB = 4180, BRIDGE = 4181, SILENT = 4182, REFUSE = 4183, RELAY = 4190;

// ---- mock TMDB -------------------------------------------------------------------------------
const MOVIES = [
  { id: 603, title: "The Matrix", release_date: "1999-03-30", overview: "A hacker learns the truth about his world." },
  { id: 604, title: "Blade Runner", release_date: "1982-06-25", overview: "A replicant hunter." },
  { id: 605, title: "Alien", release_date: "1979-05-25", overview: "In space no one can hear you scream." },
  { id: 606, title: "Arrival", release_date: "2016-11-11", overview: "Linguist meets visitors." },
];
const SHOWS = [
  { id: 1396, name: "Breaking Bad", first_air_date: "2008-01-20", overview: "A teacher turns to crime." },
  { id: 1399, name: "Foundation", first_air_date: "2021-09-24", overview: "An empire falls." },
];
const withImages = <T extends object>(o: T, id: number) => ({ ...o, poster_path: `/p${id}.jpg`, backdrop_path: `/b${id}.jpg`, vote_average: 8.2, genre_ids: [18] });
const movie = (m: (typeof MOVIES)[number]) => withImages({ ...m, media_type: "movie" }, m.id);
const show = (s: (typeof SHOWS)[number]) => withImages({ ...s, media_type: "tv" }, s.id);

function tmdb(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", "http://x");
  response.setHeader("access-control-allow-origin", "*");
  response.setHeader("access-control-allow-headers", "*");
  if (request.method === "OPTIONS") return void response.writeHead(204).end();
  const send = (status: number, body: unknown) => { response.writeHead(status, { "content-type": "application/json" }); response.end(JSON.stringify(body)); };
  if (url.pathname.startsWith("/t/p/")) {
    // A distinct gradient per image, so screenshots of the UI look like a real catalogue.
    const n = Number(/\d+/.exec(url.pathname.split("/").pop() ?? "")?.[0] ?? 0);
    const h = (n * 47) % 360;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 240" preserveAspectRatio="xMidYMid slice"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},55%,34%)"/><stop offset="1" stop-color="hsl(${(h + 50) % 360},60%,12%)"/></linearGradient></defs><rect width="160" height="240" fill="url(#g)"/></svg>`;
    response.writeHead(200, { "content-type": "image/svg+xml" });
    return void response.end(svg);
  }
  const key = url.searchParams.get("api_key");
  const bearer = request.headers.authorization;
  if (key !== "goodkey" && bearer !== "Bearer eyJgood") return send(401, { status_message: "Invalid API key" });
  const path = url.pathname.replace(/^\/3\//, "");
  if (path === "configuration") return send(200, { images: {} });
  if (path === "search/multi") {
    const q = (url.searchParams.get("query") ?? "").toLowerCase();
    return send(200, { results: [...MOVIES.map(movie), ...SHOWS.map(show)].filter((r) => ((r as { title?: string; name?: string }).title ?? (r as { name?: string }).name ?? "").toLowerCase().includes(q)) });
  }
  if (/^(trending\/movie|movie\/(popular|top_rated|now_playing)|discover\/movie)/.test(path)) return send(200, { results: MOVIES.map(movie) });
  if (/^(trending\/tv|tv\/(popular|top_rated|on_the_air)|discover\/tv)/.test(path)) return send(200, { results: SHOWS.map(show) });
  const detail = /^(movie|tv)\/(\d+)$/.exec(path);
  if (detail) {
    const isMovie = detail[1] === "movie";
    const item = isMovie ? MOVIES.find((m) => String(m.id) === detail[2]) : SHOWS.find((s) => String(s.id) === detail[2]);
    if (!item) return send(404, {});
    const base = isMovie ? withImages(item, item.id) : withImages(item, item.id);
    return send(200, {
      ...base, tagline: "Mock tagline", runtime: 136, genres: [{ name: "Drama" }], credits: { cast: [{ name: "Actor One" }, { name: "Actor Two" }] },
      recommendations: { results: (isMovie ? MOVIES : SHOWS).slice(0, 2).map((x) => withImages(x, x.id)) },
      ...(isMovie ? {} : { seasons: [{ season_number: 1, name: "Season 1", episode_count: 3 }, { season_number: 2, name: "Season 2", episode_count: 2 }] }),
    });
  }
  const season = /^tv\/(\d+)\/season\/(\d+)$/.exec(path);
  if (season) {
    const count = season[2] === "1" ? 3 : 2;
    return send(200, { name: `Season ${season[2]}`, episodes: Array.from({ length: count }, (_, i) => ({ episode_number: i + 1, name: `Episode ${i + 1}`, overview: "An episode.", still_path: `/s${i}.jpg`, air_date: "2008-01-20" })) });
  }
  return send(404, {});
}

// ---- mock embed servers ----------------------------------------------------------------------
const clip = readFileSync("tests/fixtures/clip.webm");
const bridgeJs = readFileSync("public/bridge/opentv-embed.js");
function embed(kind: "bridge" | "silent" | "refuse") {
  return (request: IncomingMessage, response: ServerResponse) => {
    const url = new URL(request.url ?? "/", "http://x");
    if (url.pathname === "/clip.webm") {
      // Real servers support Range requests, and seeking in a video depends on them.
      const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.range ?? "");
      if (range) {
        const start = range[1] ? Number(range[1]) : 0;
        const end = range[2] ? Math.min(Number(range[2]), clip.length - 1) : clip.length - 1;
        response.writeHead(206, { "content-type": "video/webm", "accept-ranges": "bytes", "content-range": `bytes ${start}-${end}/${clip.length}`, "content-length": end - start + 1 });
        return void response.end(clip.subarray(start, end + 1));
      }
      response.writeHead(200, { "content-type": "video/webm", "content-length": clip.length, "accept-ranges": "bytes" });
      return void response.end(clip);
    }
    if (url.pathname === "/opentv-embed.js") { response.writeHead(200, { "content-type": "text/javascript" }); return void response.end(bridgeJs); }
    const headers: Record<string, string> = { "content-type": "text/html" };
    if (kind === "refuse") headers["x-frame-options"] = "DENY";
    else headers["content-security-policy"] = `frame-ancestors http://localhost:${APP}`;
    if (!/^\/embed\/(movie\/\d+|tv\/\d+\/\d+\/\d+)$/.test(url.pathname)) { response.writeHead(404, headers); return void response.end("not found"); }
    response.writeHead(200, headers);
    response.end(`<!doctype html><meta charset=utf-8><title>${kind} ${url.pathname}</title><style>html,body{margin:0;background:#123;height:100%}video{width:100%;height:100%}</style>
<video id=v src="/clip.webm" autoplay muted playsinline ${url.pathname.includes("/movie/") ? "loop" : ""}></video>${kind === "bridge" ? '<script src="/opentv-embed.js"></script>' : ""}`);
  };
}

// ---- the app ---------------------------------------------------------------------------------
const TYPES: Record<string, string> = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".png": "image/png" };
function app(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? "/", "http://x");
  if (url.pathname === "/health") return void response.writeHead(200).end("ok");
  const file = normalize(join("dist-e2e", url.pathname === "/" ? "index.html" : url.pathname));
  if (!file.startsWith("dist-e2e") || !existsSync(file)) return void response.writeHead(404).end();
  response.writeHead(200, { "content-type": TYPES[extname(file)] ?? "application/octet-stream", "cache-control": "no-store" });
  response.end(readFileSync(file));
}

const listen = (port: number, handler: (q: IncomingMessage, r: ServerResponse) => void) => new Promise<void>((done) => createServer(handler).listen(port, "127.0.0.1", done));

async function main() {
  Object.assign(process.env, {
    VITE_RELAY_URL: `ws://localhost:${RELAY}`,
    VITE_TMDB_BASE: `http://localhost:${TMDB}/3`,
    VITE_TMDB_IMAGE_BASE: `http://localhost:${TMDB}/t/p`,
    VITE_SITE_URL: `http://localhost:${APP}/`,
  });
  await build({ configFile: "vite.config.ts", logLevel: "warn", build: { outDir: "dist-e2e", emptyOutDir: true } });
  await startRelay(RELAY);
  await Promise.all([listen(TMDB, tmdb), listen(BRIDGE, embed("bridge")), listen(SILENT, embed("silent")), listen(REFUSE, embed("refuse")), listen(APP, app)]);
  console.log("e2e harness ready");
}
void main();
