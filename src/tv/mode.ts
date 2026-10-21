export function isTVMode(): boolean {
  return (
    new URLSearchParams(location.search).get("tv") === "1" ||
    /OpenTVAndroid\//.test(navigator.userAgent)
  );
}
