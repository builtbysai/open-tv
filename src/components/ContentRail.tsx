import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { isAudio, type Content } from "../domain/content";
export function ContentRail({
  title,
  items,
  renderCard,
  onViewAll,
  loading = false,
}: {
  title: string;
  items: Content[];
  renderCard(item: Content): ReactNode;
  onViewAll?: () => void;
  loading?: boolean;
}) {
  const id = useId();
  const rail = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({
    start: true,
    end: true,
    overflow: false,
  });
  useEffect(() => {
    const element = rail.current;
    if (!element) return;
    const measure = () => {
      const remaining =
        element.scrollWidth - element.clientWidth - element.scrollLeft;
      const next = {
        start: element.scrollLeft < 2,
        end: remaining < 2,
        overflow: element.scrollWidth > element.clientWidth + 2,
      };
      setEdges((old) =>
        old.start === next.start &&
        old.end === next.end &&
        old.overflow === next.overflow
          ? old
          : next,
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener("scroll", measure, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", measure);
    };
  }, [items]);
  const move = (direction: number) =>
    rail.current?.scrollBy({
      left: direction * rail.current.clientWidth * 0.9,
      behavior: matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "instant"
        : "smooth",
    });
  if (!items.length)
    // A rail that is still filling shows its name over placeholder cards, never an empty box.
    return loading ? (
      <section className="content-section" aria-labelledby={id}>
        <div className="section-title">
          <h2 id={id}>{title}</h2>
        </div>
        <div
          className="content-rail"
          role="status"
          aria-label={`Loading ${title}`}
        >
          {Array.from({ length: 6 }, (_, i) => (
            <div
              className="content-card skeleton-card"
              key={i}
              aria-hidden="true"
            >
              <div className="card-art skeleton-line" />
              <span className="skeleton-line" style={{ width: "70%" }} />
            </div>
          ))}
        </div>
      </section>
    ) : null;
  return (
    <section className="content-section" aria-labelledby={id}>
      <div className="section-title">
        <h2 id={id}>{title}</h2>
        <div className="rail-actions">
          {onViewAll && (
            <button
              className="button text"
              onClick={onViewAll}
              aria-label={`View all ${title}`}
            >
              View all
              <ChevronRight size={15} />
            </button>
          )}
          {edges.overflow && (
            <div className="rail-paging" aria-label={`${title} pages`}>
              <button
                className="icon-button"
                aria-label={`Previous ${title}`}
                disabled={edges.start}
                onClick={() => move(-1)}
              >
                <ChevronLeft size={18} />
              </button>
              <button
                className="icon-button"
                aria-label={`Next ${title}`}
                disabled={edges.end}
                onClick={() => move(1)}
              >
                <ChevronRight size={18} />
              </button>
            </div>
          )}
        </div>
      </div>
      <div
        className={`content-rail ${items.every((item) => item.type === "live" || isAudio(item)) ? "channel-rail" : ""} ${items.every((item) => item.poster) ? "poster-rail" : ""}`}
        ref={rail}
      >
        {items.slice(0, 16).map(renderCard)}
      </div>
    </section>
  );
}
