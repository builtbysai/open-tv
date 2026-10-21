// A music provider is a public web service the user points the app at, by address:
// instances come and go, so the address lives in settings, not in code. The one exception
// is the Internet Archive ("archive"), which is built in and never stored in settings.
export type MusicProviderType = "invidious" | "piped" | "audius" | "archive";
// The types a person can add in Settings.
export const musicProviderTypes: readonly MusicProviderType[] = [
  "invidious",
  "piped",
  "audius",
];
export const musicProviderLabels: Record<MusicProviderType, string> = {
  invidious: "Invidious",
  piped: "Piped",
  audius: "Audius",
  archive: "Internet Archive",
};
// Video ids, Audius ids ("au_…"), and Internet Archive item ids ("ia_…", which may hold dots).
export const SONG_ID = /^(?:[A-Za-z0-9_-]{6,20}|ia_[A-Za-z0-9._-]{1,100})$/;
export interface MusicProvider {
  id: string;
  name: string;
  type: MusicProviderType;
  // Invidious: the instance address. Piped: the instance's API address. Audius: its API
  // address (https://api.audius.co).
  base: string;
  enabled: boolean;
}
export interface Song {
  id: string;
  title: string;
  artist: string;
  thumbnail?: string;
  // Seconds.
  duration?: number;
  // The provider it came from, shown next to it ("Audius", "Internet Archive").
  source?: string;
}
export interface AudioStream {
  url: string;
  mime: string;
  // Bits per second, when the service says.
  bitrate: number;
}
// The same five calls for every provider type, so nothing else in the app knows which one
// is plugged in.
export interface MusicApi {
  searchSongs(query: string, signal?: AbortSignal): Promise<Song[]>;
  // Audio-only streams for one video, best first.
  resolveAudio(id: string, signal?: AbortSignal): Promise<AudioStream[]>;
  // A page that plays the video, for when no direct audio works. Null when there is none.
  embedUrl(id: string): string | null;
  trending(signal?: AbortSignal): Promise<Song[]>;
  playlist(playlistId: string, signal?: AbortSignal): Promise<Song[]>;
}
