import { signal } from "@preact/signals";

// Remote-control input for a TV: which key was pressed, where focus goes next, and who gets
// "Back". A TV remote has arrows, OK and Back. No pointer, so every interactive thing is a
// `data-f` element and the arrows move between them by geometry.

export type Dir = "up" | "down" | "left" | "right";
export type NavKey = Dir | "ok" | "back";
export type MediaKey = "toggle" | "play" | "pause" | "stop" | "ff" | "rw";

// keyCodes are what Samsung (Tizen), LG (webOS), Android TV and Fire TV remotes send.
export function navKey(e: KeyboardEvent): NavKey | null {
  switch (e.key) {
    case "ArrowUp": return "up";
    case "ArrowDown": return "down";
    case "ArrowLeft": return "left";
    case "ArrowRight": return "right";
    case "Enter": return "ok";
    case "Escape":
    case "BrowserBack":
    case "GoBack":
    case "XF86Back": return "back";
    case "Backspace": return isTyping(e.target) ? null : "back";
  }
  switch (e.keyCode) {
    case 38: return "up";
    case 40: return "down";
    case 37: return "left";
    case 39: return "right";
    case 13: return "ok";
    case 27:
    case 10009: // Tizen
    case 461: // webOS
    case 166: return "back";
    case 8: return isTyping(e.target) ? null : "back";
  }
  return null;
}
export function mediaKey(e: KeyboardEvent): MediaKey | null {
  switch (e.key) {
    case "MediaPlayPause": return "toggle";
    case "MediaPlay": return "play";
    case "MediaPause": return "pause";
    case "MediaStop": return "stop";
    case "MediaFastForward": return "ff";
    case "MediaRewind": return "rw";
  }
  switch (e.keyCode) {
    case 179: case 85: return "toggle";
    case 415: return "play";
    case 19: return "pause";
    case 413: case 178: return "stop";
    case 417: case 228: return "ff";
    case 412: case 227: return "rw";
  }
  return null;
}
const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA");
};

// ---- Back: the most recently registered handler that wants it wins -----------------------

type BackHandler = () => boolean;
const backHandlers: BackHandler[] = [];
export function onBack(handler: BackHandler): () => void {
  backHandlers.push(handler);
  return () => {
    const i = backHandlers.lastIndexOf(handler);
    if (i >= 0) backHandlers.splice(i, 1);
  };
}
export function pressBack(): boolean {
  for (let i = backHandlers.length - 1; i >= 0; i--) if (backHandlers[i]()) return true;
  return false;
}

// ---- Layers: a menu or panel confines focus to itself ------------------------------------

const layers: HTMLElement[] = [];
export function pushLayer(el: HTMLElement): () => void {
  layers.push(el);
  return () => {
    const i = layers.indexOf(el);
    if (i >= 0) layers.splice(i, 1);
  };
}
const scope = (): ParentNode => layers[layers.length - 1] ?? document;

// ---- Spatial navigation ------------------------------------------------------------------

const visible = (el: HTMLElement) => {
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && !el.hasAttribute("data-off") && !(el as HTMLButtonElement).disabled;
};
const focusables = (): HTMLElement[] =>
  Array.prototype.slice.call(scope().querySelectorAll("[data-f]")).filter(visible) as HTMLElement[];

export const lastFocus = new Map<string, string>();
// The last item focused outside the top bar: Down from the bar goes back to it.
let lastContent = "";
export const focusedId = signal("");

function reveal(el: HTMLElement) {
  try {
    el.scrollIntoView({ block: "nearest", inline: "center" });
  } catch {
    el.scrollIntoView();
  }
}
export function focusEl(el: HTMLElement | null | undefined): boolean {
  if (!el) return false;
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
  reveal(el);
  focusedId.value = el.getAttribute("data-f") || "";
  if (focusedId.value && !focusedId.value.startsWith("bar:")) lastContent = focusedId.value;
  return document.activeElement === el;
}
export function focusById(id: string): boolean {
  const el = focusables().filter((e) => e.getAttribute("data-f") === id)[0];
  return focusEl(el);
}
// First focus on a screen: the remembered item, else [data-first], else the first one.
export function focusInitial(rememberKey?: string): boolean {
  const everything = focusables();
  // Land on the content, not the top bar, unless there is no content.
  const inScreen = everything.filter((e) => !!e.closest(".screen"));
  const all = inScreen.length ? inScreen : everything;
  const remembered = rememberKey ? lastFocus.get(rememberKey) : undefined;
  const pick =
    (remembered && all.filter((e) => e.getAttribute("data-f") === remembered)[0]) ||
    all.filter((e) => e.hasAttribute("data-first"))[0] ||
    all[0];
  return focusEl(pick);
}

export function move(dir: Dir): boolean {
  const all = focusables();
  const current = document.activeElement as HTMLElement | null;
  const from = current && current.hasAttribute("data-f") && all.indexOf(current) >= 0 ? current : null;
  if (!from) return focusEl(all.filter((e) => e.hasAttribute("data-first"))[0] || all[0]);
  if (dir === "down" && (from.getAttribute("data-f") || "").startsWith("bar:") && lastContent && focusById(lastContent)) return true;
  const a = from.getBoundingClientRect();
  const ax = a.left + a.width / 2;
  const ay = a.top + a.height / 2;
  let best: HTMLElement | null = null;
  let bestScore = Infinity;
  for (const el of all) {
    if (el === from) continue;
    const b = el.getBoundingClientRect();
    const bx = b.left + b.width / 2;
    const by = b.top + b.height / 2;
    const dx = bx - ax;
    const dy = by - ay;
    // Distance along the direction and off to the side. A candidate must lie ahead by edge.
    let along: number, across: number;
    if (dir === "left") { if (b.right > a.left + 1) continue; along = a.left - b.right; across = Math.abs(dy); }
    else if (dir === "right") { if (b.left < a.right - 1) continue; along = b.left - a.right; across = Math.abs(dy); }
    else if (dir === "up") { if (b.bottom > a.top + 1) continue; along = a.top - b.bottom; across = Math.abs(dx); }
    else { if (b.top < a.bottom - 1) continue; along = b.top - a.bottom; across = Math.abs(dx); }
    const score = along + across * 2.5;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  return focusEl(best);
}

export function activate(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el || !el.hasAttribute("data-f")) return false;
  if (el.tagName === "INPUT") return false; // the TV keyboard takes OK
  el.click();
  return true;
}

// One handler for navigation keys, installed once. Arrow keys inside a text box move the
// caret left/right and leave the box up/down.
export function installKeys(extra?: (e: KeyboardEvent) => boolean): () => void {
  const handler = (e: KeyboardEvent) => {
    if (extra && extra(e)) {
      e.preventDefault();
      return;
    }
    const key = navKey(e);
    if (!key) return;
    const typing = isTyping(e.target);
    let handled = true;
    if (key === "back") handled = pressBack();
    else if (key === "ok") handled = typing ? false : activate();
    else if (typing && (key === "left" || key === "right")) handled = false;
    else {
      const el = document.activeElement as HTMLInputElement | null;
      if (typing && el) el.blur();
      handled = move(key);
      if (!handled && typing && el) el.focus();
    }
    if (handled) e.preventDefault();
  };
  document.addEventListener("keydown", handler);
  return () => document.removeEventListener("keydown", handler);
}
