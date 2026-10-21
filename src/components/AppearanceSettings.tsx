import { useState } from "react";
import { Type } from "lucide-react";
import {
  displaySizes,
  readDisplaySize,
  saveDisplaySize,
  type DisplaySize,
} from "../persistence/display";

const labels: Record<DisplaySize, string> = {
  compact: "Compact",
  default: "Default",
  large: "Large",
  xlarge: "Extra large",
};
// Size of everything on screen, for this device. Larger is easier from the sofa.
export function AppearanceSettings() {
  const [size, setSize] = useState<DisplaySize>(readDisplaySize);
  return (
    <section className="settings-section" id="settings-appearance">
      <h2>
        <Type size={24} /> Appearance
      </h2>
      <p className="muted">Display size on this device.</p>
      <div className="library-tabs" role="radiogroup" aria-label="Display size">
        {displaySizes.map((value) => (
          <button
            key={value}
            role="radio"
            aria-checked={size === value}
            className={size === value ? "active" : ""}
            onClick={() => {
              setSize(value);
              saveDisplaySize(value);
            }}
          >
            {labels[value]}
          </button>
        ))}
      </div>
    </section>
  );
}
