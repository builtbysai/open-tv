import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import type { MediaServer } from "../domain/servers";
import type { Content } from "../domain/content";
import { MediaForm } from "./MediaForm";
export function MediaEditor({
  item,
  servers,
  onSave,
  onClose,
  onNotice,
}: {
  item: Content;
  servers?: MediaServer[];
  onSave(item: Content): void;
  onClose(): void;
  onNotice(message: string): void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    ref.current?.showModal();
    return () => previous?.focus();
  }, []);
  return (
    <dialog
      ref={ref}
      className="detail-dialog media-editor"
      aria-labelledby="media-editor-title"
      onCancel={onClose}
    >
      <div className="detail-content">
        <button
          className="icon-button detail-close"
          aria-label="Close media editor"
          onClick={onClose}
        >
          <X />
        </button>
        <h2 id="media-editor-title">Edit your media</h2>
        <MediaForm
          initial={item}
          servers={servers}
          onSave={(edited) => {
            onSave(edited);
            onClose();
          }}
          onNotice={onNotice}
        />
      </div>
    </dialog>
  );
}
