import { signal } from "@preact/signals";
import { CLOSE, PROTOCOL, parseRelayMessage, type RelayMessage } from "./protocol";

// connecting: dialing. online: the relay accepted us. offline: dropped, retrying.
// refused: the relay said no and retrying would not help (removed, wrong secret, bad code).
export type Link = "idle" | "connecting" | "online" | "offline" | "refused";

export const relayUrl = (tvId: string): string | null => {
  const base = __RELAY_URL__.replace(/\/+$/, "");
  return base ? `${base}/v1/tv/${tvId}` : null;
};

// A WebSocket that keeps itself connected. Credentials travel in the subprotocol list, never
// in the URL, so they stay out of logs. Used by both the TV and the phone.
export class RelayClient {
  readonly link = signal<Link>("idle");
  readonly reason = signal("");
  onMessage: (m: RelayMessage) => void = () => {};
  onOpen: () => void = () => {};
  onRefused: (code: number, reason: string) => void = () => {};
  private ws: WebSocket | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private attempt = 0;
  private wanted = false;

  // `credentials` is read on every attempt, so a rotated token is picked up on reconnect.
  constructor(
    private url: () => string | null,
    private credentials: () => string[],
  ) {}

  start() {
    if (this.wanted) return;
    this.wanted = true;
    this.attempt = 0;
    window.addEventListener("online", this.nudge);
    this.connect();
  }
  stop() {
    this.wanted = false;
    clearTimeout(this.timer);
    window.removeEventListener("online", this.nudge);
    this.drop();
    this.link.value = "idle";
  }
  private drop() {
    const ws = this.ws;
    this.ws = null;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* Already closed. */
      }
    }
  }
  private nudge = () => {
    if (this.wanted && this.link.value === "offline") {
      clearTimeout(this.timer);
      this.connect();
    }
  };

  private connect() {
    clearTimeout(this.timer);
    this.drop();
    const url = this.url();
    if (!url) {
      this.link.value = "refused";
      this.reason.value = "No relay is configured.";
      return;
    }
    this.link.value = "connecting";
    let ws: WebSocket;
    try {
      ws = new WebSocket(url, [PROTOCOL, ...this.credentials()]);
    } catch {
      this.retry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.link.value = "online";
      this.reason.value = "";
      this.onOpen();
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      const m = parseRelayMessage(event.data);
      if (m) this.onMessage(m);
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      const fatal =
        event.code === CLOSE.revoked || event.code === CLOSE.badSecret || event.code === CLOSE.badRequest || event.code === CLOSE.replaced;
      if (fatal) {
        this.wanted = false;
        this.link.value = "refused";
        this.reason.value = event.reason || "The relay refused the connection.";
        window.removeEventListener("online", this.nudge);
        this.onRefused(event.code, this.reason.value);
      } else this.retry();
    };
    ws.onerror = () => {
      /* onclose follows and decides. */
    };
  }

  private retry() {
    if (!this.wanted) return;
    this.link.value = "offline";
    // 1s, 2s, 4s ... capped at 30s, with jitter so a restarted relay is not stampeded.
    const delay = Math.min(30_000, 1000 * Math.pow(2, this.attempt++)) * (0.7 + Math.random() * 0.6);
    this.timer = setTimeout(() => this.connect(), delay);
  }

  send(message: object): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return false;
    try {
      ws.send(JSON.stringify(message));
      return true;
    } catch {
      return false;
    }
  }
}
