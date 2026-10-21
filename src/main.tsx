import { Component, lazy, Suspense, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import App from "./app/App";
import { ProfileGate } from "./components/ProfileGate";
import { isTVMode } from "./tv/mode";
import { SITE_NAME } from "./config/site";
import { applyDisplaySize, readDisplaySize } from "./persistence/display";
import { applyDeviceSettings } from "./persistence/device-settings";
if (isTVMode()) document.documentElement.dataset.tv = "true";
applyDeviceSettings();
applyDisplaySize(readDisplaySize());
import "./styles/tokens.css";
import "./styles/app.css";
import "./styles/motion.css";
import "./styles/player.css";
import "./styles/tv.css";
import "./styles/remote.css";
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <div className="fatal-error">
        <h1>{SITE_NAME} couldn’t load</h1>
        <p>Reload to try again.</p>
        <button className="button primary" onClick={() => location.reload()}>
          Reload {SITE_NAME}
        </button>
      </div>
    ) : (
      this.props.children
    );
  }
}
// The published site works offline from its last visit. Not in the TV app, whose files
// are already on the device, and not on plain-HTTP test servers.
if (
  "serviceWorker" in navigator &&
  import.meta.env.PROD &&
  location.protocol === "https:" &&
  location.hostname !== "appassets.androidplatform.net"
)
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .catch(() => undefined);
  });
const PairSend = lazy(() => import("./screens/PairSend"));
// The phone setup page only sends data, so it skips the viewing gates.
const pairing = location.hash.startsWith("#/pair");
// Leaving the phone setup page for the app proper loads the app.
if (pairing)
  window.addEventListener("hashchange", () => {
    if (!location.hash.startsWith("#/pair")) location.reload();
  });
createRoot(document.getElementById("root")!).render(
  <Boundary>
    {pairing ? (
      <Suspense fallback={null}>
        <PairSend />
      </Suspense>
    ) : (
      <ProfileGate>{(profile) => <App profileId={profile.id} />}</ProfileGate>
    )}
  </Boundary>,
);
