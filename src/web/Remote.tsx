import { signal } from "@preact/signals";
import { useEffect, useState } from "preact/hooks";
import { controller, press, tell } from "./link";

const tick = signal(0);
setInterval(() => (tick.value = (tick.value + 1) % 1e9), 500);

const clock = (s: number) => {
  const t = Math.max(0, Math.floor(s));
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), x = t % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : String(m)) + ":" + String(x).padStart(2, "0");
};

// The phone as the TV's remote: what is playing, transport, volume, a D-pad, and a keyboard.
export function Remote() {
  const c = controller.value;
  if (!c) return <div class="empty"><h2>No TV paired</h2><p>Open Open TV on your TV and scan the code it shows, or open Settings here.</p></div>;
  const s = c.state.value;
  const online = c.tvOnline.value;
  void tick.value;

  const playing = s?.phase === "playing";
  const pos = s ? Math.min(s.dur || Infinity, s.pos + (playing ? (Date.now() - s.at) / 1000 : 0)) : 0;
  const caps = s?.caps ?? { seek: false, volume: false, mute: false, keys: false };
  const controlled = !!s && (s.phase === "playing" || s.phase === "paused" || s.phase === "buffering");

  return (
    <div class="remote">
      <div class={"tvline" + (online ? " on" : "")}>
        <span class="dot" /> {c.tvName.value} · {online ? "connected" : c.client.link.value === "online" ? "TV is off or offline" : "connecting…"}
      </div>

      <div class="now">
        {s && s.title ? (
          <>
            <h2>{s.title}</h2>
            {s.subtitle && <p>{s.subtitle}</p>}
            <p class="phase">{label(s.phase)}{s.source ? ` · ${s.source.label}` : ""}</p>
          </>
        ) : (
          <p class="phase">{s?.screen === "setup" ? "The TV needs setup" : online ? "Pick something to watch" : " "}</p>
        )}
        {controlled && caps.seek && s.dur > 0 && (
          <div class="scrub">
            <span>{clock(pos)}</span>
            <input type="range" min={0} max={Math.floor(s.dur)} value={Math.floor(pos)} onChange={(e) => void tell({ t: "seek", to: Number((e.target as HTMLInputElement).value) })} />
            <span>{clock(s.dur)}</span>
          </div>
        )}
        {s?.phase === "error" && (
          <button class="btn" onClick={() => void tell({ t: "ctl", a: "nextSource" })}>Try another server</button>
        )}
      </div>

      <div class="transport">
        <button class="rb" disabled={!caps.seek} onClick={() => void tell({ t: "seek", by: -10 })}>−10</button>
        <button class="rb big" disabled={!controlled} onClick={() => void tell({ t: "ctl", a: "toggle" })}>{playing ? "❚❚" : "▶"}</button>
        <button class="rb" disabled={!caps.seek} onClick={() => void tell({ t: "seek", by: 10 })}>+10</button>
      </div>
      <div class="transport small">
        <button class="rb" onClick={() => void tell({ t: "ctl", a: "volDown" })}>Vol −</button>
        <button class="rb" onClick={() => void tell({ t: "ctl", a: s?.muted ? "unmute" : "mute" })}>{s?.muted ? "Unmute" : "Mute"}</button>
        <button class="rb" onClick={() => void tell({ t: "ctl", a: "volUp" })}>Vol +</button>
      </div>
      <div class="transport small">
        <button class="rb" disabled={!s?.hasNext} onClick={() => void tell({ t: "ctl", a: "next" })}>Next</button>
        <button class="rb" disabled={!s?.source || s.source.count < 2} onClick={() => void tell({ t: "ctl", a: "nextSource" })}>Server {s?.source ? `${s.source.index + 1}/${s.source.count}` : ""}</button>
        <button class="rb" disabled={!s?.title || s.screen !== "player"} onClick={() => void tell({ t: "ctl", a: "stop" })}>Stop</button>
      </div>

      <Dpad />
      <Keyboard typing={!!s?.typing} />
    </div>
  );
}

const label = (p: string) =>
  p === "loading" ? "Starting…" : p === "buffering" ? "Buffering…" : p === "error" ? "Could not play" : p === "ended" ? "Finished" : p === "idle" ? "" : p === "paused" ? "Paused" : "Playing";

function Dpad() {
  const key = (k: "up" | "down" | "left" | "right" | "ok" | "back" | "home" | "menu") => () => press({ t: "nav", key: k });
  return (
    <div class="dpad">
      <button class="dk up" onClick={key("up")} aria-label="Up">▲</button>
      <button class="dk left" onClick={key("left")} aria-label="Left">◀</button>
      <button class="dk ok" onClick={key("ok")}>OK</button>
      <button class="dk right" onClick={key("right")} aria-label="Right">▶</button>
      <button class="dk down" onClick={key("down")} aria-label="Down">▼</button>
      <button class="dk back" onClick={key("back")}>Back</button>
      <button class="dk home" onClick={key("home")}>Home</button>
      <button class="dk menu" onClick={key("menu")}>Menu</button>
    </div>
  );
}

let timer: ReturnType<typeof setTimeout> | undefined;
// Typing into the TV's search box with the phone's keyboard.
function Keyboard({ typing }: { typing: boolean }) {
  const [text, setText] = useState("");
  useEffect(() => {
    if (!typing) return;
    const el = document.getElementById("kb");
    if (el) (el as HTMLInputElement).focus();
  }, [typing]);
  return (
    <form class="kb" onSubmit={(e) => { e.preventDefault(); void tell({ t: "text", value: text, submit: true }); }}>
      <input id="kb" placeholder="Type to search on the TV" value={text} enterKeyHint="search" autocomplete="off" autocapitalize="none"
        onInput={(e) => {
          const v = (e.target as HTMLInputElement).value;
          setText(v);
          // Fast typing must not trip the relay's rate limit: send once the thumbs pause.
          clearTimeout(timer);
          timer = setTimeout(() => press({ t: "text", value: v }), 200);
        }} />
    </form>
  );
}
