// Run against `npm run dev` (wrangler dev with ALLOWED_ORIGINS="*"), or set RELAY.
const base = `${process.env.RELAY || "ws://127.0.0.1:8787"}/v1/tv/`;
const rnd = (n = 16) =>
  Buffer.from(crypto.getRandomValues(new Uint8Array(n))).toString("base64url");
function open(tvId, cred) {
  return new Promise((resolve) => {
    const ws = new WebSocket(base + tvId, ["opentv.v1", ...[cred].flat()]);
    const inbox = [];
    const waiters = [];
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      inbox.push(m);
      for (const w of [...waiters])
        if (w.test(m)) {
          waiters.splice(waiters.indexOf(w), 1);
          w.resolve(m);
        }
    };
    ws.next = (t, test = () => true) => {
      const found = inbox.find((m) => m.t === t && test(m));
      if (found) {
        inbox.splice(inbox.indexOf(found), 1);
        return Promise.resolve(found);
      }
      return new Promise((resolve, reject) => {
        const w = {
          test: (m) => m.t === t && test(m),
          resolve: (m) => {
            inbox.splice(inbox.indexOf(m), 1);
            resolve(m);
          },
        };
        waiters.push(w);
        setTimeout(() => reject(new Error("timeout waiting " + t)), 4000);
      });
    };
    ws.closed = new Promise((r) => (ws.onclose = (e) => r(e.code)));
    ws.onopen = () => resolve(ws);
    ws.onerror = () => resolve(ws);
  });
}
const assert = (c, m) => {
  if (!c) {
    console.error("FAIL", m);
    process.exit(1);
  } else console.log("ok", m);
};
const tvId = rnd(),
  secret = rnd(24),
  code = rnd(16);
const tv = await open(tvId, "otv-tv." + secret);
assert((await tv.next("hello")).role === "tv", "tv hello");
await tv.next("presence");
tv.send(JSON.stringify({ t: "claim", code }));
await new Promise((r) => setTimeout(r, 300));
const phone = await open(tvId, "otv-claim." + code);
const paired = await phone.next("paired");
assert(paired.token && paired.controllerId, "paired");
const pres = await tv.next(
  "presence",
  (m) => m.controllers.length === 1 && m.controllers[0].online,
);
assert(pres.tv === true, "presence shows phone");
phone.send(JSON.stringify({ t: "name", name: "Sai's phone" }));
await tv.next("presence", (m) => m.controllers[0]?.name === "Sai's phone");
console.log("ok rename");
phone.send(
  JSON.stringify({
    t: "play",
    id: "cmd-00001",
    item: {
      sourceId: "iptv-x",
      itemId: "ch1",
      type: "live",
      title: "Channel 1",
      classification: "general",
      streams: [{ url: "https://example.com/a.m3u8", format: "hls" }],
    },
  }),
);
const cmd = await tv.next("play");
assert(
  cmd.from === paired.controllerId && cmd.item.title === "Channel 1",
  "tv got play",
);
tv.send(
  JSON.stringify({
    t: "ack",
    id: "cmd-00001",
    to: paired.controllerId,
    ok: true,
  }),
);
assert((await phone.next("ack")).ok === true, "phone got ack");
tv.send(
  JSON.stringify({
    t: "state",
    state: {
      phase: "playing",
      position: 12,
      duration: 0,
      at: Date.now(),
      title: "Channel 1",
      canSeek: false,
      canStep: true,
    },
  }),
);
assert(
  (await phone.next("state")).state.phase === "playing",
  "phone got state",
);
// Sync documents pass both ways; a malformed one is dropped.
const doc = {
  v: 1,
  e: { "fav:ot-a1": [Date.now(), 1], "prog:ot-a1": [Date.now(), 42] },
};
phone.send(JSON.stringify({ t: "sync", doc: { v: 2, e: {} } }));
phone.send(JSON.stringify({ t: "sync", doc, full: true }));
const toTv = await tv.next("sync");
assert(
  toTv.from === paired.controllerId &&
    toTv.full === true &&
    toTv.doc.e["prog:ot-a1"][1] === 42,
  "sync phone -> tv",
);
tv.send(
  JSON.stringify({
    t: "sync",
    doc: { v: 1, e: { "fav:ot-a1": [Date.now(), null] } },
    to: paired.controllerId,
  }),
);
const toPhone = await phone.next("sync");
assert(
  toPhone.doc.e["fav:ot-a1"][1] === null && !toPhone.to && !toPhone.from,
  "sync tv -> phone",
);
tv.send(JSON.stringify({ t: "sync", doc }));
assert(
  (await phone.next("sync")).doc.e["fav:ot-a1"][1] === 1,
  "sync tv -> all phones",
);
phone.close();
await phone.closed;
await tv.next("presence", (m) => m.controllers[0] && !m.controllers[0].online);
console.log("ok offline presence");
const phone2 = await open(
  tvId,
  `otv-ctl.${paired.controllerId}.${paired.token}`,
);
await phone2.next("hello");
assert(
  (await phone2.next("state")).state.title === "Channel 1",
  "reconnect gets last state",
);
const reuse = await open(tvId, "otv-claim." + code);
assert((await reuse.closed) === 4401, "used code refused");
const thief = await open(tvId, "otv-tv." + rnd(24));
assert((await thief.closed) === 4403, "wrong tv secret refused");
const forged = await open(tvId, `otv-ctl.${paired.controllerId}.${rnd(24)}`);
assert((await forged.closed) === 4401, "wrong token refused");
// WebRTC signaling passes through untouched, both ways.
phone2.send(
  JSON.stringify({ t: "signal", data: { kind: "offer", sdp: "v=0 test" } }),
);
const offer = await tv.next("signal");
assert(
  offer.from === paired.controllerId && offer.data.sdp === "v=0 test",
  "signal phone -> tv",
);
tv.send(
  JSON.stringify({
    t: "signal",
    to: paired.controllerId,
    data: { kind: "answer", sdp: "v=0 answer" },
  }),
);
assert(
  (await phone2.next("signal")).data.kind === "answer",
  "signal tv -> phone",
);
// A flood is cut short by the rate limit: far fewer answers than commands.
for (let i = 0; i < 60; i++)
  phone2.send(
    JSON.stringify({ t: "pause", id: `flood-${String(i).padStart(4, "0")}` }),
  );
