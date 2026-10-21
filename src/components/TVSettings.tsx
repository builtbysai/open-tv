import { MonitorPlay } from "lucide-react";
import { isTVMode } from "../tv/mode";
export function TVSettings() {
  const tv = isTVMode(),
    url = new URL(location.href);
  url.searchParams.set("tv", "1");
  const exit = new URL(location.href);
  exit.searchParams.delete("tv");
  return (
    <section className="settings-section tv-settings">
      <h2>
        <MonitorPlay size={24} /> TV & remote
      </h2>
      <p className="muted">
        {tv
          ? "TV mode is on. Use the direction pad to move and OK to select."
          : "Use larger controls and navigate with a remote or keyboard."}
      </p>
      {!tv && (
        <a className="button secondary" href={url.href}>
          Open TV mode
        </a>
      )}
      {tv && new URLSearchParams(location.search).get("tv") === "1" && (
        <a className="button secondary" href={exit.href}>
          Exit TV mode
        </a>
      )}
      <dl className="remote-legend">
        <div>
          <dt>Direction pad</dt>
          <dd>Move focus. In a video, left/right seeks 10 seconds.</dd>
        </div>
        <div>
          <dt>OK / Select</dt>
          <dd>Open a title, activate a control, or open a list.</dd>
        </div>
        <div>
          <dt>Back</dt>
          <dd>
            Close playback or a dialog, return to the menu, then to the TV’s
            home screen.
          </dd>
        </div>
        <div>
          <dt>Play / Pause</dt>
          <dd>
            Toggle playback. Media next/previous switches channels or episodes.
          </dd>
        </div>
        <div>
          <dt>Number keys</dt>
          <dd>
            While a channel or station plays, type its number to jump to it. 0
            alone returns to the previous one.
          </dd>
        </div>
        <div>
          <dt>Channel up / down</dt>
          <dd>Page through long lists, or switch channels during playback.</dd>
        </div>
        <div>
          <dt>Info / Menu</dt>
          <dd>Save or remove the focused title from Saved.</dd>
        </div>
        <div>
          <dt>V</dt>
          <dd>Change the audio visualizer, on a keyboard.</dd>
        </div>
        <div>
          <dt>Volume / Home</dt>
          <dd>
            Your TV handles these buttons. At Home navigation, Back exits the
            Android app.
          </dd>
        </div>
      </dl>
      <p className="fine-print">
        There is no typing on the TV. Search, sources and setup happen on your
        phone: pair it from the TV’s home screen, then choose Play on TV.
      </p>
      <a
        className="button text"
        href="https://github.com/builtbysai/open-tv/blob/main/docs/GOOGLE_TV.md"
        target="_blank"
        rel="noreferrer"
      >
        Google TV installation guide
      </a>
    </section>
  );
}
