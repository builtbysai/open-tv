import { render } from "preact";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { initModules } from "./app/runtime";
import { detectRole } from "./core/env";
import { WebApp } from "./web/WebApp";
import { TvApp } from "./tv/TvApp";
import { go, searchText } from "./tv/state";

initModules();
const role = detectRole();
document.documentElement.setAttribute("data-role", role);

// The Android TV host can launch with a search (?q=).
const q = new URLSearchParams(location.search).get("q");
if (q && role === "tv") {
  searchText.value = q;
  go({ name: "search" });
}

// Each role uses only its own stylesheet (index.html declares both, switched off): the TV and the
// website reuse class names (.row, .card, .hero…) for very different layouts.
const start = () => render(<ErrorBoundary>{role === "tv" ? <TvApp /> : <WebApp />}</ErrorBoundary>, document.getElementById("app")!);
const wanted = document.getElementById("css-" + role) as HTMLLinkElement | null;
const other = document.getElementById("css-" + (role === "tv" ? "web" : "tv"));
other?.parentNode?.removeChild(other);
if (!wanted) start();
else {
  wanted.media = "all";
  // `sheet` is set once it has loaded; if the file is still arriving, wait for it.
  if (wanted.sheet) start();
  else {
    wanted.onload = start;
    wanted.onerror = start;
  }
}
