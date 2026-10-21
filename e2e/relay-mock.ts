import type { BrowserContext } from "@playwright/test";
// A faithful stand-in for the relay's publish and streaming-subscribe API.
// Pass the same `topics` to two contexts (a phone and a TV) to connect them.
export function mockRelay(
  context: BrowserContext,
  topics = new Map<string, { id: string; message: string }[]>(),
) {
  return context.route("https://ntfy.sh/**", async (route) => {
    const request = route.request();
    const [, topic, kind] = new URL(request.url()).pathname.split("/");
    const list = topics.get(topic) ?? [];
    topics.set(topic, list);
    const headers = { "access-control-allow-origin": "*" };
    if (request.method() === "POST") {
      list.push({
        id: `m${list.length + 1}`,
        message: request.postData() || "",
      });
      return route.fulfill({ status: 200, headers, json: {} });
    }
    if (kind !== "json")
      return route.fulfill({ status: 200, headers, body: "" });
    const since = new URL(request.url()).searchParams.get("since") || "all";
    const start =
      since === "all" ? 0 : list.findIndex((m) => m.id === since) + 1;
    const body = list
      .slice(start)
      .map((m) => JSON.stringify({ ...m, event: "message", topic }))
      .join("\n");
    return route.fulfill({
      status: 200,
      headers,
      body: body ? body + "\n" : "",
    });
  });
}
