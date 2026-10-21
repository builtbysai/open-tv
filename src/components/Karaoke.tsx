import { useEffect, useRef } from "react";
import { activeLine, type LyricLine } from "../music/lrc";

// Lyrics that follow the song: the line being sung is bright, the ones around it dim.
// Without timings it is plain text you can scroll.
export function Karaoke({
  lines,
  plain,
  time,
}: {
  lines?: LyricLine[];
  plain?: string;
  time: number;
}) {
  const current = useRef<HTMLParagraphElement>(null);
  const active = lines ? activeLine(lines, time) : -1;
  useEffect(() => {
    current.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [active]);
  if (!lines?.length)
    return (
      <div className="karaoke karaoke-plain" tabIndex={0} aria-label="Lyrics">
        {(plain || "").split(/\r?\n/).map((line, i) => (
          <p key={i}>{line || " "}</p>
        ))}
      </div>
    );
  return (
    <div className="karaoke" aria-label="Lyrics" aria-live="off">
      {lines.map((line, i) => (
        <p
          key={i}
          ref={i === active ? current : undefined}
          className={i === active ? "now" : i < active ? "past" : ""}
        >
          {line.text || " "}
        </p>
      ))}
    </div>
  );
}
