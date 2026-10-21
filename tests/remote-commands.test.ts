import { describe, expect, it } from "vitest";
import { parseControllerMessage, parseState } from "../src/remote/protocol";

describe("remote search and fullscreen commands", () => {
  it("carries text typed on the phone, bounded and without control characters", () => {
    expect(
      parseControllerMessage(
        JSON.stringify({
          t: "search",
          id: "cmd-000001",
          text: "big\u0007 buck",
        }),
      ),
    ).toEqual({ t: "search", id: "cmd-000001", text: "big buck" });
    expect(
      parseControllerMessage(
        JSON.stringify({
          t: "search",
          id: "cmd-000002",
          text: "x".repeat(500),
          submit: true,
        }),
      ),
    ).toMatchObject({ text: "x".repeat(300), submit: true });
    expect(
      parseControllerMessage(JSON.stringify({ t: "search", id: "cmd-000003" })),
    ).toBeNull();
  });
  it("presses Back on the TV", () => {
    expect(
      parseControllerMessage(JSON.stringify({ t: "back", id: "cmd-000005" })),
    ).toEqual({ t: "back", id: "cmd-000005" });
  });
  it("toggles fullscreen", () => {
    expect(
      parseControllerMessage(
        JSON.stringify({ t: "fullscreen", id: "cmd-000004" }),
      ),
    ).toEqual({ t: "fullscreen", id: "cmd-000004" });
  });
  it("tells phones when the TV's search is open", () => {
    const base = { phase: "idle", position: 0, duration: 0, at: 1, title: "" };
    expect(parseState({ ...base, typing: true })?.typing).toBe(true);
    expect(parseState(base)?.typing).toBeUndefined();
  });
});
