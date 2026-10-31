# Third-party software and services

## Metadata

This product uses the TMDB API but is not endorsed or certified by TMDB.
<https://www.themoviedb.org/>

The unmodified approved short logo in `public/branding/tmdb.svg` is from TMDB's
[official logos page](https://www.themoviedb.org/about/logos-attribution) and is shown with the
required notice in Settings. It is TMDB branding, not an Open TV asset or an endorsement. The
[official API FAQ](https://developer.themoviedb.org/docs/faq) requires this attribution and
distinguishes non-commercial developer use from a separately licensed commercial service. Whoever
runs Open TV must use their own TMDB key and obtain the license appropriate to their use.

Open TV ships no media, no catalog and no server addresses. Servers are added by the person who
uses it, and only servers that person is entitled to use belong there.

## Software included in the app

| Package                 | License | Use                                    |
| ----------------------- | ------- | -------------------------------------- |
| preact                  | MIT     | UI                                     |
| @preact/signals(-core)  | MIT     | reactive state                         |
| qrcode-generator        | MIT     | the pairing QR code, drawn as SVG      |

License texts for the packages above are copied into the Android app's `assets/licenses/`.

## Software used to build and test (not shipped)

Vite, TypeScript, Vitest, Playwright, ESLint, es-check, tsx, ws (MIT / Apache-2.0).
The control relay (`control/`) runs on Cloudflare Workers and uses `wrangler` for deployment.
