import type { GuideProgram } from "./contracts";
export function xmltvTime(value: string): number {
  const m = value
    .trim()
    .match(
      /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-])(\d{2})(\d{2}))?$/,
    );
  if (!m) return NaN;
  const [, year, month, day, hour, minute, second, sign, zh = "0", zm = "0"] =
    m;
  const parts = [year, month, day, hour, minute, second].map(Number);
  const [y, mo, d, h, mi, s] = parts;
  const offset = Number(zh) * 60 + Number(zm);
  if (
    y < 1000 ||
    mo < 1 ||
    mo > 12 ||
    d < 1 ||
    h > 23 ||
    mi > 59 ||
    s > 59 ||
    Number(zm) > 59 ||
    offset > 14 * 60
  )
    return NaN;
  const utc = Date.UTC(y, mo - 1, d, h, mi, s);
  if (new Date(utc).getUTCDate() !== d) return NaN;
  // XMLTV defines a missing zone as UTC, never the device's local timezone.
  return utc - offset * 60000 * (sign === "-" ? -1 : 1);
}
// XMLTV parsing is browser-side; DTD/entity declarations are explicitly rejected.
export function parseXMLTV(xml: string): GuideProgram[] {
  if (xml.length > 10_000_000 || /<!DOCTYPE|<!ENTITY/i.test(xml))
    throw new Error("Unsupported or oversized guide.");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  if (doc.querySelector("parsererror") || doc.documentElement.tagName !== "tv")
    throw new Error("Invalid XMLTV guide.");
  const programs = doc.querySelectorAll("tv > programme");
  if (programs.length > 100000)
    throw new Error("Split this guide into smaller files.");
  return [...programs]
    .map((p) => ({
      channelId: (p.getAttribute("channel") || "").slice(0, 500),
      title: p.querySelector("title")?.textContent?.slice(0, 300) || "Untitled",
      start: xmltvTime(p.getAttribute("start") || ""),
      end: xmltvTime(p.getAttribute("stop") || ""),
      description:
        p.querySelector("desc")?.textContent?.slice(0, 10000) || undefined,
    }))
    .filter((p) => p.channelId && Number.isFinite(p.start) && p.end > p.start);
}
