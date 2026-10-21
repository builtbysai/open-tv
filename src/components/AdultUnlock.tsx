import { useEffect, useRef, useState } from "react";
import { LockKeyhole } from "lucide-react";
import { hashPin } from "../domain/privacy";

// Shown when the app opens and 18+ was on last time, on a device that is not trusted:
// the PIN brings it back, or the person keeps it hidden.
export function AdultUnlock({
  pinHash,
  pinSalt,
  onUnlock,
  onSkip,
  onTrust,
}: {
  pinHash: string;
  pinSalt: string;
  onUnlock(): void;
  onSkip(): void;
  onTrust(): void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [pin, setPin] = useState("");
  const [trust, setTrust] = useState(false);
  const [message, setMessage] = useState("");
  const [attempts, setAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState(0);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (Date.now() < lockedUntil) {
      setMessage("Too many attempts. Try again in a minute.");
      return;
    }
    if ((await hashPin(pin, pinSalt)) !== pinHash) {
      const next = attempts + 1;
      setAttempts(next);
      if (next >= 5) {
        setLockedUntil(Date.now() + 60000);
        setAttempts(0);
      }
      setMessage("The PIN does not match.");
      return;
    }
    if (trust) onTrust();
    onUnlock();
  };
  return (
    <dialog
      ref={dialog}
      className="unlock-dialog"
      aria-labelledby="unlock-title"
      onCancel={(event) => {
        event.preventDefault();
        onSkip();
      }}
    >
      <form onSubmit={(event) => void submit(event)}>
        <h2 id="unlock-title">
          <LockKeyhole size={20} /> Show 18+ content again?
        </h2>
        <p className="muted">
          18+ content was on when you last used Open TV. Enter your PIN to bring
          it back.
        </p>
        <label>
          Device PIN
          <input
            type="password"
            inputMode="numeric"
            autoComplete="off"
            autoFocus
            value={pin}
            onChange={(e) => setPin(e.target.value)}
          />
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={trust}
            onChange={(e) => setTrust(e.target.checked)}
          />
          Trust this device: don&rsquo;t ask for the PIN when the app opens.
        </label>
        {message && (
          <p role="alert" className="source-error">
            {message}
          </p>
        )}
        <div className="actions">
          <button className="button primary" disabled={!pin}>
            Show 18+ content
          </button>
          <button type="button" className="button text" onClick={onSkip}>
            Keep hidden
          </button>
        </div>
      </form>
    </dialog>
  );
}
