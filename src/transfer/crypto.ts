const encoder = new TextEncoder();
export function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
export function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}
export const randomToken = (bytes: number) =>
  toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
const importKey = (key: string) =>
  crypto.subtle.importKey(
    "raw",
    fromBase64Url(key) as BufferSource,
    "AES-GCM",
    false,
    ["encrypt", "decrypt"],
  );
// The key travels only in the QR code's URL fragment, never to the relay.
export async function encrypt(key: string, value: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await importKey(key),
    encoder.encode(JSON.stringify(value)),
  );
  const out = new Uint8Array(iv.length + data.byteLength);
  out.set(iv);
  out.set(new Uint8Array(data), iv.length);
  return toBase64Url(out);
}
export async function decrypt(key: string, text: string): Promise<unknown> {
  const bytes = fromBase64Url(text);
  const data = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: bytes.slice(0, 12) as BufferSource },
    await importKey(key),
    bytes.slice(12) as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(data));
}
