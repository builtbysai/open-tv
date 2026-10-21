import { appAsset } from "../config/site";
import type { Source } from "../domain/content";
import { archiveSources } from "./archive";
import { radioSources } from "./radio";
import { nasaSources } from "./nasa";
// Every source starts disconnected: you choose the ones you want once, and that choice is
// kept on this device.
export const sources: Source[] = [
  {
    id: "classic-films",
    name: "Archive film collection",
    kind: "m3u",
    url: appAsset("/playlists/movies.m3u"),
    enabled: false,
    classification: "general",
    refreshHours: 168,
    description:
      "Original archive links. Item-level reuse rights are unverified; availability may change.",
    provenance: "https://archive.org/about/terms.php",
  },
  {
    id: "open-cinema",
    name: "Blender Open Movies",
    kind: "catalog",
    url: appAsset("/catalog/open-cinema.json"),
    enabled: false,
    classification: "general",
    refreshHours: 168,
    description:
      "Independent animated films released by Blender Studio under Creative Commons Attribution.",
    provenance: "https://studio.blender.org/films/",
  },
  {
    id: "free-news",
    name: "Free news channels",
    kind: "m3u",
    url: appAsset("/playlists/news.m3u"),
    enabled: false,
    classification: "general",
    refreshHours: 24,
    description:
      "News broadcasters' own free live streams: Al Jazeera, DW, France 24, Euronews, NHK World, ABC News Live, CBS News, NBC News NOW, ABC News Australia, Sky News Arabia, Newsmax, Bloomberg, Fox Weather and NASA TV. Availability can depend on your region.",
    provenance:
      "https://github.com/builtbysai/open-tv/blob/main/docs/SOURCES.md",
  },
  {
    id: "audio-radio-paradise",
    name: "Radio Paradise & KEXP",
    kind: "m3u",
    url: appAsset("/playlists/radio.m3u"),
    enabled: false,
    classification: "general",
    refreshHours: 168,
    description:
      "Listener-supported radio in high quality: Radio Paradise's four mixes (320 kbps) and KEXP Seattle.",
    provenance: "https://radioparadise.com/support",
  },
  {
    id: "audio-somafm",
    name: "SomaFM",
    kind: "directory",
    directory: { provider: "somafm" },
    enabled: false,
    classification: "general",
    refreshHours: 24,
    description:
      "Commercial-free internet radio supported by its listeners: ambient, electronic, indie, jazz and more.",
    provenance: "https://somafm.com/support/",
  },
  ...nasaSources.map((preset): Source => ({
    id: preset.id,
    name: preset.name,
    kind: "directory",
    directory: { provider: "nasa", query: preset.query },
    enabled: false,
    classification: "general",
    refreshHours: 168,
    description: `${preset.description} Public-domain footage from the NASA Image and Video Library.`,
    provenance: "https://images.nasa.gov/",
  })),
  ...archiveSources.map((preset): Source => ({
    id: preset.id,
    name: preset.name,
    kind: "directory",
    directory: {
      provider: "archive",
      collection: preset.collection,
      mediatype: preset.mediatype,
      subject: preset.subject,
    },
    enabled: false,
    classification: "general",
    refreshHours: 168,
    description: `${preset.description} Public collection from the Internet Archive; reuse rights vary by item.`,
    provenance: "https://archive.org/about/terms.php",
  })),
  ...radioSources.map((preset): Source => ({
    id: preset.id,
    name: `Radio · ${preset.name}`,
    kind: "directory",
    directory: {
      provider: "radio",
      tag: preset.tag,
      country: preset.country,
    },
    enabled: false,
    classification: "general",
    refreshHours: 24,
    description: `${preset.description} Stations are listed by Radio Browser; each belongs to its broadcaster.`,
    provenance: "https://www.radio-browser.info/",
  })),
];
