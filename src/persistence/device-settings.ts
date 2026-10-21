import { useSyncExternalStore } from "react";

// Choices that belong to this device, not to a person: a phone, a laptop and a television
// each want their own. They are not part of a profile, a backup or a phone transfer.
export interface DeviceSettings {
  // Show Open TV's own controls for an embedded server that can be driven.
  embedSync: boolean;
  // Fade the player controls while a picture plays.
  autoHideControls: boolean;
  // How far the jump buttons and arrow keys skip.
  skipSeconds: 10 | 15 | 30;
  // Animations: follow the system setting, or always keep them minimal here.
  motion: "system" | "reduced";
  // In the Google TV app: open the receiver again when the TV starts.
  autostart: boolean;
}
export const defaultDeviceSettings: DeviceSettings = {
  embedSync: true,
  autoHideControls: true,
  skipSeconds: 10,
  motion: "system",
  autostart: true,
};
const KEY = "opentv:device:v1";
export function validateDeviceSettings(value: unknown): DeviceSettings {
  const v = (value && typeof value === "object" ? value : {}) as Record<
    string,
    unknown
  >;
  return {
    embedSync: v.embedSync !== false,
    autoHideControls: v.autoHideControls !== false,
    skipSeconds:
      v.skipSeconds === 15 || v.skipSeconds === 30 ? v.skipSeconds : 10,
    motion: v.motion === "reduced" ? "reduced" : "system",
    autostart: v.autostart !== false,
  };
}
function read(): DeviceSettings {
  try {
    return validateDeviceSettings(
      JSON.parse(localStorage.getItem(KEY) || "{}"),
    );
  } catch {
    return defaultDeviceSettings;
  }
}
let current = read();
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
export function applyDeviceSettings(settings: DeviceSettings = current) {
  const root = document.documentElement;
  if (settings.motion === "reduced") root.dataset.motion = "reduced";
  else delete root.dataset.motion;
}
export function updateDeviceSettings(patch: Partial<DeviceSettings>) {
  current = validateDeviceSettings({ ...current, ...patch });
  try {
    localStorage.setItem(KEY, JSON.stringify(current));
  } catch {
    /* The choice lasts for this visit. */
  }
  applyDeviceSettings(current);
  emit();
}
export function useDeviceSettings(): [
  DeviceSettings,
  (patch: Partial<DeviceSettings>) => void,
] {
  const settings = useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      const storage = (e: StorageEvent) => {
        if (e.key === KEY) {
          current = read();
          applyDeviceSettings(current);
          listener();
        }
      };
      window.addEventListener("storage", storage);
      return () => {
        listeners.delete(listener);
        window.removeEventListener("storage", storage);
      };
    },
    () => current,
  );
  return [settings, updateDeviceSettings];
}
