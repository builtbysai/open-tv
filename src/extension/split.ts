// Turns one large extension file into a small index plus data files next to it, and back.
// It works on the raw JSON, so anything it does not know about is carried over unchanged.
export const DATA_DIR = "extension-data";
type Json = Record<string, unknown>;
export interface DataFile {
  path: string;
  content: string;
}
const size = (value: unknown) => JSON.stringify(value).length;
const countryOf = (item: unknown): string => {
  const c = (item as { countries?: unknown })?.countries;
  return Array.isArray(c) && typeof c[0] === "string" ? c[0] : "Other";
};
// Countries go into files of at most `maxItems` channels, biggest first, so a person's own
// region is one small file instead of the whole world.
function bins(items: unknown[], maxItems: number) {
  const groups = new Map<string, unknown[]>();
  for (const item of items) {
    const key = countryOf(item);
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  const sorted = [...groups.entries()].sort(
    (a, b) => b[1].length - a[1].length,
  );
  const out: { countries: string[]; items: unknown[] }[] = [];
  for (const [country, list] of sorted) {
    const bin = out.find((b) => b.items.length + list.length <= maxItems);
    if (bin) {
      bin.countries.push(country);
      bin.items.push(...list);
    } else out.push({ countries: [country], items: [...list] });
  }
  return out;
}
const label = (countries: string[]) =>
  countries.length <= 2
    ? countries.join(", ")
    : `${countries.slice(0, 2).join(", ")} and ${countries.length - 2} more`;

export function splitExtension(
  input: Json,
  { minBytes = 150_000, maxItems = 1200 } = {},
): { index: Json; files: DataFile[] } {
  const files: DataFile[] = [];
  const sources: Json[] = [];
  for (const raw of Array.isArray(input.sources)
    ? (input.sources as Json[])
    : []) {
    const id = String(raw.id);
    if (Array.isArray(raw.items) && size(raw.items) > minBytes) {
      const { items, ...rest } = raw;
      bins(items as unknown[], maxItems).forEach((bin, i) => {
        const path = `${DATA_DIR}/${id}-${i + 1}.json`;
        files.push({ path, content: JSON.stringify({ items: bin.items }) });
        sources.push({
          ...rest,
          id: `${id}-${i + 1}`,
          name: `${String(raw.name)} · ${label(bin.countries)}`,
          url: path,
        });
      });
    } else if (typeof raw.m3u === "string" && raw.m3u.length > minBytes) {
      const { m3u, ...rest } = raw;
      const path = `${DATA_DIR}/${id}.m3u`;
      files.push({ path, content: m3u as string });
      sources.push({ ...rest, url: path });
    } else sources.push(raw);
  }
  return { index: { ...input, sources }, files };
}

// The reverse: puts the data files back inside, for a device that can only take one file.
export function bundleExtension(
  index: Json,
  read: (path: string) => string,
): Json {
  const sources = (
    Array.isArray(index.sources) ? (index.sources as Json[]) : []
  ).map((raw) => {
    const url = raw.url;
    if (typeof url !== "string" || /^[a-z][a-z0-9+.-]*:/i.test(url)) return raw;
    const rest = { ...raw };
    delete rest.url;
    const content = read(url);
    return url.endsWith(".m3u")
      ? { ...rest, m3u: content }
      : { ...rest, items: (JSON.parse(content) as { items: unknown[] }).items };
  });
  return { ...index, sources };
}
