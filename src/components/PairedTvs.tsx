import { useState } from "react";
import { Check, Pencil, Tv } from "lucide-react";
import { controlRelay } from "../config/control";
import { pairings, usePairings } from "../remote/pairings";
import { revokePairing } from "../remote/useRemote";

// The TVs this device can play on. Pair one by scanning the code on the TV's screen.
export function PairedTvs() {
  const { list, active } = usePairings();
  const [editing, setEditing] = useState("");
  const [name, setName] = useState("");
  if (!controlRelay) return null;
  return (
    <section className="settings-section" id="settings-tvs">
      <h2>
        <Tv size={24} /> Your TVs
      </h2>
      <p className="muted">
        {list.length
          ? "Choose a title and press Play on TV to start it on the TV. This device then works as its remote."
          : "Open Open TV on your TV and scan the code on its screen with this device to pair. You only do this once."}
      </p>
      {list.length > 0 && (
        <ul className="paired-tvs">
          {list.map((tv) => (
            <li key={tv.tvId} className={tv.tvId === active ? "active" : ""}>
              {editing === tv.tvId ? (
                <form
                  className="paired-rename"
                  onSubmit={(event) => {
                    event.preventDefault();
                    pairings.rename(tv.tvId, name);
                    setEditing("");
                  }}
                >
                  <input
                    aria-label="TV name"
                    value={name}
                    maxLength={60}
                    autoFocus
                    onChange={(e) => setName(e.target.value)}
                  />
                  <button className="button secondary small">
                    <Check size={15} /> Save
                  </button>
                </form>
              ) : (
                <div className="paired-name">
                  <strong>{tv.name}</strong>
                  <span className="muted">
                    {tv.tvId === active
                      ? "Plays here when you choose Play on TV"
                      : "Paired"}
                  </span>
                </div>
              )}
              <div className="paired-actions">
                {tv.tvId !== active && (
                  <button
                    className="button text small"
                    onClick={() => pairings.choose(tv.tvId)}
                  >
                    Use this TV
                  </button>
                )}
                <button
                  className="icon-button"
                  aria-label={`Rename ${tv.name}`}
                  onClick={() => {
                    setEditing(tv.tvId);
                    setName(tv.name);
                  }}
                >
                  <Pencil size={15} />
                </button>
                <button
                  className="button text small"
                  onClick={() => void revokePairing(tv)}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
