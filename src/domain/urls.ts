// A large catalog checks the same addresses again and again, so answers for plain
// addresses are remembered (and dropped all at once if there are very many).
const checked = new Map<string, string | null>();
export function mediaUrl(value: string, base?: string): string | null {
  const remember = base === undefined && value.length < 600;
  if (remember && checked.has(value)) return checked.get(value) ?? null;
  let result: string | null = null;
  try {
    const url = new URL(value, base);
    if (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
      result = url.href;
  } catch {
    result = null;
  }
  if (remember) {
    if (checked.size >= 60000) checked.clear();
    checked.set(value, result);
  }
  return result;
}
export function mixedContent(
  value: string,
  protocol = typeof location === "undefined" ? "http:" : location.protocol,
): boolean {
  return (
    protocol === "https:" &&
    new URL(value, "https://open-tv.invalid").protocol === "http:"
  );
}
export function sensitiveUrl(value: string): boolean {
  try {
    const u = new URL(value);
    return (
      !!u.username ||
      !!u.password ||
      !!u.search ||
      /\/(live|movie|series)\/[^/]+\/[^/]+(?:\/|$)/i.test(u.pathname)
    );
  } catch {
    return true;
  }
}
export function persistableUrl(value: string): boolean {
  return !!mediaUrl(value) && !sensitiveUrl(value);
}
export function streamFormat(value: string): "hls" | "video" | "audio" {
  try {
    const path = new URL(value).pathname;
    return /\.m3u8$/i.test(path)
      ? "hls"
      : /\.(mp3|aac|ogg)$/i.test(path)
        ? "audio"
        : "video";
  } catch {
    return "video";
  }
}
