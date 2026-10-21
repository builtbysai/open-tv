import { CLOSE, type RelayMessage } from "./protocol";

export type SocketStatus =
  | "connecting"
  | "open"
  | "offline"
  // The relay refused these credentials (revoked, wrong secret); retrying won't help.
  | "refused"
  // Another window took over as this TV.
  | "replaced";

// One WebSocket to the control relay that comes back by itself: after a drop it retries
// with growing pauses, and at once when the network or the app returns. It never sends
// heartbeats; an idle connection costs nothing on the relay.
export class ControlSocket {
  private ws: WebSocket | null = null;
  private timer = 0;
  private attempt = 0;
  private stopped = true;
  private readonly wake = () => {
    if (this.stopped || this.ws) return;
    clearTimeout(this.timer);
    this.connect();
  };
  private readonly visible = () => {
    if (document.visibilityState === "visible") this.wake();
  };
  constructor(
    private readonly url: string,
    private readonly protocols: () => string[],
    private readonly onMessage: (message: RelayMessage) => void,
    private readonly onStatus: (status: SocketStatus) => void,
  ) {}
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    window.addEventListener("online", this.wake);
    window.addEventListener("opentv:resume", this.wake);
    document.addEventListener("visibilitychange", this.visible);
    this.connect();
  }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    window.removeEventListener("online", this.wake);
    window.removeEventListener("opentv:resume", this.wake);
    document.removeEventListener("visibilitychange", this.visible);
    const ws = this.ws;
    this.ws = null;
    ws?.close(1000);
  }
  send(message: object): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(message));
    return true;
  }
  get open() {
    return this.ws?.readyState === WebSocket.OPEN;
  }
  private connect() {
    this.onStatus("connecting");
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.url, this.protocols());
    } catch {
      this.retry();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.onStatus("open");
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== "string") return;
      try {
        this.onMessage(JSON.parse(event.data) as RelayMessage);
      } catch {
        /* Not ours. */
      }
    };
    ws.onclose = (event) => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.stopped) return;
      if (
        event.code === CLOSE.revoked ||
        event.code === CLOSE.badSecret ||
        event.code === CLOSE.badRequest
      ) {
        this.stopped = true;
        this.onStatus("refused");
        return;
      }
      if (event.code === CLOSE.replaced) {
        this.stopped = true;
        this.onStatus("replaced");
        return;
      }
      this.retry();
    };
  }
  private retry() {
    this.onStatus("offline");
    const base = Math.min(30000, 1000 * 2 ** this.attempt++);
    this.timer = window.setTimeout(
      () => this.connect(),
      base / 2 + Math.random() * (base / 2),
    );
  }
}
