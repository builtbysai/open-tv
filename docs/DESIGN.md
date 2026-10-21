# Viewer design

The viewer uses neutral charcoal surfaces, white primary actions and locally
bundled Inter. Color is reserved for meaningful status, restrictions and errors.
Film stills and channel logos provide the screen's character. Tokens are in
`src/styles/tokens.css`; TV overrides are in `src/styles/tv.css`.

## Screen behavior

- Home leads with the actual featured title, metadata, synopsis, Play and Details.
  It has no slogan, decorative archive panel, fake profile or repeated LIVE badges.
- Shelves have working paging, disabled end controls and reduced-motion support.
  Their scroll padding protects focus rings. View all clears old browse filters;
  Continue watching and Saved open the corresponding library view.
- Browsing uses category, language and country selects. All categories remain
  reachable, including those beyond the quick-category chips. Clear filters resets
  them together. Movies with artwork appear before entries without it.
- Cards open details and have a separate save control. They do not suggest that
  clicking the artwork immediately plays. Missing/loading artwork shows the full
  title; failed requests recover to that fallback. Channel logos are contained in
  a fixed image box so tall logos cannot grow or get clipped by grid sizing.
- Title details prioritize playback, synopsis and episodes. Source attribution,
  rights links and video checks are under Source & playback. Closing that panel
  unmounts/cancels its checker. Reporting stays directly available.
- Library separates view tabs from collection controls; import/export belongs to
  Personal media. Mobile collections do not disappear beyond the tab strip.
- Settings has a sticky section list on desktop/TV and a section select on mobile.
  Selecting a section scrolls and focuses its first control. Additional optional
  directory presets are expandable; connected and original sources stay listed.
- Mobile uses bottom navigation with search/settings in the header. TV uses the
  same routes with directional focus, larger targets and predictable Back.

TMDB discovery shelves (Popular on your servers, Trending, Top rated, Series) render
as portrait posters with ratings. Titles found in a connected source, matched by
normalized title and year, are playable and drive the hero; the rest are dimmed,
marked "Not in library" and open details only.

Settings is split into five tabs: Sources, Profiles & data, This device, Privacy and
About. A first visit to a device with nothing set up opens a skippable three-step welcome (bring your servers from your phone, connect TMDB, choose a profile); skipping leaves a one-line "Finish setup" reminder on Home, and Settings can run the welcome again. Search ranks
by title, tolerates typos, understands years and type words ("dune 2021", "comedy
movies"), and lists TMDB titles that are not in the library under their own shelf.
Series details offer Play or Resume for the right episode, and playback shows an Up next
card with a countdown at the end of an episode.

Use direct labels and real metadata. Keep implementation instructions in Settings
or the guides. Necessary age declarations, reporting limitations, rights and TMDB
attribution remain accessible; their wording is concise. Do not invent posters,
ratings, popularity, profiles or playback availability to fill empty space.

## Motion

Motion lives in `src/styles/motion.css` and is decoration only: nothing depends on it.

- Screens ease in on a route change; grids fill in with a short stagger; cards rise a little on
  hover and the picture leans in; buttons feel pressed; dialogs and toasts arrive with weight.
- The hero pushes in slowly and settles its text one line at a time; playing art breathes.
- Small rewards: a pop on save and on a connected source, a dice roll on Surprise me, and a
  short confetti burst when the welcome is finished.
- Reduced motion switches all of it off (`tokens.css`), and on a television only focus gives
  feedback, because its WebView has little to spare.
- Keep durations under about 450 ms (the hero push-in and breathing art are the slow
  exceptions) and animate only opacity and transform.

## Typography and assets

`public/fonts/inter-latin.woff2` is a 48,256-byte Latin variable font, loaded from
the app itself with `font-display: swap` and a system fallback. Its SIL OFL license
is distributed beside it. No font-service request or new npm dependency is needed.
See [attribution](../THIRD_PARTY.md).

## Review and validation

After building and starting the production preview:

```sh
npm run build
npm run preview -- --port 4173
# In another terminal:
node scripts/design-review.mjs
```

The script captures Home, Live TV, Movies & Shows, My Library, Search, Settings,
content reports, title details and the first-run Home at 1440×960 desktop, 390×844
mobile, 768×1024 tablet, 960×540 TV and 1920×1080 TV. Captures and the overflow/error
report go to ignored `artifacts/design-review/`. Inspect the images; a successful
script alone is not visual approval. It uses the real general catalog and no
private account or viewing history.

Inspection corrected cropped tall logos, blank pending artwork, mobile collection
controls, duplicate mobile navigation, small detail copy, nested search focus rings
and a shelf snap offset that incorrectly enabled Previous at the start. Focused
browser workflows cover paging/reset, on-demand source/check controls, mobile
collections and settings focus, alongside the existing playback/privacy/remote suite.

These are browser checks. Physical onn viewing distance, overscan, remote behavior,
font rendering and firmware codecs still require the [device checklist](GOOGLE_TV.md).
