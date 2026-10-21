// A placeholder shaped like the content that is on its way, so a slow screen looks like
// it is arriving instead of stuck.
export function Skeleton({
  label = "Loading",
  rows = 4,
}: {
  label?: string;
  rows?: number;
}) {
  return (
    <div className="skeleton" role="status" aria-label={label}>
      <span className="skeleton-line skeleton-title" />
      {Array.from({ length: rows }, (_, i) => (
        <span
          key={i}
          className="skeleton-line"
          style={{ width: `${92 - ((i * 13) % 40)}%` }}
        />
      ))}
    </div>
  );
}
