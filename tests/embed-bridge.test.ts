import { describe, expect, it } from "vitest";
import {
  canControl,
  embedCommand,
  emptyEmbedState,
  parseEmbedMessage,
  reduceEmbed,
} from "../src/playback/embed-bridge";

describe("parseEmbedMessage", () => {
  it("reads our own protocol", () => {
    expect(parseEmbedMessage({ source: "opentv", type: "playing" })).toEqual({
      protocol: "opentv",
      kind: "play",
    });
    expect(
      parseEmbedMessage({
        source: "opentv",
        type: "timeupdate",
        time: 12,
        duration: 600,
      }),
    ).toEqual({ protocol: "opentv", kind: "time", time: 12, duration: 600 });
    expect(
      parseEmbedMessage({
        source: "opentv",
        type: "error",
        message: "No title",
      }),
    ).toMatchObject({ kind: "error", message: "No title" });
  });
  it("reads Player.js messages, as objects or as JSON text", () => {
    const message = {
      context: "player.js",
      version: "0.0.10",
      event: "timeupdate",
      value: { seconds: 31.5, duration: 5400 },
    };
    const expected = {
      protocol: "playerjs",
      kind: "time",
      time: 31.5,
      duration: 5400,
    };
    expect(parseEmbedMessage(message)).toMatchObject(expected);
    expect(parseEmbedMessage(JSON.stringify(message))).toMatchObject(expected);
    expect(
      parseEmbedMessage({ context: "player.js", event: "ready" }),
    ).toMatchObject({ kind: "ready" });
  });
  it("reads one-way PLAYER_EVENT messages", () => {
    expect(
      parseEmbedMessage({
        type: "PLAYER_EVENT",
        data: {
          event: "timeupdate",
          currentTime: 90,
          duration: 7000,
          tmdbId: 1,
        },
      }),
    ).toEqual({ protocol: "events", kind: "time", time: 90, duration: 7000 });
    expect(
      parseEmbedMessage({
        type: "PLAYER_EVENT",
        data: { event: "pause", currentTime: 5 },
      }),
    ).toMatchObject({ protocol: "events", kind: "pause" });
  });
  it("ignores anything else, including bad numbers and oversized text", () => {
    expect(parseEmbedMessage("hello")).toBeNull();
    expect(parseEmbedMessage({ hello: 1 })).toBeNull();
    expect(
      parseEmbedMessage({ event: "timeupdate", currentTime: -1 }),
    ).toBeNull();
    expect(parseEmbedMessage("{" + "x".repeat(30000))).toBeNull();
    expect(parseEmbedMessage(null)).toBeNull();
  });
});

describe("reduceEmbed and commands", () => {
  it("tracks play, pause, time and the end", () => {
    let state = emptyEmbedState;
    state = reduceEmbed(state, { protocol: "playerjs", kind: "play" });
    expect(state).toMatchObject({
      protocol: "playerjs",
      playing: true,
      ready: true,
    });
    state = reduceEmbed(state, {
      protocol: "playerjs",
      kind: "time",
      time: 40,
      duration: 100,
    });
    expect(state).toMatchObject({ time: 40, duration: 100 });
    state = reduceEmbed(state, { protocol: "playerjs", kind: "ended" });
    expect(state).toMatchObject({ playing: false, ended: true });
  });
  it("builds commands only for protocols that can be driven", () => {
    expect(embedCommand("playerjs", "seek", 30)).toEqual({
      context: "player.js",
      version: "0.0.10",
      method: "setCurrentTime",
      value: 30,
    });
    expect(embedCommand("playerjs", "volume", 0.5)).toMatchObject({
      method: "setVolume",
      value: 50,
    });
    expect(embedCommand("opentv", "pause")).toMatchObject({
      source: "opentv-host",
      action: "pause",
    });
    expect(embedCommand("events", "play")).toBeNull();
    expect(embedCommand(null, "play")).toBeNull();
    expect(canControl("events")).toBe(false);
    expect(canControl("playerjs")).toBe(true);
  });
});

import { validateDeviceSettings } from "../src/persistence/device-settings";
describe("validateDeviceSettings", () => {
  it("keeps good choices and falls back on anything else", () => {
    expect(validateDeviceSettings({})).toEqual({
      embedSync: true,
      autoHideControls: true,
      skipSeconds: 10,
      motion: "system",
      autostart: true,
    });
    expect(
      validateDeviceSettings({
        embedSync: false,
        skipSeconds: 30,
        motion: "reduced",
        autoHideControls: false,
      }),
    ).toEqual({
      embedSync: false,
      autoHideControls: false,
      skipSeconds: 30,
      motion: "reduced",
      autostart: true,
    });
    expect(
      validateDeviceSettings({ skipSeconds: 7, motion: "x" }),
    ).toMatchObject({
      skipSeconds: 10,
      motion: "system",
    });
    expect(validateDeviceSettings("junk")).toMatchObject({ skipSeconds: 10 });
  });
});
