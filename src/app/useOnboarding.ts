import { useEffect, useRef, useState } from "react";
import type { Source } from "../domain/content";
import { sources as builtInSources } from "../providers/registry";
import {
  onboardingState,
  reminderHidden,
  resetReminder,
  setOnboardingState,
} from "../persistence/onboarding";

// The one-time welcome, shown on a fresh device that has nothing set up yet.
export function useOnboarding({
  servers,
  personalMedia,
  sources,
  metadata,
  kids,
}: {
  servers: unknown[];
  personalMedia: unknown[];
  sources: Pick<Source, "id" | "extension">[];
  metadata: unknown;
  kids: boolean;
}) {
  const hasSources =
    servers.length > 0 ||
    personalMedia.length > 0 ||
    sources.some(
      (source) =>
        !source.extension && !builtInSources.some((b) => b.id === source.id),
    );
  const setupDone = Number(Boolean(metadata)) + Number(hasSources);
  const [onboardingOpen, setOnboardingOpen] = useState(false),
    [reminderOff, setReminderOff] = useState(reminderHidden);
  const welcomeChecked = useRef(false);
  useEffect(() => {
    if (welcomeChecked.current) return;
    welcomeChecked.current = true;
    if (!kids && onboardingState() === "new" && !metadata && !hasSources)
      setOnboardingOpen(true);
    // Decided once, when the app opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const openOnboarding = () => {
    resetReminder();
    setReminderOff(false);
    setOnboardingOpen(true);
  };
  const closeOnboarding = (result: "done" | "skipped") => {
    setOnboardingState(result);
    setOnboardingOpen(false);
  };
  return {
    hasSources,
    setupDone,
    onboardingOpen,
    reminderOff,
    setReminderOff,
    openOnboarding,
    closeOnboarding,
  };
}
