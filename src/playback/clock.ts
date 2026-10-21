// Whole seconds: seek bars and time readouts both show this value, so they never disagree
// (a bar stepping in fives, or rounding where the clock floors, did).
export const wholeSeconds = (value: number) =>
  Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
export function clock(value: number) {
  const s = wholeSeconds(value);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rest = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${rest}` : `${m}:${rest}`;
}
