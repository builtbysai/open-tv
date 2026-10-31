import { signal } from "@preact/signals";
import { createSession, startFor } from "../app/runtime";
import type { MediaRef } from "../core/module";
import { readJson, writeJson } from "../core/store";
import { say } from "../remote/pairing";
import { controller, tell } from "./link";
import { go, watchPath } from "./router";

// Playback in this browser. (The TV has its own session in src/tv/state.ts.)
export const webSession = createSession();

// Where "Play" sends a title: this browser, or the paired TV.
export type Target = "here" | "tv";
const saved = readJson<Target>("otv:target", (v) => (v === "tv" || v === "here" ? v : null));
export const target = signal<Target>(saved ?? "here");
export function setTarget(t: Target) {
  target.value = t;
  writeJson("otv:target", t);
}
// With no TV paired, there is only "here".
export const effectiveTarget = (): Target => (target.value === "tv" && controller.value ? "tv" : "here");

export function play(ref: MediaRef, where: Target = effectiveTarget()) {
  if (where === "tv") {
    void tell({ t: "play", ref, start: startFor(ref) }).then((ok) => ok && say(`Playing on ${controller.value?.tvName.value ?? "the TV"}`));
    return;
  }
  webSession.play(ref, startFor(ref));
  go(watchPath(ref));
}
