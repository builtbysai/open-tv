// Random ids and the end-to-end layer for setup data. The relay is only a post office: the
// TMDB key and server list are encrypted with a key that travels in the pairing QR's URL
// fragment, which browsers never send to any server, so the relay sees ciphertext only.

export function b64u(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function fromB64u(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const s = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
export function randomId(bytes = 16): string {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  return b64u(raw);
}

export const newSecretKey = () => randomId(32);

const subtle = () => {
  if (!crypto.subtle) throw new Error("Encryption needs a secure (https) page.");
  return crypto.subtle;
};
export async function importKey(secret: string): Promise<CryptoKey> {
  const raw = fromB64u(secret);
  if (raw.length !== 32) throw new Error("bad key");
  return subtle().importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
export interface Sealed {
  iv: string;
  ct: string;
}
export async function seal(key: CryptoKey, plaintext: string): Promise<Sealed> {
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ct = await subtle().encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  return { iv: b64u(iv), ct: b64u(new Uint8Array(ct)) };
}
export async function open(key: CryptoKey, sealed: Sealed): Promise<string | null> {
  try {
    const plain = await subtle().decrypt(
      { name: "AES-GCM", iv: fromB64u(sealed.iv) },
      key,
      fromB64u(sealed.ct),
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null; // Wrong key or tampered: ignore the message.
  }
}
