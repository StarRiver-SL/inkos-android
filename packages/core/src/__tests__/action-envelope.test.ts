import { describe, expect, it } from "vitest";
import { normalizeActionEnvelope } from "../interaction/action-envelope.js";

describe("normalizeActionEnvelope", () => {
  it("applies the shared free-text source default", () => {
    expect(normalizeActionEnvelope({ instruction: "continue" })).toEqual({
      instruction: "continue",
      actionSource: "free-text",
    });
  });

  it("preserves confirmed Play action metadata", () => {
    expect(normalizeActionEnvelope({
      instruction: "start",
      actionSource: "button",
      requestedIntent: "play_start",
      playMode: "open",
      actionPayload: { playStart: { premise: "A city above the clouds", mode: "open" } },
    })).toMatchObject({
      actionSource: "button",
      requestedIntent: "play_start",
      playMode: "open",
    });
  });
});
