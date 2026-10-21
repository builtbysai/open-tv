# Where to get good content

Legal, free sources that Open TV can play directly, checked in October 2026. "Built in"
means it is already a source in Settings → Sources (switched off until you choose it).

## Live TV

**The broadcasters' own streams are the best free live TV.** They are stable, in HD and
plainly allowed. The built-in **Free news channels** list carries them: Al Jazeera
(English, Arabic, Mubasher), DW (English, Arabic, Español), France 24 (English, French,
Spanish, Arabic), Euronews, NHK World, ABC News Live, CBS News, NBC News NOW, ABC News
Australia, Sky News Arabia, Newsmax, Bloomberg, Fox Weather and NASA TV. Some depend on
your region.

**Curated open lists**, added as playlists (Settings → Sources, the playlist form):

| List                 | Address                                                                                              | Notes                                                                                                           |
| -------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Free-TV (curated)    | `https://raw.githubusercontent.com/Free-TV/IPTV/master/playlist.m3u8`                                | "Only officially free" channels, one per channel. Includes some FAST-service entries; skip those if you prefer. |
| iptv-org by category | `https://iptv-org.github.io/iptv/categories/news.m3u` (or `/countries/us.m3u`, `/languages/eng.m3u`) | Huge, community-submitted, mixed quality and legality. Prefer a category or country list over `index.m3u`.      |

**FAST services** (Pluto TV, Samsung TV Plus, Plex, Roku Channel, Tubi): the public
playlists for these were taken down in 2024, and redirectors that still work spoof
the services' apps, which their terms forbid. Open TV doesn't bundle them. Their
**guide data** is still freely published and is useful with channels you have from
elsewhere. In a browser use the raw addresses, for example
`https://raw.githubusercontent.com/matthuisman/i.mjh.nz/refs/heads/master/SamsungTVPlus/us.xml`
and `…/master/PlutoTV/us.xml` (other regions and services under the same path). The short
`https://i.mjh.nz/<Service>/<country>.xml` addresses redirect through github.com, which
sends no CORS header, so browsers refuse them; the TV app fetches them natively and
either form works there.

## Films and series

| Source                        | How                                          | Notes                                                                                                                               |
| ----------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Internet Archive              | Built in (films, classic TV, cartoons, more) | Public domain and Creative Commons; quality varies by item. Feature films (28,000+), classic TV (11,000+), silent films, film noir. |
| Blender open movies           | Built in                                     | Excellent quality, Creative Commons, a small catalog.                                                                               |
| NASA Image & Video Library    | Built in                                     | Public domain.                                                                                                                      |
| Your own servers              | Settings → Media servers                     | Any server you are authorized to use; see [address formats](SERVERS.md#address-formats).                                            |
| Jellyfin, Xtream accounts     | Settings → Accounts                          | Your own media or a subscription you hold.                                                                                          |
| Kanopy, Hoopla (library card) | Their own apps                               | Licensed and DRM-protected; no public interface to add here.                                                                        |

## Radio and music

| Source                 | How                                           | Notes                                       |
| ---------------------- | --------------------------------------------- | ------------------------------------------- |
| Radio Paradise & KEXP  | Built in                                      | Listener-supported, 320 kbps; KEXP Seattle. |
| SomaFM                 | Built in                                      | 30+ commercial-free stations.               |
| Radio Browser          | Built in (top stations, by genre, by country) | The open directory of internet radio.       |
| Internet Archive audio | Built in where listed                         | Old-time radio (8,000+).                    |
| Internet Archive music | Built in (Music search and trending)          | Live Music Archive and open-source audio.   |
| Audius                 | Music → providers (in the extension)          | Artist-uploaded music, free API.            |
| Jamendo                | Needs a free client id                        | Creative Commons music.                     |

## Guides (XMLTV)

| Source       | Address                                                    | Notes                                   |
| ------------ | ---------------------------------------------------------- | --------------------------------------- |
| i.mjh.nz     | `https://i.mjh.nz/<Service>/<country>.xml`                 | FAST services and free-to-air in NZ/AU. |
| epg.pw       | `https://epg.pw/xmltv/epg_US.xml.gz` (other countries too) | About 20 countries, current week.       |
| open-epg.com | `https://open-epg.com/files/unitedstates1.xml`             | Many countries; donation-funded.        |

## What not to add

Pirate sites and "free movie" embed servers, restreams of paid channels (often on bare IP
addresses or reseller hosts), app-spoofing FAST redirectors and scraped FAST lists. They
break often, can carry malware or pop-ups, and are not legal to use.
