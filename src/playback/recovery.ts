export type PlaybackPhase =
  | "idle"
  | "loading"
  | "playing"
  | "paused"
  | "buffering"
  | "recovering"
  | "ended"
  | "error";
export class RecoveryBudget {
  private used = 0;
  private attempted = new Set<number>([0]);
  constructor(private limit = 2) {}
  retry(): boolean {
    if (this.used >= this.limit) return false;
    this.used++;
    return true;
  }
  alternative(total: number): number | null {
    if (!this.retry()) return null;
    for (let index = 0; index < total; index++)
      if (!this.attempted.has(index)) {
        this.attempted.add(index);
        return index;
      }
    return null;
  }
  get attempts() {
    return this.used;
  }
}
