import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createStore } from "zustand/vanilla";
import type { ChatStore } from "../../types";
import { initialChatState } from "../../initialState";
import { createCreateSlice } from "../create/action";
import { createMessageSlice } from "./action";

const { fetchJson } = vi.hoisted(() => ({
  fetchJson: vi.fn(),
}));

vi.mock("../../../../hooks/use-api", () => ({
  fetchJson,
  buildApiUrl: (path: string) => path,
}));

class FakeEventSource {
  readonly url: string;
  readonly listeners = new Map<string, Array<(event: MessageEvent) => void>>();
  constructor(url: string) {
    this.url = url;
    fakeEventSources.push(this);
  }
  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    const current = this.listeners.get(type) ?? [];
    current.push(listener);
    this.listeners.set(type, current);
  }
  close() {}
  emit(type: string, data: unknown) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener({ data: JSON.stringify(data) } as MessageEvent);
    }
  }
}

const fakeEventSources: FakeEventSource[] = [];

function createTestStore() {
  return createStore<ChatStore>()((...args) => ({
    ...initialChatState,
    ...createMessageSlice(...args),
    ...createCreateSlice(...args),
  }));
}

describe("chat message actions", () => {
  const originalEventSource = globalThis.EventSource;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchJson.mockReset();
    fetchJson.mockResolvedValue({});
    fakeEventSources.length = 0;
    (globalThis as any).EventSource = FakeEventSource;
    (globalThis as any).fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const data = await fetchJson(typeof url === "string" ? url : url.toString(), init);
      return new Response(JSON.stringify(data), {
        status: data && typeof data === "object" && "error" in data ? 400 : 200,
        headers: { "content-type": "application/json" },
      });
    });
  });

  afterEach(() => {
    (globalThis as any).EventSource = originalEventSource;
    (globalThis as any).fetch = originalFetch;
  });

  it("keeps play mode local for draft sessions until the first message persists them", () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "play", "open");

    store.getState().setSessionPlayMode(sessionId, "guided");

    expect(store.getState().sessions[sessionId]?.playMode).toBe("guided");
    expect(fetchJson).not.toHaveBeenCalled();
  });

  it("syncs the created book id returned by /agent back into the current runtime session", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "book-create");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "book-create" } })
      .mockResolvedValueOnce({
        response: "已创建书籍。",
        session: { sessionId, activeBookId: "new-book", sessionKind: "book" },
      });

    await store.getState().sendMessage(sessionId, "创建一本债务悬疑长篇", { sessionKind: "book-create" });

    expect(store.getState().sessions[sessionId]).toMatchObject({
      bookId: "new-book",
      sessionKind: "book",
      isDraft: false,
    });
    expect(store.getState().sessionIdsByBook["new-book"]).toContain(sessionId);
  });

  it("keeps a tool-only stream when /agent returns an empty response after a proposal", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "book-create");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");

    let resolveAgent!: (value: unknown) => void;
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "book-create" } })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAgent = resolve;
      }));

    const sent = store.getState().sendMessage(sessionId, "创建一本债务悬疑长篇", { sessionKind: "book-create" });
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(1));

    fakeEventSources[0].emit("tool:start", {
      sessionId,
      id: "proposal-1",
      tool: "propose_action",
    });
    fakeEventSources[0].emit("tool:end", {
      sessionId,
      id: "proposal-1",
      tool: "propose_action",
      details: {
        kind: "proposed_action",
        action: "create_book",
        targetSessionKind: "book-create",
        sameSession: true,
        title: "确认建书",
        instruction: "创建一本债务悬疑长篇",
      },
    });

    resolveAgent({ response: "", session: { sessionId, sessionKind: "book-create" } });
    await sent;

    const messages = store.getState().sessions[sessionId]?.messages ?? [];
    const assistant = messages.find((message) => message.role === "assistant");
    expect(assistant?.content).not.toContain("模型未返回文本内容");
    expect(assistant?.parts).toEqual([
      expect.objectContaining({
        type: "tool",
        execution: expect.objectContaining({
          tool: "propose_action",
          status: "completed",
        }),
      }),
    ]);
  });

  it("restores live writing deltas and bounds workflow logs", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession("book-1", "book");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");

    let resolveAgent!: (value: unknown) => void;
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: "book-1", sessionKind: "book" } })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAgent = resolve;
      }));

    const sent = store.getState().sendMessage(sessionId, "继续写下一章", { sessionKind: "book", activeBookId: "book-1" });
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(1));

    fakeEventSources[0].emit("tool:start", {
      sessionId,
      id: "writer-1",
      tool: "sub_agent",
      args: { agent: "writer", bookId: "book-1" },
      stages: ["准备输入", "撰写正文", "保存章节"],
    });
    fakeEventSources[0].emit("write:delta", { sessionId, text: "雨声落在窗沿。" });
    for (let i = 0; i < 45; i += 1) {
      fakeEventSources[0].emit("log", { sessionId, message: `阶段：撰写正文 ${i}` });
    }
    fakeEventSources[0].emit("result", { sessionId });

    const assistant = store.getState().sessions[sessionId]?.messages.at(-1);
    const execution = assistant?.toolExecutions?.[0];
    expect(execution?.streamingText).toContain("雨声落在窗沿");
    expect(execution?.logs).toHaveLength(40);
    expect(execution?.logs?.[0]).toBe("阶段：撰写正文 5");

    resolveAgent({ response: "已保存。", session: { sessionId, sessionKind: "book", activeBookId: "book-1" } });
    await sent;
  });

  it("keeps official llm deltas as writing workflow output when the final response is textless", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession("book-1", "book");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");

    let resolveAgent!: (value: unknown) => void;
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: "book-1", sessionKind: "book" } })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAgent = resolve;
      }));

    const sent = store.getState().sendMessage(sessionId, "继续写下一章", {
      sessionKind: "book",
      activeBookId: "book-1",
      requestedIntent: "write_next",
    });
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(1));

    fakeEventSources[0].emit("tool:start", {
      sessionId,
      id: "writer-1",
      tool: "sub_agent",
      args: { agent: "writer", bookId: "book-1" },
      stages: ["准备输入", "撰写正文", "保存章节"],
    });
    fakeEventSources[0].emit("llm:delta", { sessionId, text: "她把伞收起，水珠一路滚到门槛。" });
    fakeEventSources[0].emit("tool:end", {
      sessionId,
      id: "writer-1",
      tool: "sub_agent",
      result: { content: [{ type: "text", text: "章节已保存。" }] },
    });
    fakeEventSources[0].emit("result", { sessionId });

    resolveAgent({
      response: "",
      session: { sessionId, sessionKind: "book", activeBookId: "book-1" },
    });
    await sent;

    const assistant = store.getState().sessions[sessionId]?.messages.at(-1);
    expect(assistant?.content).not.toContain("模型未返回文本内容");
    expect(assistant?.toolExecutions?.[0]?.streamingText).toContain("她把伞收起");
    expect(assistant?.toolExecutions?.[0]?.status).toBe("completed");
  });

  it("keeps llm deltas inside the writing workflow after a tool progress update", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession("book-1", "book");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");

    let resolveAgent!: (value: unknown) => void;
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: "book-1", sessionKind: "book" } })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAgent = resolve;
      }));

    const sent = store.getState().sendMessage(sessionId, "继续写下一章", {
      sessionKind: "book",
      activeBookId: "book-1",
      requestedIntent: "write_next",
    });
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(1));

    fakeEventSources[0].emit("tool:start", {
      sessionId,
      id: "writer-1",
      tool: "sub_agent",
      args: { agent: "writer", bookId: "book-1" },
      stages: ["准备输入", "撰写正文", "保存章节"],
    });
    fakeEventSources[0].emit("tool:update", {
      sessionId,
      id: "writer-1",
      tool: "sub_agent",
      partialResult: "阶段：撰写正文",
    });
    fakeEventSources[0].emit("llm:delta", {
      sessionId,
      text: "这段正文应当始终留在实时写作框内。",
    });
    fakeEventSources[0].emit("result", { sessionId });

    const assistant = store.getState().sessions[sessionId]?.messages.at(-1);
    expect(assistant?.content).not.toContain("这段正文应当始终留在实时写作框内");
    expect(assistant?.toolExecutions?.[0]?.status).toBe("processing");
    expect(assistant?.toolExecutions?.[0]?.streamingText).toContain("这段正文应当始终留在实时写作框内");

    resolveAgent({
      response: "",
      session: { sessionId, sessionKind: "book", activeBookId: "book-1" },
    });
    await sent;
  });

  it("accumulates llm progress token estimates into the active writing workflow", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession("book-1", "book");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");

    let resolveAgent!: (value: unknown) => void;
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: "book-1", sessionKind: "book" } })
      .mockImplementationOnce(() => new Promise((resolve) => {
        resolveAgent = resolve;
      }));

    const sent = store.getState().sendMessage(sessionId, "继续写下一章", { sessionKind: "book", activeBookId: "book-1" });
    await vi.waitFor(() => expect(fakeEventSources).toHaveLength(1));

    fakeEventSources[0].emit("tool:start", {
      sessionId,
      id: "writer-1",
      tool: "sub_agent",
      args: { agent: "writer", bookId: "book-1" },
      stages: ["准备输入", "撰写正文"],
    });
    fakeEventSources[0].emit("llm:progress", {
      sessionId,
      status: "streaming",
      elapsedMs: 3000,
      totalChars: 100,
      chineseChars: 80,
    });

    const assistant = store.getState().sessions[sessionId]?.messages.at(-1);
    const execution = assistant?.toolExecutions?.[0];
    expect(execution?.tokenUsage).toMatchObject({
      totalTokens: 85,
      estimated: true,
      source: "stream",
    });
    expect(execution?.stages?.[0]).toMatchObject({
      status: "active",
      progress: {
        status: "streaming",
        totalChars: 100,
        chineseChars: 80,
        estimatedTokens: 85,
      },
    });
    expect(assistant?.tokenUsage?.totalTokens).toBe(85);

    resolveAgent({ response: "已保存。", session: { sessionId, sessionKind: "book", activeBookId: "book-1" } });
    await sent;
  });

  it("cancels the active stream and asks the backend to stop the agent operation", async () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "chat");
    store.getState().setSelectedModel("deepseek-v4-flash", "kkaiapi");
    fetchJson
      .mockResolvedValueOnce({ session: { sessionId, bookId: null, sessionKind: "chat" } })
      .mockImplementationOnce((_path, init?: RequestInit) => new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("Aborted", "AbortError"));
        });
      }))
      .mockResolvedValueOnce({ ok: true });

    const sent = store.getState().sendMessage(sessionId, "写一个开场", { sessionKind: "chat" });
    await vi.waitFor(() => expect(store.getState().sessions[sessionId]?.isStreaming).toBe(true));
    await vi.waitFor(() => expect(fakeEventSources.length).toBeGreaterThan(0));
    fakeEventSources[0]?.emit("tool:start", {
      sessionId,
      id: "writer-1",
      tool: "sub_agent",
      args: { agent: "writer" },
      stages: ["准备章节输入", "撰写章节草稿"],
    });
    await vi.waitFor(() => {
      const assistant = store.getState().sessions[sessionId]?.messages.at(-1);
      expect(assistant?.toolExecutions?.[0]?.status).toBe("running");
    });

    await store.getState().cancelMessage(sessionId);
    await sent;

    const session = store.getState().sessions[sessionId];
    expect(session?.isStreaming).toBe(false);
    expect(session?.abortController).toBeNull();
    const assistant = session?.messages.at(-1);
    expect(assistant?.content).toContain("已停止当前生成");
    expect(assistant?.toolExecutions?.[0]?.status).toBe("cancelled");
    expect(assistant?.toolExecutions?.[0]?.stages?.[1]?.status).toBe("cancelled");
    expect(fetchJson).toHaveBeenCalledWith("/active-operations/agent%3A" + sessionId + "/cancel", {
      method: "POST",
    });
  });

  it("restores confirmed proposal cards when loading persisted session messages", () => {
    const store = createTestStore();
    const sessionId = store.getState().createDraftSession(null, "play", "open");

    store.getState().loadSessionMessages(sessionId, [
      {
        role: "assistant",
        content: "",
        timestamp: 1,
        toolExecutions: [
          {
            id: "proposal-1",
            tool: "propose_action",
            label: "确认动作",
            status: "completed",
            startedAt: 1,
            details: {
              kind: "proposed_action",
              action: "play_start",
              targetSessionKind: "play",
              instruction: "启动旧影院",
            },
          },
        ],
      },
      {
        role: "assistant",
        content: "",
        timestamp: 2,
        toolExecutions: [
          {
            id: "play-1",
            tool: "play_start",
            label: "启动互动世界",
            status: "completed",
            startedAt: 2,
            details: { kind: "play_world_started" },
          },
        ],
      },
    ]);

    expect(store.getState().resolvedProposals).toEqual({ "proposal-1": "confirmed" });
  });
});
