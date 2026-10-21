import { AppError } from "../domain/errors";
import { mixedContent } from "../domain/urls";
export function sourceFetch(
  url: string,
  options?: RequestInit,
): Promise<Response> {
  if (mixedContent(url))
    throw new AppError(
      "network",
      "HTTP data cannot be loaded by this secure app. Use an authorized HTTPS data endpoint. For M3U or XMLTV, file import is also available; the playback relay handles media, not arbitrary APIs.",
    );
  return fetch(url, options);
}
export async function limitedText(
  response: Response,
  limit = 15_000_000,
): Promise<string> {
  if (Number(response.headers.get("content-length") || 0) > limit)
    throw new AppError(
      "format",
      "This source exceeds the 15 MB import limit. Split it into smaller sources.",
    );
  if (!response.body) return "";
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let bytes = 0,
    text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) {
        await reader.cancel();
        throw new AppError(
          "format",
          "This source exceeds the 15 MB import limit. Split it into smaller sources.",
        );
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}
