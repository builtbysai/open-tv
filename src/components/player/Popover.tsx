import { useEffect, useId, useRef, useState, type ReactNode } from "react";

// A small panel that opens from an icon button. It closes on an outside press, on Escape
// or the remote's Back (without closing the player behind it), and when focus leaves it.
export function Popover({
  label,
  icon,
  children,
  badge,
  onOpenChange,
  align = "end",
}: {
  label: string;
  icon: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  // A short live value shown beside the icon, such as the time left on a timer.
  badge?: string;
  onOpenChange?(open: boolean): void;
  align?: "start" | "end";
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const change = (value: boolean) => {
    setOpen(value);
    onOpenChange?.(value);
  };
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) change(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  return (
    <div
      className={`pc-popover ${align === "start" ? "align-start" : ""}`}
      ref={root}
      onKeyDown={(event) => {
        if (event.key === "Escape" && open) {
          event.preventDefault();
          event.stopPropagation();
          change(false);
          root.current?.querySelector<HTMLElement>("button")?.focus();
        }
      }}
      onBlur={(event) => {
        if (open && !root.current?.contains(event.relatedTarget as Node))
          change(false);
      }}
    >
      <button
        type="button"
        className={`pc-button ${badge ? "has-badge" : ""}`}
        aria-label={label}
        aria-expanded={open}
        aria-controls={id}
        onClick={(event) => {
          change(!open);
          // Opened from a keyboard or remote: focus moves into the panel.
          if (!open && event.detail === 0)
            requestAnimationFrame(() =>
              root.current
                ?.querySelector<HTMLElement>(
                  ".pc-panel button, .pc-panel select",
                )
                ?.focus(),
            );
        }}
      >
        {icon}
        {badge && <span className="pc-badge">{badge}</span>}
      </button>
      {open && (
        <div className="pc-panel" id={id} role="group" aria-label={label}>
          {typeof children === "function"
            ? children(() => {
                change(false);
                root.current?.querySelector<HTMLElement>("button")?.focus();
              })
            : children}
        </div>
      )}
    </div>
  );
}
