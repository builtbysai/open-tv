import type { Content } from "./content";
// A short picture-quality label when a title or its streams say so: 4K, 1080p, 720p, and
// HDR. Nothing is claimed that the listing does not state.
export function qualityBadge(
  item: Pick<Content, "title" | "streams">,
): string | undefined {
  const text = [item.title, ...item.streams.map((s) => s.quality || "")].join(
    " ",
  );
  const size = /\b(?:2160p|4k|uhd)\b/i.test(text)
    ? "4K"
    : /\b(?:1080p|1080i|fhd)\b/i.test(text)
      ? "1080p"
      : /\b720p\b/i.test(text)
        ? "720p"
        : undefined;
  const hdr = /\b(?:hdr10?\+?|dolby vision)\b/i.test(text) ? "HDR" : undefined;
  return [size, hdr].filter(Boolean).join(" ") || undefined;
}
