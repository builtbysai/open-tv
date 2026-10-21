// Playlists name languages in many ways: "English,german", "fre", "jap", "sgn". Filters
// show one clean, capitalised name for each.
const names: Record<string, string> = {
  en: "English",
  eng: "English",
  fr: "French",
  fre: "French",
  fra: "French",
  de: "German",
  ger: "German",
  deu: "German",
  es: "Spanish",
  spa: "Spanish",
  it: "Italian",
  ita: "Italian",
  pt: "Portuguese",
  por: "Portuguese",
  ru: "Russian",
  rus: "Russian",
  ja: "Japanese",
  jpn: "Japanese",
  jap: "Japanese",
  zh: "Chinese",
  zho: "Chinese",
  chi: "Chinese",
  cmn: "Chinese",
  ko: "Korean",
  kor: "Korean",
  ar: "Arabic",
  ara: "Arabic",
  hi: "Hindi",
  hin: "Hindi",
  nl: "Dutch",
  nld: "Dutch",
  dut: "Dutch",
  sv: "Swedish",
  swe: "Swedish",
  no: "Norwegian",
  nor: "Norwegian",
  nob: "Norwegian",
  da: "Danish",
  dan: "Danish",
  fi: "Finnish",
  fin: "Finnish",
  el: "Greek",
  ell: "Greek",
  gre: "Greek",
  he: "Hebrew",
  heb: "Hebrew",
  tr: "Turkish",
  tur: "Turkish",
  pl: "Polish",
  pol: "Polish",
  cs: "Czech",
  ces: "Czech",
  cze: "Czech",
  hu: "Hungarian",
  hun: "Hungarian",
  ro: "Romanian",
  ron: "Romanian",
  rum: "Romanian",
  uk: "Ukrainian",
  ukr: "Ukrainian",
  th: "Thai",
  tha: "Thai",
  vi: "Vietnamese",
  vie: "Vietnamese",
  id: "Indonesian",
  ind: "Indonesian",
  fa: "Persian",
  fas: "Persian",
  per: "Persian",
  ur: "Urdu",
  urd: "Urdu",
  bn: "Bengali",
  ben: "Bengali",
  ta: "Tamil",
  tam: "Tamil",
  sgn: "Sign language",
};
const title = (value: string) =>
  value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
// Splits a list that may be joined with commas, semicolons, slashes or bars, maps codes
// and spellings to one name, and drops repeats.
export function normalizeLanguages(values: readonly string[]): string[] {
  const out = new Set<string>();
  for (const value of values)
    for (const part of value.split(/[,;/|]/)) {
      const word = part.trim();
      if (!word || isJunk(word)) continue;
      out.add(names[word.toLowerCase()] || title(word));
    }
  return [...out];
}
// Playlists sometimes put a codec, a container or a tag where a language belongs.
const notLanguages = new Set([
  "aac",
  "ac3",
  "flac",
  "hls",
  "mp3",
  "mp4",
  "m3u8",
  "ogg",
  "opus",
  "original",
  "und",
  "unknown",
  "none",
  "n/a",
]);
const isJunk = (word: string) =>
  notLanguages.has(word.toLowerCase()) ||
  !/^\p{L}/u.test(word) ||
  /\d/.test(word) ||
  word.length > 30;
let regions: Intl.DisplayNames | undefined;
const regionName = (code: string) => {
  try {
    regions ??= new Intl.DisplayNames(["en"], { type: "region" });
    const name = regions.of(code.toUpperCase());
    return name && name !== code.toUpperCase() && name !== "Unknown Region"
      ? name
      : code.toUpperCase();
  } catch {
    return code.toUpperCase();
  }
};
// Countries arrive as codes ("US", "gb") and as names; filters show names.
// Spellings of the same country that are not a two-letter code.
const countryAliases: Record<string, string> = {
  usa: "US",
  uk: "GB",
  "united states of america": "US",
  "great britain": "GB",
  turkiye: "TR",
  turkey: "TR",
  "russian federation": "RU",
  "czech republic": "CZ",
  uae: "AE",
  "south korea": "KR",
  "republic of korea": "KR",
};
const plain = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
export function normalizeCountries(values: readonly string[]): string[] {
  const out = new Set<string>();
  for (const value of values)
    for (const part of value.split(/[,;|]/)) {
      const word = part.trim();
      if (!word || /\d/.test(word) || word.length > 40) continue;
      const alias = countryAliases[plain(word)];
      out.add(
        alias
          ? regionName(alias)
          : /^[A-Za-z]{2}$/.test(word)
            ? regionName(word)
            : word,
      );
    }
  return [...out];
}
