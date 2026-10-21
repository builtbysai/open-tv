import type { Classification, Content } from "./content";
import { applyContentPolicy } from "./content-policy";
import type { ContentPolicy } from "./content-policy";
// Flags titles for the 18+ gate only. It never moves or drops anything you added, so it
// errs toward fewer false matches: "Comic Strip", "Adult Contemporary" stay general.
export const adultPattern =
  /(?:\bxxx\b|\bporn\w*|\bsex(?:ual)?\b|\berotic\w*|\badults?\s+(?:only|channel|content|movies?|tv|video)\b|18\s*\+|\bnsfw\b|\bplayboy\b|\bhustler\b|\bmycam\w*|\bstrip(?:tease|pers?|club)\b|\bnude\w*|\bnaked\b|\bэро\w*)/iu;
export function classify(
  text: string,
  declared: Classification = "general",
): Classification {
  // Adult Swim is a general entertainment brand, not an explicit-content marker.
  if (adultPattern.test(text.replace(/adult swim/gi, ""))) return "adult";
  return declared;
}
export function canView(
  item: Pick<Content, "classification">,
  adultUnlocked = false,
): boolean {
  return item.classification === "general" || adultUnlocked;
}
export function queryCatalog(
  items: Content[],
  options: {
    adultUnlocked?: boolean;
    text?: string;
    type?: string;
    genre?: string;
    language?: string;
    country?: string;
    searchIndex?: ReadonlyMap<string, string>;
    policy?: ContentPolicy;
  } = {},
): Content[] {
  const q = options.text?.normalize("NFKC").toLocaleLowerCase().trim();
  return applyContentPolicy(items, options.policy).filter(
    (item) =>
      canView(item, options.adultUnlocked) &&
      (!options.type || item.type === options.type) &&
      (!options.genre || item.genres.includes(options.genre)) &&
      (!options.language || item.languages.includes(options.language)) &&
      (!options.country || item.countries.includes(options.country)) &&
      (!q ||
        (
          options.searchIndex?.get(item.id) ??
          [item.title, ...item.genres, ...item.languages, ...item.countries]
            .join(" ")
            .normalize("NFKC")
            .toLocaleLowerCase()
        ).includes(q)),
  );
}
export function buildSearchIndex(
  items: Content[],
): ReadonlyMap<string, string> {
  return new Map(
    items.map((item) => [
      item.id,
      [item.title, ...item.genres, ...item.languages, ...item.countries]
        .join(" ")
        .normalize("NFKC")
        .toLocaleLowerCase(),
    ]),
  );
}
export async function hashPin(pin: string, salt: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new TextEncoder().encode(salt),
      iterations: 210000,
      hash: "SHA-256",
    },
    key,
    256,
  );
  return Array.from(new Uint8Array(bits), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