let forwarded = 0;
const t0 = Date.now();
while (Date.now() - t0 < 1500) {
  try {
    await tv.next("pause");
    forwarded++;
  } catch {
    break;
  }
}
assert(
  forwarded > 0 && forwarded < 45,
  `rate limit (${forwarded} of 60 forwarded)`,
);
// Offline TV: command acks with offline.
tv.close();
await tv.closed;
phone2.send(JSON.stringify({ t: "pause", id: "cmd-00002" }));
assert((await phone2.next("ack")).error === "offline", "offline ack");
const tvBack = await open(tvId, "otv-tv." + secret);
await tvBack.next("hello");
tvBack.send(JSON.stringify({ t: "revoke", id: paired.controllerId }));
assert((await phone2.closed) === 4401, "revoked from tv closes phone");
await tvBack.next("presence", (m) => m.controllers.length === 0);
const again = await open(
  tvId,
  `otv-ctl.${paired.controllerId}.${paired.token}`,
);
assert((await again.closed) === 4401, "revoked token refused");
// Pairing again from the same phone replaces its entry instead of adding one.
const code2 = rnd(16),
  code3 = rnd(16);
tvBack.send(JSON.stringify({ t: "claim", code: code2 }));
await new Promise((r) => setTimeout(r, 300));
const first = await open(tvId, "otv-claim." + code2);
const one = await first.next("paired");
first.send(JSON.stringify({ t: "name", name: "Kitchen phone" }));
await tvBack.next(
  "presence",
  (m) =>
    m.controllers.length === 1 && m.controllers[0].name === "Kitchen phone",
);
tvBack.send(JSON.stringify({ t: "claim", code: code3 }));
await new Promise((r) => setTimeout(r, 300));
const second = await open(tvId, [
  "otv-claim." + code3,
  `otv-ctl.${one.controllerId}.${one.token}`,
]);
const two = await second.next("paired");
assert(
  two.controllerId !== one.controllerId && (await first.closed) === 4409,
  "re-pair closes the old connection",
);
const list = await tvBack.next("presence", (m) =>
  m.controllers.some((c) => c.id === two.controllerId),
);
assert(
  list.controllers.length === 1 && list.controllers[0].name === "Kitchen phone",
  "re-pair replaces the entry",
);
const stale = await open(tvId, `otv-ctl.${one.controllerId}.${one.token}`);
assert((await stale.closed) === 4401, "replaced token refused");
console.log("ALL OK");
process.exit(0);
