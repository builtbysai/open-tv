export class AppError extends Error {
  constructor(
    public code:
      "network" | "format" | "storage" | "playback" | "authorization",
    message: string,
  ) {
    super(message);
  }
}
// Diagnostics intentionally contain neither URLs, titles, queries, nor provider responses.
const events: { code: string; at: string }[] = [];
export function diagnose(code: string) {
  events.push({ code, at: new Date().toISOString() });
  if (events.length > 30) events.shift();
}
export function diagnostics() {
  return [...events];
}
export function friendlyError(error: unknown): string {
  return error instanceof AppError
    ? error.message
    : "Couldn’t load this source. Try again.";
}
