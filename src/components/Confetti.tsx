import { useEffect, useMemo } from "react";

// A short burst when setup is finished. It removes itself, and is skipped entirely for
// people who prefer reduced motion.
export function Confetti({ onDone }: { onDone(): void }) {
  const reduced =
    typeof matchMedia === "function" &&
    matchMedia("(prefers-reduced-motion: reduce)").matches;
  const pieces = useMemo(
    () =>
      Array.from({ length: 44 }, (_, i) => ({
        x: `${Math.round(((i * 37) % 100) + (i % 3))}%`,
        h: (i * 47) % 360,
        d: `${1600 + ((i * 131) % 900)}ms`,
        w: `${(i * 23) % 360}ms`,
        dx: `${((i * 53) % 160) - 80}px`,
        r: `${((i * 71) % 720) - 360}deg`,
      })),
    [],
  );
  useEffect(() => {
    const timer = setTimeout(onDone, reduced ? 0 : 2800);
    return () => clearTimeout(timer);
  }, [onDone, reduced]);
  if (reduced) return null;
  return (
    <div className="confetti" aria-hidden="true">
      {pieces.map((p, i) => (
        <i
          key={i}
          style={
            {
              "--x": p.x,
              "--h": p.h,
              "--d": p.d,
              "--w": p.w,
              "--dx": p.dx,
              "--r": p.r,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
