// The control relay that lets a phone drive the TV ("Play on TV"). Set it in
// site.config.json ("controlRelay") or with VITE_CONTROL_RELAY at build time. Empty means
// the feature is off and the TV only takes one-time setup from a phone.
declare const __CONTROL_RELAY__: string | undefined;
export function relayOrigin(value: string): string {
  try {
    const url = new URL(value);
    const local = ["localhost", "127.0.0.1"].includes(url.hostname);
    return url.protocol === "wss:" || (url.protocol === "ws:" && local)
      ? url.origin
      : "";
  } catch {
    return "";
  }
}
export const controlRelay = relayOrigin(
  typeof __CONTROL_RELAY__ === "string" ? __CONTROL_RELAY__ : "",
);
