# Content sources

Open TV ships a small set of built-in sources and reads everything else from an
[extension file](EXTENSIONS.md) that you add yourself. Nothing here grants rights to
content: a listing is not a license, and regional limits, CORS, codecs and outages can
prevent playback. Open TV does not bypass DRM, paywalls or geography.

## Built in

| Source                  | How it is read                                                                                                                                                                                                                      | Rights and limits                                                                                         |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Blender Open Movies     | Reviewed catalog (`public/catalog/open-cinema.json`): Big Buck Bunny, Sintel, Elephants Dream, Tears of Steel, with Internet Archive files and Blender artwork                                                                      | CC BY 3.0, attributed in the details and player and in [THIRD_PARTY](../THIRD_PARTY.md)                   |
| Archive film collection | Playlist of Internet Archive links (`public/playlists/movies.m3u`)                                                                                                                                                                  | Item-level reuse rights are unverified; availability may change                                           |
| Free news channels      | Playlist of broadcasters' own free HLS streams (`public/playlists/news.m3u`)                                                                                                                                                        | Each stream belongs to its broadcaster and may depend on region                                           |
| Internet Archive        | Directory source, one search per collection (feature films, classic TV, silent films, cartoons, film noir, horror, westerns, Prelinger, old-time radio). A title lists without a file; its playable file is looked up when it opens | Public collections; rights vary by item, and an item carries a license only when the Archive supplies one |
| NASA video library      | Directory source (Apollo, space exploration, Earth observation). The file is looked up when a title opens                                                                                                                           | Public-domain footage                                                                                     |
| SomaFM                  | Directory source, listener-supported radio. Streams send CORS headers, so the visualizer reads the real sound                                                                                                                       | Each channel belongs to SomaFM                                                                            |
| Radio Browser           | Directory source, the most-listened stations worldwide and by genre. Only HTTPS streams are kept                                                                                                                                    | Each station belongs to its broadcaster                                                                   |
| Internet Archive music  | Built-in music provider: Music search and trending over the Live Music Archive and open-source audio, playing direct archive.org files. See [music](MUSIC.md)                                                                       | Openly licensed collections; rights vary by item                                                          |

## Added by you

| Source                             | Notes                                                                                             |
| ---------------------------------- | ------------------------------------------------------------------------------------------------- |
| Extension file                     | Remote lists, playlists and catalogs, including 18+ lists. See [extensions](EXTENSIONS.md)        |
| M3U playlists and local files      | By address or file. You must be authorized to use them; they are unclassified by default          |
| Media servers                      | `{base}/embed/movie/{tmdb id}` and `/embed/tv/{id}/{season}/{episode}`. See [servers](SERVERS.md) |
| Xtream, Jellyfin and Emby accounts | Credentials stay in memory unless you remember an account on the device. See [Xtream](XTREAM.md)  |
| Music providers                    | Audius, or an Invidious or Piped instance. See [music](MUSIC.md)                                  |
| XMLTV guide                        | File or authorized address; exact `tvg-id` matching. See [guides](EPG.md)                         |
| TMDB                               | Optional metadata and discovery with your own key. Not used for 18+ or unclassified titles        |
| TVmaze                             | The "Airing now" shelf when no TMDB key is set                                                    |

## Adding a provider

1. Implement `ContentProvider.load(signal)` or `MetadataProvider.lookup` from
   `src/providers/contracts.ts`. Resolve playable streams independently of metadata.
2. Give each item an identifier, a normalized type, a classification, artwork,
   countries/languages/categories, rights/provenance and availability.
3. Default unknown classifications conservatively. Do not persist account URLs, keys, adult
   metadata or sensitive request failures. Honor cancellation.
4. Add it to `src/providers/registry.ts`; use `loadSource` for cacheable public sources or
   a session-scoped adapter for authenticated ones. Keep last-good data on errors.
5. Test the parser, classification and failure behavior. Render only through the shared
   domain query and content components.
6. Record licensing, attribution and regional limits here. External links must stay
   visibly distinct from playable content.

Artwork loads lazily with HTTP caching and a fallback tile. Only the four reviewed film
images are bundled, resized to WebP.
