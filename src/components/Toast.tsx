import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

// A passing notice. It leaves by itself after a few seconds (longer for longer text) and
// stays out of the focus path, so a remote never lands on it and it never needs a click.
export function Toast({
  message,
  icon,
  onDone,
}: {
  message: string;
  icon?: ReactNode;
  onDone(): void;
}) {
  const done = useRef(onDone);
  done.current = onDone;
  const hovered = useRef(false);
  useEffect(() => {
    const ms = Math.min(9000, 4000 + message.length * 40);
    let timer = 0;
    const arm = (wait: number) => {
      timer = window.setTimeout(() => {
        // Waits while a pointer rests on it, then goes shortly after.
        if (hovered.current) arm(1500);
        else done.current();
      }, wait);
    };
    arm(ms);
    return () => clearTimeout(timer);
  }, [message]);
  return (
    <div
      className="toast"
      role="status"
      onPointerEnter={() => (hovered.current = true)}
      onPointerLeave={() => (hovered.current = false)}
    >
      {icon}
      <span>{message}</span>
      <button
        className="icon-button"
        tabIndex={-1}
        onClick={() => done.current()}
        aria-label="Dismiss notification"
      >
        <X size={16} />
      </button>
    </div>
  );
}
