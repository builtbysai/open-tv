import type { Route } from "../persistence/user-state";

// Radio and on-demand music feed the same player, so they share one door in the menu.
export function ListenTabs({
  route,
  kids,
  navigate,
}: {
  route: Route;
  kids: boolean;
  navigate(route: Route): void;
}) {
  if (kids) return null;
  const tabs: [Route, string][] = [
    ["audio", "Radio & audio"],
    ["music", "Music"],
  ];
  return (
    <nav className="listen-tabs" aria-label="Listen">
      {tabs.map(([target, label]) => (
        <button
          key={target}
          aria-current={route === target ? "page" : undefined}
          className={route === target ? "active" : ""}
          onClick={() => navigate(target)}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
