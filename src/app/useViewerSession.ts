import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type RefObject,
} from "react";
import { emptyBrowse, type BrowseView } from "../domain/view-state";
import type { Route, UserState } from "../persistence/user-state";
import { routeFromHash } from "./router";
export function useViewerSession(
  user: UserState,
  setUser: Dispatch<SetStateAction<UserState>>,
  position: RefObject<number>,
) {
  const [route, setRoute] = useState<Route>(
    () => routeFromHash(location.hash) || user.session.route,
  );
  const [view, setView] = useState<BrowseView>(
    () =>
      user.session.views[route] || {
        ...emptyBrowse(),
        genre: route === user.session.route ? user.session.genre : "",
      },
  );
  const [query, setQueryValue] = useState(user.session.query);
  const userRef = useRef(user),
    routeRef = useRef(route),
    viewRef = useRef(view);
  userRef.current = user;
  routeRef.current = route;
  viewRef.current = view;
  const navigate = useCallback(
    (next: Route) => {
      const previous = routeRef.current;
      if (previous === next) return;
      const nextView = userRef.current.session.views[next] || emptyBrowse();
      const y = position.current;
      routeRef.current = next;
      viewRef.current = nextView;
      setRoute(next);
      setView(nextView);
      setQueryValue(next === "search" ? userRef.current.session.query : "");
      setUser((old) => ({
        ...old,
        session: {
          ...old.session,
          route: next,
          genre: nextView.genre,
          scroll: { ...old.session.scroll, [previous]: y },
        },
      }));
      if (location.hash !== `#/${next}`) location.hash = `/${next}`;
    },
    [position, setUser],
  );
  useEffect(() => {
    const changed = () => {
      const next =
        routeFromHash(location.hash) || (!location.hash ? "home" : undefined);
      if (next) navigate(next);
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, [navigate]);
  const updateView = (patch: Partial<BrowseView>) => {
    const changedFilter = ["genre", "language", "country"].some(
      (key) => key in patch,
    );
    const next = {
      ...viewRef.current,
      ...patch,
      ...(changedFilter ? { limit: 72 } : {}),
    };
    viewRef.current = next;
    setView(next);
    setUser((old) => ({
      ...old,
      session: {
        ...old.session,
        genre: next.genre,
        views: { ...old.session.views, [routeRef.current]: next },
        scroll: changedFilter
          ? { ...old.session.scroll, [routeRef.current]: 0 }
          : old.session.scroll,
      },
    }));
  };
  const setQuery = (value: string) => {
    setQueryValue(value);
    if (viewRef.current.limit !== 72) {
      viewRef.current = { ...viewRef.current, limit: 72 };
      setView(viewRef.current);
    }
    setUser((old) => ({
      ...old,
      session: {
        ...old.session,
        query: value,
        scroll: { ...old.session.scroll, search: 0 },
        views: {
          ...old.session.views,
          search: { ...viewRef.current, limit: 72 },
        },
      },
    }));
  };
  return {
    route,
    query,
    view,
    ...view,
    navigate,
    updateView,
    setQuery,
    setGenre: (genre: string) => updateView({ genre }),
  };
}
