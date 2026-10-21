// Whether the one-time welcome has been seen on this device, and whether the slim
// "Finish setup" reminder on Home has been dismissed.
const STATE = "opentv:onboarding:v1";
const REMINDER = "opentv:setup-reminder-hidden:v1";
export type OnboardingState = "new" | "skipped" | "done";
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Storage can be unavailable; the welcome then shows once per visit.
  }
}
export function onboardingState(): OnboardingState {
  const saved = read(STATE);
  return saved === "done" || saved === "skipped" ? saved : "new";
}
export const setOnboardingState = (state: Exclude<OnboardingState, "new">) =>
  write(STATE, state);
export const reminderHidden = () => read(REMINDER) === "1";
export const hideReminder = () => write(REMINDER, "1");
// Running the welcome again from Settings should bring the reminder back too.
export function resetReminder() {
  try {
    localStorage.removeItem(REMINDER);
  } catch {
    /* Nothing to reset. */
  }
}
