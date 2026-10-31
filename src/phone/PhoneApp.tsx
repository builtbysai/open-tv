import { useEffect, useState } from "preact/hooks";
import { data } from "../app/data";
import { appReady } from "../app/runtime";
import { rememberRole } from "../core/env";
import { claim } from "../remote/controller";
import { pairedTvs, parsePairingHash, say, toast } from "../remote/pairing";
import { PhoneBrowse } from "./Browse";
import { startLink } from "./link";
import { ServersEditor, TmdbSetup, TvList } from "./Manage";
import { Remote } from "./Remote";

type Tab = "remote" | "browse" | "setup";

export function PhoneApp() {
  const [tab, setTab] = useState<Tab>(() => (pairedTvs.value.length && appReady() ? "remote" : "setup"));
  const [hash, setHash] = useState(location.hash);
  useEffect(() => startLink(), []);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const pair = parsePairingHash(hash);

  return (
    <div class="phone">
      {pair ? (
        <Pairing {...pair} onDone={() => { history.replaceState(null, "", location.pathname + location.search); setHash(""); setTab(appReady() ? "remote" : "setup"); }} />
      ) : (
        <>
          <main>
            {tab === "remote" && <Remote />}
            {tab === "browse" && <PhoneBrowse onNeedSetup={() => setTab("setup")} />}
            {tab === "setup" && <Setup />}
          </main>
          <nav class="tabs">
            {(["remote", "browse", "setup"] as Tab[]).map((t) => (
              <button key={t} class={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                {t === "remote" ? "Remote" : t === "browse" ? "Browse" : "Setup"}
              </button>
            ))}
          </nav>
        </>
      )}
      {toast.value && <div class="toast">{toast.value}</div>}
    </div>
  );
}

function Pairing({ tvId, code, key, onDone }: { tvId: string; code: string; key: string; onDone: () => void }) {
  const [state, setState] = useState<{ phase: "working" | "failed"; message: string }>({ phase: "working", message: "" });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setState({ phase: "working", message: "" });
    claim(tvId, code, key, pairedTvs.value.find((t) => t.tvId === tvId)).then(
      (tv) => { say(`Paired with ${tv.name}`); onDone(); },
      (e: Error) => setState({ phase: "failed", message: e.message }),
    );
  }, [tvId, code, key, attempt]);
  return (
    <div class="empty">
      {state.phase === "working" ? (
        <><div class="spinner" /><h2>Connecting to your TV…</h2></>
      ) : (
        <>
          <h2>Could not pair</h2>
          <p class="error">{state.message}</p>
          <p class="hint">Codes work once and expire after 10 minutes. If the TV shows a new code, scan that one.</p>
          <button class="btn primary" onClick={() => setAttempt(attempt + 1)}>Try again</button>
          <button class="btn" onClick={onDone}>Cancel</button>
        </>
      )}
    </div>
  );
}

function Setup() {
  const key = !!data.tmdbKey.value;
  const server = data.servers.value.some((s) => s.enabled);
  const tv = pairedTvs.value.length > 0;
  return (
    <div class="setup-page">
      <h1>Open TV</h1>
      <ol class="steps">
        <li class={key ? "done" : ""}>TMDB key</li>
        <li class={server ? "done" : ""}>A server</li>
        <li class={tv ? "done" : ""}>Pair your TV</li>
      </ol>
      <TmdbSetup />
      <ServersEditor />
      <TvList />
      <section class="card-box">
        <h3>About</h3>
        <p class="hint">This product uses the TMDB API but is not endorsed or certified by TMDB.</p>
        <button class="btn" onClick={() => { rememberRole("tv"); location.reload(); }}>Use this device as a TV</button>
        <p class="hint">Open TV {__APP_VERSION__}</p>
      </section>
    </div>
  );
}
