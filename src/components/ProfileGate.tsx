import {
  createContext,
  Fragment,
  useContext,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Brand } from "./Brand";
import { Plus } from "lucide-react";
import {
  CHOSEN_KEY,
  MAX_PROFILES,
  activeProfile,
  addProfile,
  loadRegistry,
  removeProfile,
  renameProfile,
  saveRegistry,
  type Profile,
  type Registry,
} from "../persistence/accounts";
import { isTVMode } from "../tv/mode";
import { useRemoteNavigation } from "../tv/useRemoteNavigation";
interface ProfilesApi {
  registry: Registry;
  active: Profile;
  add(name: string, kids?: boolean): void;
  rename(id: string, name: string): void;
  remove(id: string): void;
  switchProfile(): void;
}
const ProfilesContext = createContext<ProfilesApi | null>(null);
export function useProfiles(): ProfilesApi {
  const api = useContext(ProfilesContext);
  if (!api) throw new Error("Profiles are unavailable outside the gate.");
  return api;
}
const memoryStore = (() => {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
  };
})();
export function deviceStorage() {
  try {
    void localStorage.length;
    return localStorage;
  } catch {
    return memoryStore;
  }
}
const chosen = () => {
  try {
    return sessionStorage.getItem(CHOSEN_KEY);
  } catch {
    return null;
  }
};
const remember = (id: string | null) => {
  try {
    if (id) sessionStorage.setItem(CHOSEN_KEY, id);
    else sessionStorage.removeItem(CHOSEN_KEY);
  } catch {
    /* The picker simply shows again after a reload. */
  }
};
export const avatarStyle = (profile: Profile) => ({
  background: `linear-gradient(135deg, hsl(${profile.hue} 55% 46%), hsl(${(profile.hue + 40) % 360} 55% 26%))`,
});
export function ProfileGate({
  children,
}: {
  children: (profile: Profile) => ReactNode;
}) {
  const [registry, setRegistry] = useState(() => loadRegistry(deviceStorage()));
  const [choosing, setChoosing] = useState(
    () => registry.profiles.length > 1 && chosen() !== registry.active,
  );
  // Several changes in one go (rename, then add) each build on the one before.
  const latest = useRef(registry);
  const commit = (next: Registry) => {
    latest.current = next;
    saveRegistry(deviceStorage(), next);
    setRegistry(next);
  };
  const choose = (id: string) => {
    commit({ ...registry, active: id });
    remember(id);
    setChoosing(false);
  };
  const api = useMemo<ProfilesApi>(
    () => ({
      registry,
      active: activeProfile(registry),
      add(name, kids) {
        const next = addProfile(latest.current, name, kids);
        if (next !== latest.current) commit(next);
      },
      rename: (id, name) => commit(renameProfile(latest.current, id, name)),
      remove: (id) =>
        commit(removeProfile(deviceStorage(), latest.current, id)),
      switchProfile() {
        remember(null);
        setChoosing(true);
      },
    }),
    [registry],
  );
  if (choosing)
    return (
      <Picker
        registry={registry}
        onChoose={choose}
        onAdd={(name) => {
          const next = addProfile(registry, name);
          commit(next);
          const created = next.profiles[next.profiles.length - 1];
          if (created && next !== registry) {
            remember(created.id);
            commit({ ...next, active: created.id });
            setChoosing(false);
          }
        }}
      />
    );
  return (
    <ProfilesContext.Provider value={api}>
      <Fragment key={api.active.id}>{children(api.active)}</Fragment>
    </ProfilesContext.Provider>
  );
}
function Picker({
  registry,
  onChoose,
  onAdd,
}: {
  registry: Registry;
  onChoose(id: string): void;
  onAdd(name: string): void;
}) {
  const [adding, setAdding] = useState(false),
    [name, setName] = useState("");
  useRemoteNavigation(isTVMode(), "home", () => {});
  return (
    <main className="profile-picker">
      <div className="brand">
        <Brand />
      </div>
      <h1>Who’s watching?</h1>
      <div className="profile-grid" role="group" aria-label="Profiles">
        {registry.profiles.map((profile, index) => (
          <button
            key={profile.id}
            className="profile-tile"
            autoFocus={profile.id === registry.active || index === 0}
            onClick={() => onChoose(profile.id)}
          >
            <span
              className="avatar"
              style={avatarStyle(profile)}
              aria-hidden="true"
            >
              {profile.name[0].toUpperCase()}
            </span>
            {profile.name}
          </button>
        ))}
        {registry.profiles.length < MAX_PROFILES &&
          (adding ? (
            <form
              className="profile-tile profile-new"
              onSubmit={(event) => {
                event.preventDefault();
                if (name.trim()) onAdd(name);
              }}
            >
              <input
                autoFocus
                aria-label="Profile name"
                maxLength={24}
                placeholder="Name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
              <button className="button primary" disabled={!name.trim()}>
                Add
              </button>
            </form>
          ) : (
            <button className="profile-tile" onClick={() => setAdding(true)}>
              <span className="avatar add" aria-hidden="true">
                <Plus size={32} />
              </span>
              Add profile
            </button>
          ))}
      </div>
    </main>
  );
}
// Kids profiles have no Settings, sources or 18+. False outside the gate.
export const useRestricted = () =>
  useContext(ProfilesContext)?.active.kids === true;
