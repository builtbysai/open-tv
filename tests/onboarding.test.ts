import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  hideReminder,
  onboardingState,
  reminderHidden,
  resetReminder,
  setOnboardingState,
} from "../src/persistence/onboarding";
beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
});
describe("onboarding state", () => {
  it("starts new, then remembers done or skipped", () => {
    expect(onboardingState()).toBe("new");
    setOnboardingState("skipped");
    expect(onboardingState()).toBe("skipped");
    setOnboardingState("done");
    expect(onboardingState()).toBe("done");
  });
  it("hides and restores the reminder", () => {
    expect(reminderHidden()).toBe(false);
    hideReminder();
    expect(reminderHidden()).toBe(true);
    resetReminder();
    expect(reminderHidden()).toBe(false);
  });
  it("falls back safely when storage throws", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    });
    expect(onboardingState()).toBe("new");
    expect(() => setOnboardingState("done")).not.toThrow();
    expect(reminderHidden()).toBe(false);
  });
});
