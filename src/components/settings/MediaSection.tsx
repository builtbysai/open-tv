import { MediaForm } from "../MediaForm";
import type { SettingsProps, SettingsShared } from "./types";
export function MediaSection({
  servers,
  onItems,
  user,
  onDrafts,
  setMessage,
}: Pick<SettingsProps, "servers" | "onItems" | "user" | "onDrafts"> &
  Pick<SettingsShared, "setMessage">) {
  return (
    <section className="settings-section" id="settings-media">
      <h2>Add media</h2>
      <p className="muted">
        Add a video, audio stream or embedded player to your library.
      </p>
      <MediaForm
        servers={servers}
        draft={user.session.drafts.media}
        onDraft={(draft) => onDrafts({ media: draft || undefined })}
        onSave={(item) => {
          onItems(
            {
              id: "personal-media",
              name: "Personal media",
              kind: "library",
              enabled: true,
              classification: "general",
              refreshHours: 0,
              description: "Your media",
            },
            [item],
          );
          setMessage("Media added.");
        }}
        onNotice={setMessage}
      />
    </section>
  );
}
