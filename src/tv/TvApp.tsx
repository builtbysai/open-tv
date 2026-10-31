import { effect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { data } from "../app/data";
import { toast } from "../remote/pairing";
import { registry } from "../core/module";
import { appReady } from "../app/runtime";
import { tvIdentity } from "../remote/pairing";
import { TvHost } from "../remote/tv-host";
import { installKeys, lastFocus, onBack, pressBack } from "./nav";
import { PlayerScreen } from "./Player";
import { Browse, DetailsScreen, MyList, Search, Settings, Setup } from "./screens";
import { go, handleCommand, popRoute, route, routeKey, searchText, session, snapshot, stack, tvHost } from "./state";

// The TV shell: top bar, the current screen, the player on top, and the wiring to the remote.
export function TvApp() {
  // Remote control, for the life of the app.
  useEffect(() => {
    const host = new TvHost(tvIdentity(), snapshot, handleCommand);
    tvHost.value = host;
    void host.start();
    // A server whose player answered the bridge is remembered as verified: from then on, silence
    // from it means failure (so the TV can move to the next server sooner).
    const learn = effect(() => {
      const src = session.current.value;
      if (session.status.value !== "live" || !session.caps.value.controlled || src?.type !== "embed" || src.bridge === "yes") return;
      const server = data.servers.value.find((x) => x.id === src.id);
      if (server && server.bridge !== "yes") data.saveServer({ ...server, bridge: "yes" });
    });
    return () => {
      learn();
      host.stop();
      tvHost.value = null;
    };
  }, []);

  // Keys, Back (the page decides first, the host only exits on a Back it leaves unhandled),
  // and focus memory per screen.
  useEffect(() => {
    const stopKeys = installKeys();
    const stopBack = onBack(() => popRoute() || (route.value.name !== "home" ? (go({ name: "home" }), true) : false));
    const hostBack = (e: Event) => {
      if (pressBack()) e.preventDefault();
    };
    const hostSearch = (e: Event) => {
      const text = (e as CustomEvent<{ text?: string }>).detail?.text;
      if (typeof text === "string") {
        searchText.value = text;
        go({ name: "search" });
      }
    };
    const remember = (e: FocusEvent) => {
      const id = (e.target as HTMLElement | null)?.getAttribute?.("data-f");
      if (id) lastFocus.set(routeKey(route.value), id);
    };
    window.addEventListener("opentv:back", hostBack);
    window.addEventListener("opentv:search", hostSearch);
    document.addEventListener("focusin", remember);
    // In a browser, the TV's Back button is history: keep one entry ahead so Back lands here.
    try {
      history.pushState({ otv: 1 }, "");
    } catch {
      /* Some TV browsers restrict history. */
    }
    const pop = () => {
      if (pressBack()) {
        try {
          history.pushState({ otv: 1 }, "");
        } catch {
          /* Same. */
        }
      }
    };
    window.addEventListener("popstate", pop);
    return () => {
      stopKeys();
      stopBack();
      window.removeEventListener("opentv:back", hostBack);
      window.removeEventListener("opentv:search", hostSearch);
      document.removeEventListener("focusin", remember);
      window.removeEventListener("popstate", pop);
    };
  }, []);

  const r = route.value;
  const ready = appReady();
  const playing = !!session.ref.value;
  void stack.value;

  return (
    <div class="tv">
      {playing ? (
        <PlayerScreen />
      ) : (
        <>
          <TopBar ready={ready} />
          <main class="screen" key={routeKey(r)}>
            {r.name === "settings" ? <Settings /> : !ready ? <Setup /> : r.name === "home" ? <Browse section="home" /> : r.name === "section" ? <Browse section={r.id} /> : r.name === "search" ? <Search /> : r.name === "list" ? <MyList /> : <DetailsScreen item={r.ref} />}
          </main>
        </>
      )}
      {toast.value && <div class="toast">{toast.value}</div>}
    </div>
  );
}

function TopBar({ ready }: { ready: boolean }) {
  const r = route.value;
  const sections: { id: string; label: string }[] = [];
  for (const m of registry.all()) if (m.ready()) for (const s of m.sections) sections.push(s);
  const items: { id: string; label: string; to: Parameters<typeof go>[0] }[] = ready
    ? [
        { id: "home", label: "Home", to: { name: "home" } },
        ...sections.map((s) => ({ id: "s:" + s.id, label: s.label, to: { name: "section", id: s.id, label: s.label } as const })),
        { id: "search", label: "Search", to: { name: "search" } },
        { id: "list", label: "My List", to: { name: "list" } },
        { id: "settings", label: "Settings", to: { name: "settings" } },
      ]
    : [{ id: "settings", label: "Settings", to: { name: "settings" } }];
  const current = r.name === "section" ? "s:" + r.id : r.name === "details" ? "" : r.name;
  return (
    <nav class="bar">
      <span class="logo">Open TV</span>
      {items.map((i) => (
        <button key={i.id} class={"tab" + (i.id === current ? " on" : "")} data-f={"bar:" + i.id} onClick={() => go(i.to)}>
          {i.label}
        </button>
      ))}
    </nav>
  );
}
