// How large the interface is drawn on this device. It is a device setting, not a profile
// one: the same person wants it larger on a TV than on a phone.
export const displaySizes = ["compact", "default", "large", "xlarge"] as const;
export type DisplaySize = (typeof displaySizes)[number];
const KEY = "opentv:display-size:v1";
export function readDisplaySize(
  storage: Pick<Storage, "getItem"> | undefined = safe(),
): DisplaySize {
  try {
    const value = storage?.getItem(KEY);
    return displaySizes.includes(value as DisplaySize)
      ? (value as DisplaySize)
      : "default";
  } catch {
    return "default";
  }
}
export function applyDisplaySize(size: DisplaySize) {
  if (size === "default") delete document.documentElement.dataset.display;
  else document.documentElement.dataset.display = size;
}
export function saveDisplaySize(size: DisplaySize) {
  applyDisplaySize(size);
  try {
    if (size === "default") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, size);
  } catch {
    /* The size still applies for this visit. */
  }
}
function safe() {
  try {
    return localStorage;
  } catch {
    return undefined;
  }
}
