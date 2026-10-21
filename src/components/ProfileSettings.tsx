import { useState } from "react";
import { Check, Trash2 } from "lucide-react";
import { MAX_PROFILES } from "../persistence/accounts";
import { avatarStyle, useProfiles } from "./ProfileGate";
export function ProfileSettings() {
  const {
    registry,
    active,
    add,
    rename,
    remove,
    setKids: makeKids,
    switchProfile,
  } = useProfiles();
  const [name, setName] = useState(""),
    [kids, setKids] = useState(false),
    [confirming, setConfirming] = useState("");
  return (
    <section className="settings-section" id="settings-profiles">
      <h2>Profiles</h2>
      <p className="muted">
        Each profile keeps its own list, history, progress and collections.
        Sources are shared. A Kids profile shows titles tagged for children,
        with no 18+ content and no Settings.
      </p>
      <ul className="profile-list">
        {registry.profiles.map((profile) => (
          <li key={profile.id}>
            <span
              className="avatar avatar-small"
              style={avatarStyle(profile)}
              aria-hidden="true"
            >
              {profile.name[0].toUpperCase()}
            </span>
            <input
              aria-label={`Name for ${profile.name}`}
              defaultValue={profile.name}
              maxLength={24}
              onBlur={(event) => {
                const value = event.target.value.trim();
                if (!value) event.target.value = profile.name;
                else if (value !== profile.name) rename(profile.id, value);
              }}
            />
            <label className="checkbox">
              <input
                type="checkbox"
                checked={profile.kids === true}
                // The profile in use can't turn itself into Kids: Settings would vanish.
                disabled={profile.id === active.id}
                onChange={(event) => makeKids(profile.id, event.target.checked)}
              />
              Kids
            </label>
            {profile.id === active.id ? (
              <span className="profile-active">
                <Check size={14} /> Active
              </span>
            ) : (
              <button
                className="button text"
                onClick={() => switchProfile(profile.id)}
              >
                Switch to {profile.name}
              </button>
            )}
            {registry.profiles.length > 1 &&
              (confirming === profile.id ? (
                <button
                  className="button text danger"
                  onClick={() => {
                    setConfirming("");
                    remove(profile.id);
                  }}
                >
                  Delete {profile.name}?
                </button>
              ) : (
                <button
                  className="icon-button"
                  aria-label={`Delete ${profile.name}`}
                  onClick={() => setConfirming(profile.id)}
                >
                  <Trash2 size={16} />
                </button>
              ))}
          </li>
        ))}
      </ul>
      {registry.profiles.length < MAX_PROFILES && (
        <form
          className="inline-form"
          onSubmit={(event) => {
            event.preventDefault();
            if (!name.trim()) return;
            add(name, kids);
            setName("");
            setKids(false);
          }}
        >
          <label>
            New profile
            <input
              value={name}
              maxLength={24}
              placeholder="Name"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={kids}
              onChange={(event) => setKids(event.target.checked)}
            />
            Kids profile
          </label>
          <button className="button secondary" disabled={!name.trim()}>
            Add
          </button>
        </form>
      )}
    </section>
  );
}
