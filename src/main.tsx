import { render } from "preact";
import { initModules } from "./app/runtime";
import { detectRole } from "./core/env";
import { PhoneApp } from "./phone/PhoneApp";
import { TvApp } from "./tv/TvApp";
import { go, searchText } from "./tv/state";
import "./styles/base.css";
import "./styles/tv.css";
import "./styles/phone.css";

initModules();
const role = detectRole();
document.documentElement.setAttribute("data-role", role);

// The Android TV host can launch with a search (?q=).
const q = new URLSearchParams(location.search).get("q");
if (q && role === "tv") {
  searchText.value = q;
  go({ name: "search" });
}

render(role === "tv" ? <TvApp /> : <PhoneApp />, document.getElementById("app")!);
