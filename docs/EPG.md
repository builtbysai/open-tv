# Authorized TV guide connections

In **Settings & Sources → Your TV schedule**, enter an XMLTV HTTPS URL you are
authorized to use, confirm its content classification, then choose **Connect
guide**. Or choose **Import XMLTV** for a local `.xml`/`.xmltv` file. Live TV's
**TV guide** matches each channel's exact `epgId` to the XMLTV `channel` attribute.
It does not guess by similar display names or invent missing programming.

Connected schedules refresh every two hours while the app is foregrounded in
that viewing mode. Settings shows the last update, next attempt, loaded count
and manual refresh. The timeline shows freshness or a failed-refresh notice.
Manual requests have a 15-second minimum interval. Failed refreshes keep the
last good schedule and back off from one minute to a six-hour maximum. Playback
does not wait for a guide connection and works without schedule data.

## Privacy and lifecycle

Schedules and any address that carries a query, token or login stay in memory. They never
enter the general profile, backups, IndexedDB caches or diagnostics, and are connected again
by hand after reopening the app. A plain HTTPS address with none of those is not a secret, so
the general guide's address is remembered on the device (`opentv:guide-url:v1`) and reconnects
when the app opens; Clear guide forgets it. URL forms disable autocomplete and clear after
connection.
Do not paste a URL with embedded `username:password@host`; it is rejected.

There is one guide. Showing 18+ only adds: programs whose titles or descriptions look
explicit are left out while 18+ is hidden and shown with the rest when it is on. Nothing
is dropped or refetched when 18+ is turned on or off. The provider/channel must still be reviewed;
word matching alone cannot establish accurate classification.

## Network and file boundaries

- HTTPS only, no cookies, authorization headers or referrer. Tokens in an
  authorized query are supported for this session only.
- Cross-origin URLs need the guide provider's CORS permission, on every hop of a
  redirect. A redirect is followed only when it lands on HTTPS without a login. A short
  address that redirects through a host without CORS headers (i.mjh.nz goes through
  github.com) fails in a browser; use the final address instead
  (`raw.githubusercontent.com/matthuisman/i.mjh.nz/…`). The media relay does not fetch
  guide APIs. Import a file when an HTTP/CORS endpoint cannot be used securely.
- Inside the TV app, guides are fetched by the host through its `/__https/` route:
  native HTTP has no CORS, redirects are followed there (each hop re-checked against
  loopback and link-local addresses, GET only), the body is passed through unchanged,
  and the host reports where the redirects ended so the HTTPS-landing rule still applies.
- A same-origin mirror (a scheduled job that copies a guide next to the site, served
  from the site's own origin) would avoid CORS entirely on the web. It is not shipped:
  it means redistributing the schedule, and the raw address already works.
- A 45-second request deadline and 10 MB decoded-body limit bound each fetch.
  At most one request is active per viewing-mode service; hidden/locked work is
  canceled and stale results cannot replace a newer source.
- DTD/entity declarations, malformed/non-XMLTV documents, empty remote schedules
  and more than 100,000 programme elements are rejected. Invalid imports keep the
  previous schedule. Raw compressed files must be extracted first; ordinary
  HTTP `Content-Encoding` decompression is handled by the browser and the body
  limit still applies.
- Full-second XMLTV times accept explicit numeric offsets or the XMLTV default
  UTC when the zone is omitted. Impossible dates, times and offsets are rejected.

No EPG scraping service, recording/catch-up entitlement or redistribution license
is implied. Programmes come from the viewer's authorized source. Test/demo schedules are synthetic and clearly identified.

Implementation: `src/guide/service.ts`, `src/app/useGuide.ts`,
`src/providers/epg.ts` and `src/components/GuideSettings.tsx`.
