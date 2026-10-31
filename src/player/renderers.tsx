import type { ComponentType } from "preact";
import type { PlaySource } from "../core/module";
import { EmbedPlayer } from "./EmbedPlayer";
import type { PlaybackSession } from "./session";
import type { KeyName } from "./bridge";

// A renderer turns one kind of PlaySource into something on screen and reports back through
// the session. `embed` is the only one today. To play direct streams later (HLS, MP4 from a
// module such as live TV), register a renderer for "stream" here: a <video> element that
// calls session.attach(...), session.setState(...) and session.setStatus(...) like the embed
// does, and everything above it (TV UI, phone remote, progress, up next) works unchanged.
export interface RendererProps {
  source: PlaySource;
  session: PlaybackSession;
  onKey: (key: KeyName) => void;
}

const renderers: Record<string, ComponentType<RendererProps>> = {
  embed: ({ source, session, onKey }) =>
    source.type === "embed" ? <EmbedPlayer source={source} session={session} onKey={onKey} /> : null,
};

export function registerRenderer(type: string, component: ComponentType<RendererProps>) {
  renderers[type] = component;
}
export const rendererFor = (type: string): ComponentType<RendererProps> | undefined => renderers[type];
