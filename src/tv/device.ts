import type { PlaybackPhase } from "../playback/recovery";
type DeviceMessage =
  | { type: "autostart"; enabled: boolean }
  | { type: "foreground" }
  | { type: "volume"; step: -1 | 0 | 1 }
  | { type: "privacy"; enabled: boolean }
  | {
      type: "media";
      phase: PlaybackPhase;
      title: string;
      position: number;
      duration: number;
    };
export function postDeviceMessage(message: DeviceMessage): void {
  try {
    window.OpenTVDevice?.postMessage(JSON.stringify(message));
  } catch {
    /* Browser or older WebView: web controls remain available. */
  }
}
