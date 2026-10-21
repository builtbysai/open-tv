// A signal that aborts after `ms` or with `signal`. AbortSignal.timeout and .any are missing
// from older Android WebViews, where calling them would fail every request.
export function timeoutSignal(ms: number, signal?: AbortSignal): AbortSignal {
  if (typeof AbortSignal.timeout === "function") {
    const timeout = AbortSignal.timeout(ms);
    if (!signal) return timeout;
    if (typeof AbortSignal.any === "function")
      return AbortSignal.any([signal, timeout]);
  }
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new DOMException("Timed out", "TimeoutError")),
    ms,
  );
  const stop = () => {
    clearTimeout(timer);
    controller.abort(signal?.reason);
  };
  if (signal?.aborted) stop();
  else signal?.addEventListener("abort", stop, { once: true });
  return controller.signal;
}
