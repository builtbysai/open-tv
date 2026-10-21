// Resolves when the browser has nothing better to do (or after `timeout` ms), so background
// work such as a large download does not compete with what the person is waiting for.
export function whenIdle(timeout = 2500): Promise<void> {
  return new Promise((resolve) => {
    const ric = (
      window as unknown as {
        requestIdleCallback?: (
          cb: () => void,
          options?: { timeout: number },
        ) => void;
      }
    ).requestIdleCallback;
    if (ric) ric(() => resolve(), { timeout });
    else setTimeout(resolve, 300);
  });
}
// Fetches the screens a person is likely to open next, once the app is up.
export function preloadScreens() {
  void whenIdle(1500).then(() => {
    void import("./SettingsRoute");
    void import("../components/Player");
    void import("../components/PhoneTransfer");
    void import("../components/Legal");
  });
}
