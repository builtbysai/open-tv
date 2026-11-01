// The website's icons: small inline SVGs (24x24 grid, 1.75 stroke) so nothing depends on an
// icon font or on how a platform draws a glyph.
const PATHS: Record<string, string> = {
  play: "M7 4.5v15a.5.5 0 0 0 .77.42l12-7.5a.5.5 0 0 0 0-.84l-12-7.5A.5.5 0 0 0 7 4.5Z",
  pause: "M8 5v14M16 5v14",
  plus: "M12 5v14M5 12h14",
  check: "m5 12.5 4.5 4.5L19 7.5",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4",
  left: "m15 5-7 7 7 7",
  right: "m9 5 7 7-7 7",
  back: "M19 12H5m6-7-7 7 7 7",
  expand: "M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5",
  shrink: "M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5",
  volume: "M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4ZM16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11",
  mute: "M4 9.5v5h3.5L12 18.5v-13L7.5 9.5H4ZM16 9.5l5 5M21 9.5l-5 5",
  home: "M4 11 12 4l8 7v8.5a.5.5 0 0 1-.5.5H15v-6H9v6H4.5a.5.5 0 0 1-.5-.5V11Z",
  remote: "M8 3h8a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1ZM12 8v.01M12 13v.01M9.5 17h5",
  settings: "M4 7h9m4 0h3M4 17h3m4 0h9M15 4.5v5M9 14.5v5",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM12 11v5.5M12 7.8v.01",
  tv: "M4 6.5h16a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1ZM8 21h8",
  x: "M6 6l12 12M18 6 6 18",
  skip: "M5 5v14l9-7-9-7ZM18 5v14",
  retry: "M20 12a8 8 0 1 1-2.6-5.9M20 4v5h-5",
};
const FILLED = new Set(["play", "skip"]);

export function Icon({ name, size = 20 }: { name: keyof typeof PATHS | string; size?: number }) {
  const filled = FILLED.has(name);
  return (
    <svg
      class="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name] ?? ""} />
    </svg>
  );
}

// Two letters for a title with no artwork, and a stable colour for it.
export const monogram = (title: string) =>
  title
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
export function hue(title: string): number {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) % 360;
  return h;
}
