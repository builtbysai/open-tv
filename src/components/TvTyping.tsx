import { useEffect, useRef, useState } from "react";
import { Keyboard } from "lucide-react";
import { remoteMessage, type Remote } from "../remote/useRemote";
// While the paired TV shows its search, the phone types for it: the text lands in the TV's
// search field as it is typed, and Enter runs the search there.
export function TvTyping({
  remote,
  onNotice,
}: {
  remote: Remote;
  onNotice(message: string): void;
}) {
  const [text, setText] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const open = Boolean(remote.tv && remote.tvOnline && remote.state?.typing);
  useEffect(() => {
    if (!open) setText("");
    return () => clearTimeout(timer.current);
  }, [open]);
  if (!open || !remote.tv) return null;
  const send = (value: string, submit = false) =>
    remote
      .send({ t: "search", text: value, ...(submit ? { submit } : {}) })
      .catch((error: Error) => onNotice(remoteMessage(error.message)));
  return (
    <form
      className="tv-typing"
      aria-label={`Type on ${remote.tv.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        clearTimeout(timer.current);
        void send(text, true);
      }}
    >
      <Keyboard size={18} />
      <input
        type="search"
        enterKeyHint="search"
        autoComplete="off"
        maxLength={300}
        placeholder={`Type to search on ${remote.tv.name}`}
        aria-label={`Search on ${remote.tv.name}`}
        value={text}
        onChange={(e) => {
          const value = e.target.value;
          setText(value);
          clearTimeout(timer.current);
          timer.current = setTimeout(() => void send(value), 250);
        }}
      />
      <button className="button primary small">Search</button>
    </form>
  );
}
