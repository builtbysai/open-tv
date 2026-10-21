import { isTVMode } from "../tv/mode";
import { controlRelay } from "../config/control";
import { useState } from "react";
import { LockKeyhole } from "lucide-react";
import { hashPin } from "../domain/privacy";
import { privateViewingEnabled } from "../config/safety";
import {
  adultTrusted,
  forgetAdultConsent,
  hasAdultConsent,
  recordAdultConsent,
  setAdultTrusted,
  phonesMayShowAdult,
  setPhonesMayShowAdult,
} from "../persistence/adult-consent";
import type { UserState } from "../persistence/user-state";
interface Props {
  adult: boolean;
  onAdult(value: boolean): void;
  preferences: UserState["preferences"];
  onPreferences(patch: Partial<UserState["preferences"]>): void;
  onMessage(message: string): void;
}
export function PrivacySettings({
  adult,
  onAdult,
  preferences,
  onPreferences,
  onMessage,
}: Props) {
  const [consented, setConsented] = useState(hasAdultConsent),
    [age, setAge] = useState(false),
    [pin, setPin] = useState(""),
    [attempts, setAttempts] = useState(0),
    [lockedUntil, setLockedUntil] = useState(0),
    [trusted, setTrusted] = useState(adultTrusted),
    [phones, setPhones] = useState(phonesMayShowAdult),
    [pinAction, setPinAction] = useState<"change" | "remove" | null>(null);
  const show = async () => {
    if (!privateViewingEnabled) {
      onMessage("18+ content is disabled on this deployment.");
      return;
    }
    if (!consented && !age) {
      onMessage(
        "Confirm that you are 18 or older and legally allowed to view adult material in your region.",
      );
      return;
    }
    if (Date.now() < lockedUntil) {
      onMessage("Too many attempts. Try again in a minute.");
      return;
    }
    if (
      preferences.pinHash &&
      (await hashPin(pin, preferences.pinSalt!)) !== preferences.pinHash
    ) {
      const next = attempts + 1;
      setAttempts(next);
      if (next >= 5) {
        setLockedUntil(Date.now() + 60000);
        setAttempts(0);
      }
      onMessage("The PIN does not match.");
      return;
    }
    setAttempts(0);
    setPin("");
    if (!consented) {
      recordAdultConsent();
      setConsented(true);
    }
    onAdult(true);
    onMessage("18+ content is shown. It stays on until you hide it.");
  };
  return (
    <section className="privacy-panel">
      <h2>18+ content</h2>
      <p>Hidden by default. Turn it on only when you want it.</p>
      {adult ? (
        <>
          <div className="privacy-status">18+ content is shown</div>
          <button
            className="button primary"
            onClick={() => {
              onAdult(false);
              setPin("");
            }}
          >
            Hide 18+ content
          </button>
        </>
      ) : (
        <>
          {!consented && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={age}
                onChange={(e) => setAge(e.target.checked)}
              />
              I am 18+ and permitted to view adult content in my region.
            </label>
          )}
          {preferences.pinHash && (
            <label>
              Device PIN
              <input
                type="password"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                autoComplete="off"
              />
            </label>
          )}
          <button
            className="button secondary"
            disabled={!privateViewingEnabled}
            onClick={() => void show()}
          >
            <LockKeyhole size={16} />
            Show 18+ content
          </button>
        </>
      )}
      <p className="fine-print">
        {!privateViewingEnabled &&
          "18+ content is disabled on this deployment. "}
        Showing 18+ only adds 18+ sources and titles; everything else stays as
        it is. It stays on, even after you close the app, until you hide it. You
        confirm your age once on this device.
      </p>
      {consented && !adult && (
        <button
          className="button text"
          onClick={() => {
            forgetAdultConsent();
            setConsented(false);
            setAge(false);
            onMessage("Your confirmation was removed from this device.");
          }}
        >
          Remove my confirmation
        </button>
      )}
      {!preferences.pinHash ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const formElement = e.currentTarget;
            const f = new FormData(formElement);
            const value = String(f.get("newpin"));
            if (!/^\d{4,12}$/.test(value)) {
              onMessage("Use a PIN with 4–12 digits.");
              return;
            }
            const salt = Array.from(
              crypto.getRandomValues(new Uint8Array(16)),
              (b) => b.toString(16).padStart(2, "0"),
            ).join("");
            onPreferences({
              pinHash: await hashPin(value, salt),
              pinSalt: salt,
            });
            onMessage("Device PIN set.");
            formElement.reset();
          }}
        >
          <label>
            Optional device PIN
            <input
              type="password"
              name="newpin"
              inputMode="numeric"
              minLength={4}
              maxLength={12}
              required
              autoComplete="new-password"
            />
          </label>
          <button className="button text">Set device PIN</button>
        </form>
      ) : (
        <>
          <p className="fine-print">
            <LockKeyhole size={13} /> Device PIN is set.
          </p>
          <fieldset className="trust-choice">
            <legend>When the app opens with 18+ on</legend>
            <label className="checkbox">
              <input
                type="radio"
                name="adult-open"
                checked={!trusted}
                onChange={() => {
                  setAdultTrusted(false);
                  setTrusted(false);
                }}
              />
              Ask for my PIN
            </label>
            <label className="checkbox">
              <input
                type="radio"
                name="adult-open"
                checked={trusted}
                onChange={() => {
                  setAdultTrusted(true);
                  setTrusted(true);
                }}
              />
              Trust this device (don&rsquo;t ask)
            </label>
          </fieldset>
          {pinAction ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const form = new FormData(e.currentTarget);
                const current = String(form.get("current") || "");
                if (
                  (await hashPin(current, preferences.pinSalt!)) !==
                  preferences.pinHash
                ) {
                  onMessage("The current PIN does not match.");
                  return;
                }
                if (pinAction === "remove") {
                  onPreferences({ pinHash: undefined, pinSalt: undefined });
                  setAdultTrusted(false);
                  setTrusted(false);
                  onMessage("Device PIN removed.");
                } else {
                  const value = String(form.get("next") || "");
                  if (!/^\d{4,12}$/.test(value)) {
                    onMessage("Use a PIN with 4–12 digits.");
                    return;
                  }
                  const salt = Array.from(
                    crypto.getRandomValues(new Uint8Array(16)),
                    (b) => b.toString(16).padStart(2, "0"),
                  ).join("");
                  onPreferences({
                    pinHash: await hashPin(value, salt),
                    pinSalt: salt,
                  });
                  onMessage("Device PIN changed.");
                }
                setPinAction(null);
              }}
            >
              <label>
                Current PIN
                <input
                  type="password"
                  name="current"
                  inputMode="numeric"
                  required
                  autoComplete="off"
                />
              </label>
              {pinAction === "change" && (
                <label>
                  New PIN
                  <input
                    type="password"
                    name="next"
                    inputMode="numeric"
                    minLength={4}
                    maxLength={12}
                    required
                    autoComplete="new-password"
                  />
                </label>
              )}
              <div className="actions">
                <button className="button secondary">
                  {pinAction === "change" ? "Change PIN" : "Remove PIN"}
                </button>
                <button
                  type="button"
                  className="button text"
                  onClick={() => setPinAction(null)}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <div className="actions">
              <button
                className="button text"
                onClick={() => setPinAction("change")}
              >
                Change PIN
              </button>
              <button
                className="button text"
                onClick={() => setPinAction("remove")}
              >
                Remove PIN
              </button>
            </div>
          )}
        </>
      )}
      {isTVMode() && consented && controlRelay && (
        <label className="checkbox">
          <input
            type="checkbox"
            checked={phones}
            onChange={(e) => {
              setPhonesMayShowAdult(e.target.checked);
              setPhones(e.target.checked);
            }}
          />
          Let paired phones show 18+ here (a phone that shows 18+ can turn it on
          for this TV, so no PIN is typed with the remote)
        </label>
      )}
    </section>
  );
}
