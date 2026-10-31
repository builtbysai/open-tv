// Which device is this, and what can the host around it do?
export type Role = "tv" | "web";

// Smart-TV browsers and the Android TV / Fire TV host announce themselves. Everything else
// is a phone, tablet or computer, which starts as the remote.
const TV_UA =
  /Tizen|Web0S|WebOS|NetCast|SMART-TV|SmartTV|HbbTV|BRAVIA|VIZIO|Roku|CrKey|Android TV|GoogleTV|AFT[A-Z]|OpenTVAndroid/i;

export const isTvUserAgent = (ua = navigator.userAgent) => TV_UA.test(ua);

const ROLE_KEY = "otv:role";
export function detectRole(
  search = location.search,
  ua = navigator.userAgent,
): Role {
  const q = new URLSearchParams(search);
  const forced = q.get("role") || (q.get("tv") === "1" ? "tv" : "");
  // "remote" is the old name for the phone/web role.
  if (forced === "tv") return "tv";
  if (forced === "web" || forced === "remote") return "web";
  try {
    const saved = localStorage.getItem(ROLE_KEY);
    if (saved === "tv") return "tv";
    if (saved === "web" || saved === "remote") return "web";
  } catch {
    /* Storage can be disabled. */
  }
  return TV_UA.test(ua) ? "tv" : "web";
}
export function rememberRole(role: Role | null) {
  try {
    if (role) localStorage.setItem(ROLE_KEY, role);
    else localStorage.removeItem(ROLE_KEY);
  } catch {
    /* Storage can be disabled. */
  }
}

// The Android host (android/) exposes one main-frame-only message port, `OpenTVDevice`.
// Outside the host this is a no-op, so callers never need to check.
interface HostPort {
  postMessage(message: string): void;
}
const port = (): HostPort | undefined =>
  (window as unknown as { OpenTVDevice?: HostPort }).OpenTVDevice;
export const hasHost = () => !!port();
export function hostSend(message: Record<string, unknown>) {
  try {
    port()?.postMessage(JSON.stringify(message));
  } catch {
    /* Never let a host problem break the page. */
  }
}

// Autoplay with sound needs a user gesture in browsers. The Android host lifts that rule;
// in a TV browser one remote press on our page unlocks it for the rest of the session.
export function playbackUnlocked(): boolean {
  if (hasHost()) return true;
  const activation = (
    navigator as unknown as { userActivation?: { hasBeenActive: boolean } }
  ).userActivation;
  return activation ? activation.hasBeenActive : true;
}

export const appOrigin = () => location.origin;

// Old TV engines lack AbortSignal.timeout / .any; this is the one helper for both.
export function timeoutSignal(ms: number, parent?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const stop = () => {
    clearTimeout(timer);
    controller.abort();
  };
  if (parent) {
    if (parent.aborted) stop();
    else parent.addEventListener("abort", stop, { once: true });
  }
  return controller.signal;
}
