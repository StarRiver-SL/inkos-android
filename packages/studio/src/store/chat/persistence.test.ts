import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  loadPersistedInputDraft,
  loadPersistedMessageState,
  persistInputDraft,
  persistMessageState,
} from "./persistence";
import type { MessageState } from "./types";

const storage = new Map<string, string>();

describe("chat persistence", () => {
  beforeEach(() => {
    storage.clear();
    const localStorage = {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(key, value);
      },
      removeItem: (key: string) => {
        storage.delete(key);
      },
    };
    vi.stubGlobal("localStorage", localStorage);
    vi.stubGlobal("window", { localStorage });
  });

  it("persists unsent chat input immediately", () => {
    persistInputDraft("typed just before webview reload");

    expect(loadPersistedInputDraft()).toBe("typed just before webview reload");
    expect(loadPersistedMessageState().input).toBe("typed just before webview reload");

    persistInputDraft("");
    expect(loadPersistedInputDraft()).toBe("");
  });

  it("caps localStorage payloads and preserves current session metadata", () => {
    const messages = Array.from({ length: 120 }, (_, index) => ({
      role: index % 2 === 0 ? "user" as const : "assistant" as const,
      content: `message-${index} ${"长文本".repeat(1_800)}`,
      timestamp: index + 1,
    }));
    const state: MessageState = {
      activeSessionId: "session-large",
      sessionIdsByBook: { book: ["session-large"] },
      sessions: {
        "session-large": {
          sessionId: "session-large",
          bookId: "book",
          sessionKind: "play",
          playMode: "open",
          title: null,
          messages,
          deletedMessageKeys: [],
          stream: null,
          abortController: null,
          isStreaming: false,
          lastError: null,
          isDraft: false,
        },
      },
      input: "",
      selectedModel: "model",
      selectedService: "service",
    };

    persistMessageState(state);

    const raw = [...storage.values()].find((value) => value.includes("session-large")) ?? "";
    const loaded = loadPersistedMessageState();
    expect(raw.length).toBeLessThanOrEqual(240_000);
    expect(loaded.sessions?.["session-large"]?.sessionKind).toBe("play");
    expect(loaded.sessions?.["session-large"]?.playMode).toBe("open");
    expect(loaded.sessions?.["session-large"]?.messages.at(-1)?.content).toContain("message-119");
  });
});
