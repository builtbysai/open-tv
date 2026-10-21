import { AppError } from "../domain/errors";
import { limitedText } from "../providers/http";

export const str = (value: unknown, max = 300): string =>
  typeof value === "string"
    ? value
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";
export const num = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
// An address from a provider's answer: https only, resolved against the provider.
export function httpsUrl(value: unknown, base: string): string | undefined {
  try {
    const url = new URL(String(value), base);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}
export async function getJson(
  url: string,
  signal?: AbortSignal,
  timeoutMs = 12000,
): Promise<unknown> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const response = await fetch(url, {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    credentials: "omit",
    referrerPolicy: "no-referrer",
    headers: { accept: "application/json" },
  });
  if (!response.ok)
    throw new AppError(
      "network",
      `The music service answered ${response.status}.`,
    );
  try {
    return JSON.parse(await limitedText(response, 8_000_000));
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new AppError(
      "format",
      "The music service sent something unreadable.",
    );
  }
}
export const list = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : [];
export const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

// A plain-words reason a request to a music instance failed, for the health check.
export function failureReason(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError")
    return "No answer within 10 seconds.";
  if (error instanceof TypeError)
    return "The browser blocked the request. The instance is offline, or it does not allow this site (CORS).";
  const status = /answered (\d{3})/.exec(
    error instanceof Error ? error.message : "",
  )?.[1];
  if (status === "401" || status === "403")
    return "The instance has its API turned off or needs a login.";
  if (status === "404") return "This address is not an instance's API.";
  if (status && status.startsWith("5"))
    return `The instance is failing (${status}).`;
  return "It answered, but not with music data. Check the type and address.";
}
