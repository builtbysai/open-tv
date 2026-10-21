// Moves the entry with `id` one place earlier (-1) or later (1); other lists are unchanged.
export function moveInList<T extends { id: string }>(
  list: T[],
  id: string,
  step: -1 | 1,
): T[] {
  const i = list.findIndex((x) => x.id === id);
  const j = i + step;
  if (i < 0 || j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
