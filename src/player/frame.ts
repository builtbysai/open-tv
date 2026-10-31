import { signal } from "@preact/signals";
import {
  emptyBridge,
  encodeCommand,
  hello,
  parseBridgeMessage,
  playerJsSubscriptions,
  reduceBridge,
  type BridgeCommand,
  type BridgeState,
  type KeyName,
} from "./bridge";

// One link to one frame. It owns what the frame boundary makes awkward:
//
//  - Messages are accepted only from this frame's window AND the origin of the address that was
//    configured. Commands are posted to that origin only, never "*". A page that redirects the
//    frame to another origin therefore loses control instead of leaking it.
//  - A frame may finish loading before our listener exists, or its script may start later than
//    its `load` event, so we say hello on load and keep saying it until it answers.
//  - Keyboard events inside a cross-origin frame never reach us. Taking focus back for our own
//    overlay (and giving it to the picture again) is done here, by moving DOM focus.
export class FrameLink {
  readonly state = signal<BridgeState>(emptyBridge);
  readonly loaded = signal(false);
  onKey: (key: KeyName) => void = () => {};
  onReady: () => void = () => {};
  private timer: ReturnType<typeof setTimeout> | undefined;
  private tries = 0;
  private stopped = false;

  constructor(
    private frame: HTMLIFrameElement,
    private origin: string,
  ) {}

  start() {
    window.addEventListener("message", this.listen);
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    window.removeEventListener("message", this.listen);
  }

  // Call from the iframe's load event.
  handleLoad() {
    this.loaded.value = true;
    this.tries = 0;
    this.greet();
  }

  private post(message: unknown) {
    try {
      this.frame.contentWindow?.postMessage(message, this.origin);
    } catch {
      /* A frame that is gone cannot be told anything. */
    }
  }
  private greet = () => {
    if (this.stopped || this.state.value.ready || this.tries >= 15) return;
    this.tries++;
    this.post(hello());
    // A Player.js player only reports to a parent that asks for each event.
    for (const message of playerJsSubscriptions()) this.post(message);
    this.timer = setTimeout(this.greet, 1000);
  };

  private listen = (event: MessageEvent) => {
    if (event.source !== this.frame.contentWindow || event.origin !== this.origin) return;
    const parsed = parseBridgeMessage(event.data);
    if (!parsed) return;
    if (parsed.k === "key") {
      this.onKey(parsed.key);
      return;
    }
    const wasReady = this.state.value.ready;
    this.state.value = reduceBridge(this.state.value, parsed);
    if (!wasReady && this.state.value.ready) {
      clearTimeout(this.timer);
      this.onReady();
    }
  };

  send(cmd: BridgeCommand): boolean {
    const message = encodeCommand(this.state.value, cmd);
    if (!message) return false;
    this.post(message);
    return true;
  }

  // Give the picture the keyboard (so a physical remote's OK and arrows reach the player).
  focusFrame() {
    try {
      this.frame.focus();
      this.frame.contentWindow?.focus();
    } catch {
      /* Cross-origin focus can be refused; the frame is still on screen. */
    }
  }
  // Take it back, so the D-pad drives our overlay.
  blurFrame() {
    try {
      this.frame.blur();
      (document.activeElement as HTMLElement | null)?.blur?.();
      window.focus();
    } catch {
      /* Nothing to do. */
    }
  }
}
