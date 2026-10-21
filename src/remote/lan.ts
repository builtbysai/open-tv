import type { Signal } from "./protocol";

// A direct connection between a phone and the TV on the same network, set up through
// the relay (signaling only) and used for commands, answers and state once it opens.
// No STUN or TURN servers: only local addresses are offered, so it works on the home
// network or not at all, and the relay carries on either way.
export type LanState = "off" | "connecting" | "open" | "failed";
const OPEN_WITHIN = 8000;

export class LanLink {
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private timer = 0;
  state: LanState = "off";
  constructor(
    private readonly signal: (data: Signal) => void,
    private readonly onMessage: (data: string) => void,
    private readonly onState: (state: LanState) => void,
  ) {}
  static supported() {
    return typeof RTCPeerConnection === "function";
  }
  private set(state: LanState) {
    this.state = state;
    this.onState(state);
  }
  private make() {
    this.close(false);
    const pc = new RTCPeerConnection({ iceServers: [] });
    this.pc = pc;
    pc.onicecandidate = (event) => {
      if (event.candidate)
        this.signal({
          kind: "candidate",
          candidate: event.candidate.candidate,
          mid: event.candidate.sdpMid,
          line: event.candidate.sdpMLineIndex,
        });
    };
    pc.onconnectionstatechange = () => {
      if (["failed", "closed", "disconnected"].includes(pc.connectionState))
        this.close();
    };
    this.timer = window.setTimeout(() => {
      if (this.state !== "open") {
        this.close(false);
        this.set("failed");
      }
    }, OPEN_WITHIN);
    this.set("connecting");
    return pc;
  }
  private attach(channel: RTCDataChannel) {
    this.channel = channel;
    channel.onopen = () => {
      clearTimeout(this.timer);
      this.set("open");
    };
    channel.onclose = () => this.close();
    channel.onmessage = (event) => {
      if (typeof event.data === "string" && event.data.length < 300_000)
        this.onMessage(event.data);
    };
  }
  // The phone starts it.
  async start() {
    if (!LanLink.supported()) return;
    const pc = this.make();
    this.attach(pc.createDataChannel("opentv", { ordered: true }));
    try {
      await pc.setLocalDescription(await pc.createOffer());
      this.signal({ kind: "offer", sdp: pc.localDescription?.sdp ?? "" });
    } catch {
      this.close(false);
      this.set("failed");
    }
  }
  // Either side: the other one's part of the handshake.
  async receive(data: Signal) {
    try {
      if (data.kind === "bye") {
        this.close(false);
        return;
      }
      if (data.kind === "offer" && data.sdp) {
        if (!LanLink.supported()) return;
        const pc = this.make();
        pc.ondatachannel = (event) => this.attach(event.channel);
        await pc.setRemoteDescription({ type: "offer", sdp: data.sdp });
        await pc.setLocalDescription(await pc.createAnswer());
        this.signal({ kind: "answer", sdp: pc.localDescription?.sdp ?? "" });
        return;
      }
      if (data.kind === "answer" && data.sdp && this.pc)
        await this.pc.setRemoteDescription({ type: "answer", sdp: data.sdp });
      if (data.kind === "candidate" && data.candidate && this.pc)
        await this.pc.addIceCandidate({
          candidate: data.candidate,
          sdpMid: data.mid ?? null,
          sdpMLineIndex: data.line ?? null,
        });
    } catch {
      /* A stray or late message: the relay remains in use. */
    }
  }
  send(message: object): boolean {
    if (this.channel?.readyState !== "open") return false;
    this.channel.send(JSON.stringify(message));
    return true;
  }
  close(notify = true) {
    clearTimeout(this.timer);
    const was = this.state;
    this.channel?.close();
    this.pc?.close();
    this.channel = null;
    this.pc = null;
    if (was !== "off" && notify) this.set("off");
    else this.state = "off";
  }
}
