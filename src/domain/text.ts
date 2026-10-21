// Shortens text to a limit at a word boundary and marks the cut, so a description never
// ends in the middle of a word.
export function clipText(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, Math.max(1, max - 1));
  const space = cut.search(/\s\S*$/);
  const base = space > max * 0.6 ? cut.slice(0, space) : cut;
  return `${base.replace(/[\s.,;:!?-]+$/, "")}…`;
}
