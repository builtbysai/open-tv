import {
  Search,
  Settings2,
  Play,
  Compass,
  Radio,
  Headphones,
  Film,
  Library,
  LockKeyhole,
  Tv,
} from "lucide-react";
import { Brand } from "./Brand";
import { SITE_NAME } from "../config/site";
import type { Route } from "../persistence/user-state";
import type { Profile } from "../persistence/accounts";
import { avatarStyle, useRestricted } from "./ProfileGate";
const nav: { route: Route; label: string; icon: typeof Compass }[] = [
  { route: "home", label: "Home", icon: Compass },
  { route: "live", label: "Live TV", icon: Radio },
  { route: "movies", label: "Movies & Shows", icon: Film },
  { route: "audio", label: "Listen", icon: Headphones },
  { route: "library", label: "My Library", icon: Library },
];
// Music is a tab inside Listen, so Listen stays highlighted there.
const isCurrent = (route: Route, target: Route) =>
  route === target || (target === "audio" && route === "music");
interface Props {
  route: Route;
  navigate(route: Route): void;
}
export function AppHeader({
  route,
  adult,
  navigate,
  profile,
  onSwitchProfile,
  tv = false,
  playTarget,
}: Props & {
  adult: boolean;
  profile: Profile;
  onSwitchProfile(): void;
  // A TV takes no typing: search lives on the phone.
  tv?: boolean;
  // Where Play goes when a TV is paired: here, or the TV.
  playTarget?: {
    target: "here" | "tv";
    tvName: string;
    online: boolean;
    onChange(target: "here" | "tv"): void;
  };
}) {
  const go = (next: Route) => navigate(next);
  return (
    <header className="app-header">
      <button
        className="brand"
        onClick={() => go("home")}
        aria-label={`${SITE_NAME} home`}
      >
        <span className="brand-symbol">
          <Play size={18} fill="currentColor" />
        </span>
        <Brand />
      </button>
      <nav className="main-nav" aria-label="Main navigation">
        {nav.map((n) => (
          <button
            key={n.route}
            className={isCurrent(route, n.route) ? "active" : ""}
            aria-current={isCurrent(route, n.route) ? "page" : undefined}
            onClick={() => go(n.route)}
          >
            {n.label}
          </button>
        ))}
      </nav>
      <div className="header-actions">
        {playTarget && (
          <button
            className={`play-target ${playTarget.target === "tv" ? "on" : ""} ${playTarget.online ? "" : "offline"}`}
            aria-pressed={playTarget.target === "tv"}
            title={
              playTarget.online
                ? undefined
                : `${playTarget.tvName} isn’t reachable; Play stays on this device`
            }
            onClick={() =>
              playTarget.onChange(playTarget.target === "tv" ? "here" : "tv")
            }
          >
            <Tv size={17} />
            <span>
              {playTarget.target === "tv"
                ? `Playing on ${playTarget.tvName}`
                : "Play on this device"}
            </span>
          </button>
        )}
        {!tv && (
          <button
            className={`icon-button ${route === "search" ? "active" : ""}`}
            onClick={() => {
              go("search");
              setTimeout(
                () =>
                  document
                    .querySelector<HTMLInputElement>("#global-search")
                    ?.focus(),
                0,
              );
            }}
            aria-label="Search"
            aria-current={route === "search" ? "page" : undefined}
          >
            <Search size={21} />
          </button>
        )}
        {!profile.kids && (
          <button
            className={`icon-button ${route === "settings" ? "active" : ""}`}
            onClick={() => go("settings")}
            aria-label="Settings and sources"
            aria-current={
              route === "settings" || route === "legal" ? "page" : undefined
            }
          >
            <Settings2 size={21} />
          </button>
        )}
        {adult && <LockKeyhole size={17} aria-label="18+ content shown" />}
        <button
          className="avatar avatar-small"
          style={avatarStyle(profile)}
          onClick={onSwitchProfile}
          aria-label={`Switch profile, ${profile.name}`}
        >
          {profile.name[0].toUpperCase()}
        </button>
      </div>
    </header>
  );
}
export function MobileNavigation({ route, navigate }: Props) {
  return (
    <nav className="bottom-nav" aria-label="Mobile navigation">
      {nav.map((n) => (
        <button
          key={n.route}
          className={isCurrent(route, n.route) ? "active" : ""}
          onClick={() => navigate(n.route)}
          aria-current={isCurrent(route, n.route) ? "page" : undefined}
        >
          <n.icon size={20} />
          <span>
            {n.label === "Movies & Shows"
              ? "Movies"
              : n.label === "My Library"
                ? "Library"
                : n.label}
          </span>
        </button>
      ))}
    </nav>
  );
}
export function AppFooter({ navigate }: Pick<Props, "navigate">) {
  const restricted = useRestricted();
  return (
    <footer className="app-footer">
      <button className="brand" onClick={() => navigate("home")}>
        <Brand />
      </button>
      {!restricted && (
        <button className="button text" onClick={() => navigate("settings")}>
          Settings
        </button>
      )}
      <button className="button text" onClick={() => navigate("legal")}>
        Content reports
      </button>
      {new URLSearchParams(location.search).get("tv") === "1" && (
        <a
          className="button text"
          href={(() => {
            const url = new URL(location.href);
            url.searchParams.delete("tv");
            return url.href;
          })()}
        >
          Exit TV mode
        </a>
      )}
    </footer>
  );
}
