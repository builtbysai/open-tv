import { useEffect, useRef } from "react";
import type { Route } from "../persistence/user-state";
import { nearestFocus, type Direction } from "./spatial";
const directions: Record<string, Direction> = {
  ArrowLeft: "left",
  ArrowRight: "right",
  ArrowUp: "up",
  ArrowDown: "down",
};
function scope(): HTMLElement {
  return (
    [...document.querySelectorAll<HTMLDialogElement>("dialog[open]")].at(-1) ||
    document.body
  );
}
function candidates(root = scope()): HTMLElement[] {
  // Long grids hold thousands of buttons; only those within a couple of screens
  // vertically can be the next stop, so the rest are never measured.
  const reach = window.innerHeight * 2;
  return [
    ...root.querySelectorAll<HTMLElement>(
      'button,a[href],input,select,textarea,[tabindex="0"]',
    ),
  ].filter((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.bottom < -reach || rect.top > reach + window.innerHeight)
      return false;
    const style = getComputedStyle(element);
    return (
      element.tabIndex >= 0 &&
      rect.width > 0 &&
      rect.height > 0 &&
      style.visibility === "visible" &&
      !element.matches(
        ':disabled,[aria-disabled="true"],.card-save,.skip-link',
      ) &&
      !element.closest("[hidden],[inert]")
    );
  });
}
// Content is kept in the middle of the screen as focus moves, the way television
// interfaces do, so the next row and the next card are always visible.
function focus(element?: HTMLElement) {
  if (!element) return;
  element.focus({ preventScroll: true });
  const roomy = element.closest(".content-grid,.content-rail,.home-body");
  element.scrollIntoView({
    block: roomy && !element.closest("dialog") ? "center" : "nearest",
    inline: element.closest(".content-rail") ? "center" : "nearest",
    behavior: "instant",
  });
}
export function useRemoteNavigation(
  enabled: boolean,
  route: Route,
  navigate: (route: Route) => void,
  // Back at Home: returns true when it was used (the TV goes back to its idle screen).
  onRootBack: () => boolean = () => false,
) {
  const state = useRef({ route, navigate, onRootBack });
  const returnToNavigation = useRef(false);
  const lastMove = useRef(0);
  state.current = { route, navigate, onRootBack };
  useEffect(() => {
    if (!enabled || !returnToNavigation.current) return;
    returnToNavigation.current = false;
    focus(
      document.querySelector<HTMLElement>(
        '.app-header [aria-current="page"]',
      ) || undefined,
    );
  }, [enabled, route]);
  useEffect(() => {
    if (!enabled) return;
    const back = (event: Event) => {
      const dialog = scope();
      if (dialog instanceof HTMLDialogElement) {
        event.preventDefault();
        dialog.dispatchEvent(new Event("cancel", { cancelable: true }));
        return;
      }
      const current = document.activeElement as HTMLElement;
      const navigation =
        document.querySelector<HTMLElement>(
          '.app-header [aria-current="page"]',
        ) || undefined;
      if (current?.matches("input,textarea,select")) {
        current.blur();
        focus(navigation || candidates()[0]);
        event.preventDefault();
        return;
      }
      if (!navigation) {
        if (state.current.route !== "home") {
          state.current.navigate("home");
          event.preventDefault();
        } else if (
          document.querySelector(".app-header") &&
          state.current.onRootBack()
        )
          event.preventDefault();
        return; // The idle screen has no header: Back there leaves the app.
      }
      if (!current?.closest(".app-header")) {
        focus(
          document.querySelector<HTMLElement>(
            '.app-header [aria-current="page"]',
          ) || undefined,
        );
        event.preventDefault();
        return;
      }
      if (state.current.route !== "home") {
        returnToNavigation.current = true;
        state.current.navigate("home");
        event.preventDefault();
        return;
      }
      // At Home navigation the TV returns to its idle screen; from there Back is left
      // unhandled so the Android host returns to Google TV. One press, one effect.
      if (state.current.onRootBack()) event.preventDefault();
    };
    const key = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey
      )
        return;
      const inDialog = scope() instanceof HTMLDialogElement;
      // Info or the menu key saves or removes the focused title.
      if (
        ["Info", "ContextMenu", "MediaTopMenu"].includes(event.key) &&
        !inDialog
      ) {
        const save = (document.activeElement as HTMLElement | null)
          ?.closest(".content-card")
          ?.querySelector<HTMLElement>(".card-save");
        if (save) {
          event.preventDefault();
          save.click();
        }
        return;
      }
      // Channel up and down page through long lists.
      if (["PageDown", "PageUp"].includes(event.key) && !inDialog) {
        const current = document.activeElement as HTMLElement;
        const elements = candidates();
        if (current && elements.includes(current)) {
          event.preventDefault();
          const down = event.key === "PageDown";
          const rect = current.getBoundingClientRect();
          const step = window.innerHeight * 0.8;
          const target = elements
            .map((element) => ({
              element,
              rect: element.getBoundingClientRect(),
            }))
            .filter(({ rect: r }) =>
              down ? r.top >= rect.top + step : r.top <= rect.top - step,
            )
            .sort(
              (a, b) =>
                Math.abs(a.rect.top - rect.top) -
                  Math.abs(b.rect.top - rect.top) ||
                Math.abs(a.rect.left - rect.left) -
                  Math.abs(b.rect.left - rect.left),
            )[0];
          focus(target?.element || elements[down ? elements.length - 1 : 0]);
        }
        return;
      }
      if (["BrowserBack", "GoBack", "Escape"].includes(event.key)) {
        // Escape already has native dialog semantics; dispatch the same cancel behavior once.
        back(event);
        return;
      }
      const current = document.activeElement as HTMLElement;
      if (
        event.key === "Enter" &&
        current?.matches('input[type="checkbox"],input[type="radio"]')
      ) {
        event.preventDefault();
        current.click();
        return;
      }
      const direction = directions[event.key];
      if (!direction) return;
      if (current?.isContentEditable || current?.matches("textarea")) return;
      if (
        current?.matches('input:not([type="checkbox"]):not([type="radio"])') &&
        ["left", "right"].includes(direction)
      )
        return;
      if (
        current?.matches("[data-remote-seek]") &&
        ["left", "right"].includes(direction)
      )
        return;
      // A held key repeats faster than the eye can follow; pace it.
      if (event.repeat) {
        const now = performance.now();
        if (now - lastMove.current < 70) {
          event.preventDefault();
          return;
        }
        lastMove.current = now;
      }
      if (
        direction === "down" &&
        current?.closest(".app-header") &&
        !inDialog
      ) {
        // Entering a screen always lands in one known place: its first control.
        const first = candidates().find((e) => e.closest("main"));
        if (first) {
          event.preventDefault();
          focus(first);
          return;
        }
      }
      const elements = candidates();
      if (!elements.length) return;
      event.preventDefault();
      if (!elements.includes(current)) {
        focus(elements[0]);
        return;
      }
      const index = elements.indexOf(current),
        rect = current.getBoundingClientRect();
      const next = nearestFocus(
        { ...rect.toJSON(), id: index },
        elements.map((element, id) => ({
          ...element.getBoundingClientRect().toJSON(),
          id,
        })),
        direction,
      );
      if (next !== undefined) focus(elements[next]);
    };
    let frame = 0;
    const restore = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const active = document.activeElement;
        if (
          !active ||
          active === document.body ||
          !active.isConnected ||
          !scope().contains(active)
        )
          focus(candidates()[0]);
      });
    };
    const observer = new MutationObserver(restore);
    observer.observe(document.body, { childList: true, subtree: true });
    focus(
      document.querySelector<HTMLElement>(
        '.app-header [aria-current="page"]',
      ) || candidates()[0],
    );
    document.addEventListener("keydown", key, true);
    window.addEventListener("opentv:back", back);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("opentv:back", back);
    };
  }, [enabled]);
}
