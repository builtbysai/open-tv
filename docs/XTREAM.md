# Authorized Xtream accounts

Connect a server you are authorized to use in Settings → Sources → Server account.
Choose Live TV, Movies or Series. Titles appear with everything else; any title or
category that looks 18+ stays hidden until 18+ content is shown. Live, movie and
series connections can coexist.

"Remember on this device" (on by default) keeps the credentials in this browser so the
account reconnects when the app opens. Turn it off to keep them in memory only. Saved
accounts are listed under the form with a Remove button. Credentials never become
source URLs, form drafts, exported media or IndexedDB entries.

## Protocol and loading

This adapter targets the common Xtream-compatible `player_api.php` protocol.
Providers vary; there is no assumption that every panel implements every action.
The server must permit browser CORS, support the relevant codecs, and allow this
use. Use HTTPS when the app is served over HTTPS. API requests omit browser
credentials, use no referrer or HTTP cache, reject redirects, time out after 30
seconds, and cap each JSON response at 15 MB. Enter the canonical server address
rather than an address that redirects. DRM, geographic restrictions, access
controls and unsupported codecs are not bypassed.

| Catalog  | Actions at connection                                         | Playback                                             |
| -------- | ------------------------------------------------------------- | ---------------------------------------------------- |
| Live     | `get_live_categories`, `get_live_streams`                     | `/live/{user}/{password}/{stream_id}.m3u8`           |
| Movies   | `get_vod_categories`, `get_vod_streams`                       | `/movie/{user}/{password}/{stream_id}.{extension}`   |
| Series   | `get_series_categories`, `get_series`                         | No stream on the series metadata record              |
| Episodes | `get_series_info&series_id={id}`, only after opening a series | `/series/{user}/{password}/{episode_id}.{extension}` |

The API includes username/password query parameters as required by this protocol;
playback paths also contain them. Both stay in memory and go directly to that
provider. Open TV supplies no proxy or credential vault. Normal browser/network
inspection on the current device can see these requests.

Series opening is explicit, not an eager request for every season of every
show. Successful episode lists are reused in memory for that connection. Failed
or canceled loads are not cached, and Retry is user-initiated. The adapter accepts
season-keyed lists and flat episode arrays, skips malformed records, preserves
season zero as Specials, sorts numerically, and deduplicates exact provider IDs.
It constructs the provider's episode endpoint instead of trusting a returned
`direct_source` URL. Artwork and optional metadata pass the HTTP(S)/type boundary.
Adult markers in a parent, category or episode cannot become general content.

Series records offer Browse episodes, never a false Watch now button. Episodes
expose separate detail and playback actions, duration where known, and a season
selector. Next/previous and automatic episode progression stay within that series
and stop at its end. Episode rows are paginated; resolved episodes remain searchable
and in the series detail view, without filling the movie discovery grid. XMLTV
imports can match a live account's `epg_channel_id` exactly.

## Lifetime and extension contract

`EpisodicProvider` extends `ContentProvider` with `loadEpisodes(series, signal)`
and `dispose()`. `useCatalog` owns account lifetimes after Settings is unmounted.
It guards late completions by connection identity.
Closing a detail view cancels that view's request. Disconnect and application teardown abort account requests and discard
the live connection and episode caches. Hiding 18+ content does not disconnect
accounts. A remembered account reconnects on the next start.
Saved playlists are not deleted.

Other episodic providers can implement the same contract. Use stable provider
IDs for the series and episodes, identify episodes with `seriesId`, keep catalog
metadata distinct from playable streams, validate every remote response and
honor disposal. General-profile progress is supported for general personal-media
episodes; private accounts never write watch progress or history to that profile.

## Validation limits

Provider tests cover malformed records, stable relationships, numeric ordering,
specials, URL construction, sensitive-URL persistence rejection, format detection,
classification inheritance, failed-load retry, cancellation and disposal. Browser
fixtures cover on-demand requests, season navigation, actual HLS decoding,
episode progression, disconnect and private lock, and inspect all localStorage,
sessionStorage and IndexedDB stores for leaked credentials/private metadata.
These use synthetic catalogs and video; no commercial account or every
provider-specific Xtream variant has been certified. Test your authorized account
and target browser in the published preview before release.
