# Third-party content and software

## Open-film artwork and films

| Work                   | Attribution                                                                         | Source                                            |
| ---------------------- | ----------------------------------------------------------------------------------- | ------------------------------------------------- |
| Big Buck Bunny (2008)  | © Blender Foundation · Creative Commons Attribution 3.0                             | https://studio.blender.org/films/big-buck-bunny/  |
| Sintel (2010)          | © Blender Foundation · Creative Commons Attribution 3.0                             | https://studio.blender.org/films/sintel/          |
| Elephants Dream (2006) | © Blender Foundation / Orange Open Movie Project · Creative Commons Attribution 3.0 | https://studio.blender.org/films/elephants-dream/ |
| Tears of Steel (2012)  | © Blender Foundation · Creative Commons Attribution 3.0                             | https://studio.blender.org/films/tears-of-steel/  |

License: <https://creativecommons.org/licenses/by/3.0/> (Archive entries may
specify the US port). Public header artwork was resized/compressed to WebP in
`public/artwork`; image content is otherwise unchanged. Film files are linked,
not copied or edited. Individual Archive IDs and license checks are recorded in
`scripts/sync-cinema.ts`. The Tears of Steel **soundtrack-only** download-index
license is not used as the film's license.

## Metadata and music services

Optional TMDB metadata: This product uses the TMDB API but is not endorsed or
certified by TMDB. <https://www.themoviedb.org/>. No TMDB data/artwork is requested
for adult or unclassified content. The shipped film artwork comes from Blender,
not TMDB. The unmodified approved short logo in `public/branding/tmdb.svg` is from TMDB's
[official logos page](https://www.themoviedb.org/about/logos-attribution) and is shown with
the required notice in Settings' Credits & metadata section. It is TMDB branding, not an
Open TV asset or an endorsement. The [official API FAQ](https://developer.themoviedb.org/docs/faq)
requires this attribution and distinguishes non-commercial developer use from a separately
licensed commercial service. Operators must obtain the appropriate key/license for their own
use.

Music lookups use free public services that you can turn off in Settings: lyrics from
[LRCLIB](https://lrclib.net), and album, artist and release data from
[MusicBrainz](https://musicbrainz.org) (core data CC0) with cover art from the
[Cover Art Archive](https://coverartarchive.org) (images carry their own licenses). Music
itself is played from a service you add: [Audius](https://audius.co) (artists' own uploads,
public API) or an Invidious or Piped instance you configure. Open TV does not host or ship
any music, and each service's terms apply to its use.

The "Airing now" shelf uses [TVmaze](https://www.tvmaze.com) data, and "Where to watch" uses
JustWatch data supplied through TMDB. Radio listings come from
[Radio Browser](https://www.radio-browser.info), SomaFM and the broadcasters themselves.
Video and channel-logo rights belong to their respective owners; a listing is not a license.

## Software

React/React DOM, Vite, TypeScript, HLS.js, Vitest, ESLint, Prettier, TSX and
Playwright retain their upstream licenses in their npm packages. Lucide icons
use the ISC license. Package versions and integrity hashes are in
`package-lock.json`. No analytics service is included.

Inter by the Inter Project Authors is bundled locally under the SIL Open Font
License 1.1. The Latin variable WOFF2 comes from `@fontsource-variable/inter@5.2.8`
(`inter-latin-wght-normal.woff2`); its unmodified license is distributed at
`public/fonts/OFL.txt`, including inside the APK. No font service is contacted.
See <https://github.com/rsms/inter> and <https://fontsource.org/fonts/inter>.

The optional Android host uses AndroidX WebKit and its AndroidX transitive
dependencies (Apache License 2.0), the Android Gradle Plugin (Apache License 2.0),
the transitive Kotlin runtime/JetBrains annotations (Apache License 2.0), and the
Gradle wrapper (Apache License 2.0). The APK includes the Apache license, runtime
notices, this attribution file and current npm runtime license texts in
`assets/licenses/`. See
<https://developer.android.com/jetpack/androidx/releases/webkit>,
<https://source.android.com/docs/setup/about/licenses> and
<https://github.com/gradle/gradle/blob/master/LICENSE>. Gradle wrapper scripts
retain their upstream notices. Android SDK components are installed separately
under their own SDK terms; the SDK/JDK and signing keys are not bundled in git.
The TV icon/banner are Open TV assets, with no new third-party artwork.
