import { routes, type Route } from "../persistence/user-state";
const aliases: Record<string, Route> = {
  watch: "live",
  srv: "library",
  xt: "settings",
};
export function routeFromHash(hash: string): Route | undefined {
  const path = hash.replace(/^#\/?/, "").split("?")[0];
  return routes.includes(path as Route) ? (path as Route) : aliases[path];
}
