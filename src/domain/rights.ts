// "https://creativecommons.org/licenses/by-sa/4.0/" → "CC BY-SA 4.0". Anything else is
// shown as written, shortened to its host when it is an address.
export function licenseLabel(license: string | undefined): string {
  if (!license) return "Open license";
  const cc =
    /creativecommons\.org\/(?:licenses|publicdomain)\/([a-z-]+)\/?([\d.]+)?/i.exec(
      license,
    );
  if (cc) {
    const kind = cc[1].toLowerCase();
    if (kind === "zero" || kind === "mark") return "Public domain (CC0)";
    return `CC ${kind.toUpperCase()}${cc[2] ? ` ${cc[2]}` : ""}`;
  }
  try {
    return new URL(license).host;
  } catch {
    return license;
  }
}
