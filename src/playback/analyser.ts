// One Web Audio graph per media element. createMediaElementSource may only be called once
// for an element, and once called the element's sound runs through the graph, so a stream
// must be known to be analysable (same origin, an in-page MSE stream, or CORS-enabled)
// before it is connected. Otherwise the browser would play silence.
interface Graph {
  context: AudioContext;
  analyser: AnalyserNode;
}
const graphs = new WeakMap<HTMLMediaElement, Graph>();
export function connectAnalyser(
  element: HTMLMediaElement,
): AnalyserNode | null {
  const existing = graphs.get(element);
  if (existing) {
    void existing.context.resume().catch(() => {});
    return existing.analyser;
  }
  try {
    const Context =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!Context) return null;
    const context = new Context();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.7;
    const source = context.createMediaElementSource(element);
    source.connect(analyser);
    analyser.connect(context.destination);
    graphs.set(element, { context, analyser });
    void context.resume().catch(() => {});
    return analyser;
  } catch {
    return null;
  }
}
// A direct file can be analysed when the server lets this page read it.
export async function corsReadable(
  url: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "GET",
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(6000)])
        : AbortSignal.timeout(6000),
    });
    void response.body?.cancel();
    return response.ok && response.type === "cors";
  } catch {
    return false;
  }
}
