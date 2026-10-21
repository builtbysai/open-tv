// How this device introduces itself to a paired TV.
export function deviceName(): string {
  const coarse = matchMedia("(pointer: coarse)").matches;
  const small = Math.min(screen.width, screen.height) < 600;
  return coarse ? (small ? "Phone" : "Tablet") : "Computer";
}
// How the TV introduces itself.
export function tvName(): string {
  return /OpenTVAndroid\//.test(navigator.userAgent) ? "Google TV" : "TV";
}
