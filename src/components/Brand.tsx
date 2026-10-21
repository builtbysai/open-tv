import { SITE_NAME } from "../config/site";
// "Open TV" renders as the open·tv wordmark; any other name is split on its first word.
export function Brand() {
  const [first, ...rest] = SITE_NAME.toLowerCase().split(/\s+/);
  return (
    <>
      {first}
      {rest.length > 0 && <span className="brand-tv">{rest.join("")}</span>}
    </>
  );
}
