// Choosing an audio track the device can actually decode. Movie files from personal servers
// often carry AC-3, E-AC-3 or DTS first (and flagged default); a TV browser that cannot decode
// them plays the picture in silence. Decodable beats default; language decides among decodable.
export interface AudioTrackInfo {
  id: number;
  codec?: string;
  lang?: string;
  name?: string;
  channels?: number;
  default?: boolean;
}
export type Decodable = "yes" | "no" | "unknown";
export interface CodecProbe {
  isTypeSupported?(type: string): boolean;
  canPlayType?(type: string): string;
}
const FAMILIES: [RegExp, string, string[]][] = [
  [/^(mp4a\.40\.\d+|aac)$/, "AAC", ['audio/mp4; codecs="mp4a.40.2"']],
  [
    /^(mp4a\.(40\.34|69|6b)|mp3|mpeg)$/,
    "MP3",
    ['audio/mp4; codecs="mp4a.40.34"', "audio/mpeg"],
  ],
  [/^opus$/, "Opus", ['audio/webm; codecs="opus"', 'audio/mp4; codecs="opus"']],
  [/^vorbis$/, "Vorbis", ['audio/webm; codecs="vorbis"']],
  [/^(flac|fla)$/, "FLAC", ['audio/mp4; codecs="flac"']],
  [/^(ac-3|ac3)$/, "AC-3 (Dolby Digital)", ['audio/mp4; codecs="ac-3"']],
  [
    /^(ec-3|eac3|e-ac-3)$/,
    "E-AC-3 (Dolby Digital Plus)",
    ['audio/mp4; codecs="ec-3"'],
  ],
  [/^(ac-4)/, "AC-4", ['audio/mp4; codecs="ac-4"']],
  [
    /^(dts|dtsc|dtsh|dtse|dtsl|dtsx|dts-hd)/,
    "DTS",
    ['audio/mp4; codecs="dtsc"'],
  ],
  [/^truehd|^mlpa/, "Dolby TrueHD", ['audio/mp4; codecs="mlpa"']],
];
const family = (codec?: string) => {
  const c = (codec ?? "").trim().toLowerCase();
  return c ? FAMILIES.find(([pattern]) => pattern.test(c)) : undefined;
};
/** A readable name for a codec string such as "mp4a.40.2" or "ac-3". */
export function codecName(codec?: string): string {
  return family(codec)?.[1] ?? (codec ? codec.toUpperCase() : "unknown");
}
/** Whether this device says it can decode the codec. An unnamed codec is "unknown". */
export function canDecode(
  codec: string | undefined,
  probe: CodecProbe,
): Decodable {
  const match = family(codec);
  if (!match) return "unknown";
  const types = match[2];
  let asked = false;
  for (const type of types) {
    if (probe.isTypeSupported) {
      asked = true;
      try {
        if (probe.isTypeSupported(type)) return "yes";
      } catch {
        /* A probe that throws says nothing. */
      }
    }
    if (probe.canPlayType) {
      asked = true;
      if (probe.canPlayType(type)) return "yes";
    }
  }
  return asked ? "no" : "unknown";
}
/** The device's own probes: MediaSource when there is one, the media element otherwise. */
export function deviceProbe(element?: HTMLMediaElement): CodecProbe {
  const source = globalThis.MediaSource;
  return {
    isTypeSupported: source?.isTypeSupported?.bind(source),
    canPlayType: element ? (type) => element.canPlayType(type) : undefined,
  };
}
export interface AudioChoice {
  // The track to play, or null when none can be decoded here.
  id: number | null;
  decodable: Record<number, Decodable>;
  // Codecs that could not be decoded, for an honest message.
  undecodable: string[];
  // Set when the choice passed over the default or first track.
  fallback?: string;
}
const primary = (lang?: string) => (lang ?? "").toLowerCase().split(/[-_]/)[0];
export function chooseAudioTrack(
  tracks: AudioTrackInfo[],
  {
    languages = [],
    probe,
    remembered,
  }: {
    languages?: readonly string[];
    probe: CodecProbe;
    // The viewer's earlier pick for this title.
    remembered?: { lang?: string; codec?: string; name?: string };
  },
): AudioChoice {
  const decodable: Record<number, Decodable> = {};
  for (const t of tracks) decodable[t.id] = canDecode(t.codec, probe);
  const undecodable = [
    ...new Set(
      tracks
        .filter((t) => decodable[t.id] === "no")
        .map((t) => codecName(t.codec)),
    ),
  ];
  const usable = tracks.filter((t) => decodable[t.id] !== "no");
  if (!usable.length) return { id: null, decodable, undecodable };
  const wanted = languages.map(primary).filter(Boolean);
  const mine = (t: AudioTrackInfo) =>
    !!remembered &&
    primary(remembered.lang) === primary(t.lang) &&
    (!remembered.codec || remembered.codec === t.codec) &&
    (!remembered.name || remembered.name === t.name);
  const score = (t: AudioTrackInfo) => {
    const at = wanted.indexOf(primary(t.lang));
    return (
      (mine(t) ? 0 : 1000) +
      (at >= 0 ? at * 10 : 500) +
      (decodable[t.id] === "yes" ? 0 : 5) +
      (t.default ? 0 : 1)
    );
  };
  const best = usable.reduce((a, b) => (score(b) < score(a) ? b : a));
  const natural = tracks.find((t) => t.default) ?? tracks[0];
  const fallback =
    natural && natural.id !== best.id && decodable[natural.id] === "no"
      ? `Playing ${codecName(best.codec)} audio: this device can't play ${codecName(natural.codec)}.`
      : undefined;
  return { id: best.id, decodable, undecodable, fallback };
}
/** The message for a title whose every audio track is undecodable here. */
export function undecodableMessage(codecs: string[]): string {
  const names = codecs.length ? codecs.join(", ") : "this format";
  return `This title's audio is ${names}, which this device can't play. Try another source, or ask the server to convert audio to AAC.`;
}
/** A one-line description of a track for menus and the log. */
export function describeTrack(
  t: AudioTrackInfo,
  decodable?: Decodable,
): string {
  return [
    t.name || t.lang || `Audio ${t.id + 1}`,
    t.codec ? codecName(t.codec) : "",
    t.channels ? `${t.channels} ch` : "",
    decodable === "no" ? "can't play here" : "",
  ]
    .filter(Boolean)
    .join(" · ");
}
// A server that converts on request: Jellyfin and Emby take AudioCodec on their HLS
// playlists. Returns an address that asks for AAC audio, or null when this is not one.
export function transcodeAudioUrl(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const match =
    /^(.*\/Videos\/[^/]+\/)(master\.m3u8|main\.m3u8|stream(\.[a-z0-9]+)?)$/i.exec(
      parsed.pathname,
    );
  if (!match) return null;
  const query = parsed.searchParams;
  if (
    query.get("AudioCodec") === "aac" &&
    query.get("AllowAudioStreamCopy") === "false"
  )
    return null;
  parsed.pathname = `${match[1]}master.m3u8`;
  query.delete("static");
  query.set("AudioCodec", "aac");
  query.set("AllowAudioStreamCopy", "false");
  if (!query.get("VideoCodec")) query.set("VideoCodec", "h264,hevc");
  return parsed.toString();
}
