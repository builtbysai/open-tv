export interface ReportTarget {
  id: string;
  providerId: string;
  restricted: boolean;
}
export const reportReasons = [
  "Copyright or distribution rights",
  "Incorrect age classification",
  "Broken or misleading stream",
  "Privacy or safety concern",
] as const;
export function publicReportUrl(
  target: ReportTarget | undefined,
  reason: string,
  endpoint = "https://github.com/builtbysai/open-tv/issues/new",
): string {
  const url = new URL(endpoint);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("Reports require a public HTTPS endpoint.");
  if (url.hostname === "github.com")
    url.searchParams.set("template", "content-report.yml");
  if (target && !target.restricted) {
    if (/^ot-[a-z0-9]+$/.test(target.id))
      url.searchParams.set("content_id", target.id);
    if (/^[a-z0-9_-]{1,100}$/i.test(target.providerId))
      url.searchParams.set("source_id", target.providerId);
  }
  if ((reportReasons as readonly string[]).includes(reason))
    url.searchParams.set("reason", reason);
  return url.href;
}
export interface CopyrightNotice {
  name: string;
  email: string;
  address: string;
  work: string;
  location: string;
  signature: string;
  goodFaith: boolean;
  accurate: boolean;
}
export function validNotice(value: CopyrightNotice): boolean {
  return (
    [
      value.name,
      value.address,
      value.work,
      value.location,
      value.signature,
    ].every((v) => v.trim().length > 0 && v.length <= 5000) &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.email) &&
    value.email.length <= 254 &&
    value.goodFaith &&
    value.accurate
  );
}
