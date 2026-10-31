import { computed, signal } from "@preact/signals";
import { data } from "../app/data";
import { appReady, createSession, moduleOf, startFor } from "../app/runtime";
import { hasHost, hostSend } from "../core/env";
import type { MediaRef } from "../core/module";
import type { Command, NowPlaying } from "../remote/protocol";
import { activate, move, pressBack } from "./nav";

export type Route =
  | { name: "home" }
  | { name: "section"; id: string; label: string }
  | { name: "search" }
  | { name: "list" }
  | { name: "settings" }
  | { name: "details"; ref: MediaRef };

export const stack = signal<Route[]>([{ name: "home" }]);
export const route = computed(() => stack.value[stack.value.length - 1]);
export const routeKey = (r: Route) =>
  r.name === "details" ? `details:${r.ref.mod}:${r.ref.kind}:${r.ref.id}` : r.name === "section" ? `section:${r.id}` : r.name;

// Top-level destinations replace the stack; a title page stacks on top of where you were.
export function go(r: Route) {
  if (r.name === "details") {
    // A second OK on the same card must not stack a second copy of the page.
    const top = stack.value[stack.value.length - 1];
    if (top.name === "details" && top.ref.mod === r.ref.mod && top.ref.id === r.ref.id) return;
    stack.value = [...stack.value, r];
  }
  else stack.value = [r];
}
export function popRoute(): boolean {
  if (stack.value.length <= 1) return false;
  stack.value = stack.value.slice(0, -1);
  return true;
}

export const session = createSession();
export const searchText = signal("");
export const tvHost = signal<import("./../remote/tv-host").TvHost | null>(null);
export const typing = signal(false);

export function play(ref: MediaRef, start?: number) {
  session.play(ref, start ?? startFor(ref));
}

// ---- What phones see -----------------------------------------------------------------------

export function snapshot(): NowPlaying {
  const ref = session.ref.value;
  const r = route.value;
  const b = session.state.value;
  const caps = session.caps.value;
  const current = session.current.value;
  const screen: NowPlaying["screen"] = !appReady() ? "setup" : ref ? "player" : r.name === "details" ? "details" : r.name === "home" ? "idle" : "browse";
  const shown = ref ?? (r.name === "details" ? r.ref : null);
  const sub = shown && shown.kind === "episode" ? `S${shown.season} E${shown.episode}${shown.epTitle ? ` · ${shown.epTitle}` : ""}` : undefined;
  return {
    screen,
    phase: session.phase.value,
    title: shown ? shown.title : "",
    ...(sub ? { subtitle: sub } : {}),
    ...(shown ? { ref: shown } : {}),
    pos: b.time,
    dur: b.duration,
    at: Date.now(),
    caps: { seek: caps.seek, volume: caps.volume || hasHost(), mute: caps.mute, keys: true },
    muted: b.muted,
    ...(ref && current
      ? { source: { id: current.id, label: current.label, index: session.index.value, count: session.sources.value.length } }
      : {}),
    typing: typing.value,
    hasNext: session.hasNext.value,
    ready: appReady(),
  };
}

const NEEDS_CONTROL = "This server does not accept remote controls. Switch server or use the picture's own controls.";

// A phone's command. Returns true, or a short reason the phone can show.
export function handleCommand(cmd: Command): true | string {
  switch (cmd.t) {
    case "play":
      if (!moduleOf(cmd.ref)) return "This TV cannot play that.";
      session.play(cmd.ref, cmd.start ?? startFor(cmd.ref));
      // Come back to the front if the host was backgrounded (Android TV, if allowed).
      hostSend({ type: "foreground" });
      return true;
    case "open":
      if (!moduleOf(cmd.ref)) return "This TV cannot show that.";
      if (session.ref.value) session.stop();
      go({ name: "details", ref: cmd.ref });
      hostSend({ type: "foreground" });
      return true;
    case "ctl": {
      const live = session.ref.value;
      switch (cmd.a) {
        case "stop":
          session.stop();
          return true;
        case "next":
          return session.playNext() || "There is nothing next.";
        case "prev":
          return "There is no previous item.";
        case "nextSource":
          return !live ? "Nothing is playing." : session.nextSource() || "No other server.";
        case "volUp":
        case "volDown": {
          if (session.caps.value.volume) {
            const v = session.state.value.volume + (cmd.a === "volUp" ? 0.1 : -0.1);
            session.command({ c: "volume", to: Math.max(0, Math.min(1, v)) });
          } else if (hasHost()) hostSend({ type: "volume", step: cmd.a === "volUp" ? 1 : -1 });
          else return "Use the TV's volume buttons.";
          return true;
        }
        case "mute":
        case "unmute":
          if (session.caps.value.mute) session.command({ c: "mute", on: cmd.a === "mute" });
          else if (hasHost()) hostSend({ type: "volume", step: 0 });
          else return "Use the TV's mute button.";
          return true;
        default:
          if (!live) return "Nothing is playing.";
          if (!session.caps.value.controlled) return NEEDS_CONTROL;
          session.command({ c: cmd.a === "toggle" ? "toggle" : cmd.a });
          return true;
      }
    }
    case "seek":
      if (!session.ref.value) return "Nothing is playing.";
      if (!session.caps.value.seek) return NEEDS_CONTROL;
      session.command(cmd.to !== undefined ? { c: "seek", to: cmd.to } : { c: "seekBy", by: cmd.by ?? 0 });
      return true;
    case "nav":
      // The phone is a remote: the picture must not keep the keyboard.
      session.releasePicture();
      if (cmd.key === "back") return pressBack() || true;
      if (cmd.key === "home") {
        session.stop();
        stack.value = [{ name: "home" }];
        return true;
      }
      if (cmd.key === "menu") {
        window.dispatchEvent(new Event("opentv:hud"));
        return true;
      }
      if (cmd.key === "ok") return activate() || true;
      move(cmd.key);
      return true;
    case "text":
      if (route.value.name !== "search") go({ name: "search" });
      searchText.value = cmd.value;
      return true;
    case "source":
      return session.select(cmd.sid) || "That server is not available.";
    case "tap":
      if (!hasHost()) return "Tapping the picture needs the Android TV app.";
      hostSend({ type: "tap" });
      return true;
  }
}

// Used by screens that need the user's progress and list as plain lookups.
export const listed = (ref: MediaRef) => data.inList(ref);
