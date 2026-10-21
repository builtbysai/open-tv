import { useEffect, useReducer, useRef, useState } from "react";
import { Play } from "lucide-react";
import { PlaybackError } from "./player/PlaybackError";
import type { Content } from "../domain/content";
import {
  embedCommand,
  emptyEmbedState,
  parseEmbedMessage,
  playerJsSubscriptions,
  reduceEmbed,
  type EmbedAction,
  type EmbedEvent,
  type EmbedState,
} from "../playback/embed-bridge";

// What the player can do with a frame that speaks a protocol it understands.
export interface EmbedApi {
  command(action: EmbedAction, value?: number): boolean;
}

// A server's embed page in a frame. A page from another site cannot be read, so the only
// sign of a server that did not return the title is a frame that never finishes loading.
export function EmbedFrame({
  item,
  onFailed,
  onNextChannel,
  onBack,
  onState,
  onApi,
}: {
  item: Content;
  // The server that never answered: the app drops it and plays the next one.
  onFailed?(item: Content, url: string): void;
  onNextChannel?(): void;
  onBack?(): void;
  // Progress and play state, when the server reports them.
  onState?(state: EmbedState): void;
  onApi?(api: EmbedApi | null): void;
}) {
  const stream = item.streams[0];
  const url = stream.url;
  const guard = stream.guard ?? "open";
  // The click guard sits over the frame until the first click, which it absorbs.
  const [guarded, setGuarded] = useState(guard === "click");
  const [slow, setSlow] = useState(false);
  // Retry reloads the frame from scratch.
  const [attempt, setAttempt] = useState(0);
  // A server that cooperates can say what is happening (see docs/SERVERS.md).
  const frame = useRef<HTMLIFrameElement>(null);
  const [reported, setReported] = useState("");
  const told = useRef(false);
  const [state, dispatch] = useReducer(
    (current: EmbedState, action: EmbedEvent | "reset") =>
      action === "reset" ? emptyEmbedState : reduceEmbed(current, action),
    emptyEmbedState,
  );
  const protocol = useRef<EmbedState["protocol"]>(null);
  protocol.current = state.protocol;
  useEffect(() => onState?.(state), [state, onState]);
  // Commands go to the server's own address only.
  useEffect(() => {
    let origin = "*";
    try {
      origin = new URL(url).origin;
    } catch {
      /* Fall back to any address; the message carries nothing private. */
    }
    onApi?.({
      command(action, value) {
        const message = embedCommand(protocol.current, action, value);
        if (!message || !frame.current?.contentWindow) return false;
        frame.current.contentWindow.postMessage(message, origin);
        return true;
      },
    });
    return () => onApi?.(null);
  }, [url, onApi]);
  useEffect(() => {
    setGuarded(guard === "click");
  }, [url, guard]);
  useEffect(() => {
    setSlow(false);
    setReported("");
    told.current = false;
    dispatch("reset");
    const timer = setTimeout(() => setSlow(true), 15000);
    const listen = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow) return;
      const message = parseEmbedMessage(event.data);
      if (!message) return;
      dispatch(message);
      if (["ready", "play", "time"].includes(message.kind)) {
        clearTimeout(timer);
        setSlow(false);
        setReported("");
      } else if (message.kind === "error") {
        told.current = true;
        clearTimeout(timer);
        setSlow(true);
        setReported(message.message ?? "");
      }
    };
    window.addEventListener("message", listen);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("message", listen);
    };
  }, [url, attempt]);
  return (
    <>
      <iframe
        key={attempt}
        ref={frame}
        title={item.title}
        src={url}
        onLoad={() => {
          // A page that loads but says it has no title is still a failure.
          if (!told.current) setSlow(false);
          // A Player.js server reports only to a parent that asks for each event.
          try {
            const target = new URL(url).origin;
            for (const message of playerJsSubscriptions())
              frame.current?.contentWindow?.postMessage(message, target);
          } catch {
            /* No address to send to. */
          }
        }}
        sandbox={
          guard === "sandbox"
            ? "allow-scripts allow-same-origin allow-presentation"
            : undefined
        }
        allow={
          item.classification !== "general"
            ? "autoplay; fullscreen"
            : "autoplay; fullscreen; picture-in-picture"
        }
        allowFullScreen
        referrerPolicy="no-referrer"
      />
      {guarded && (
        <button
          className="embed-guard"
          onClick={() => setGuarded(false)}
          aria-label={`Click to play ${item.title}`}
        >
          <Play size={44} />
          <span>Click to play</span>
        </button>
      )}
      {slow && (
        <PlaybackError
          title="This server did not return the title"
          message={
            reported
              ? `The server said: ${reported}`
              : item.streams.length > 1
                ? "Try the next source, or keep waiting."
                : "It may still be loading. Try again in a moment."
          }
          onRetry={() => setAttempt((n) => n + 1)}
          onNextSource={
            item.streams.length > 1 && onFailed
              ? () => onFailed(item, url)
              : undefined
          }
          onNextChannel={onNextChannel}
          onBack={onBack ?? (() => setSlow(false))}
        >
          <button className="button secondary" onClick={() => setSlow(false)}>
            Keep waiting
          </button>
        </PlaybackError>
      )}
    </>
  );
}
