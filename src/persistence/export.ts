declare global {
  interface Window {
    OpenTVDevice?: { postMessage(message: string): void };
  }
}
// Android exposes this single capability only to the bundled, trusted main-frame origin.
export function exportJson(name: string, value: object): void {
  const content = JSON.stringify(value, null, 2);
  if (window.OpenTVDevice) {
    window.OpenTVDevice.postMessage(
      JSON.stringify({ type: "export", name, content }),
    );
    return;
  }
  const url = URL.createObjectURL(
    new Blob([content], { type: "application/json" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}
