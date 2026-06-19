import { describe, expect, it } from "vitest";
import { parseSettlerDeltaOutput } from "../agents/settler-delta-parser.js";

describe("parseSettlerDeltaOutput", () => {
  it("parses a valid runtime-state delta block", () => {
    const result = parseSettlerDeltaOutput([
      "=== POST_SETTLEMENT ===",
      "| 伏笔变动 | mentor-oath 推进 | 同步更新 |",
      "",
      "=== RUNTIME_STATE_DELTA ===",
      "```json",
      JSON.stringify({
        chapter: 12,
        currentStatePatch: {
          currentGoal: "追到河埠旧账的尽头",
          currentConflict: "商会噪音仍在干扰师债主线",
        },
        hookOps: {
          upsert: [
            {
              hookId: "mentor-oath",
              startChapter: 8,
              type: "relationship",
              status: "progressing",
              lastAdvancedChapter: 12,
              expectedPayoff: "揭开师债真相",
              notes: "河埠旧账把师债再往前推了一格",
            },
          ],
          resolve: [],
          defer: [],
        },
        chapterSummary: {
          chapter: 12,
          title: "河埠对账",
          characters: "林月",
          events: "林月核对河埠旧账",
          stateChanges: "师债线索进一步收束",
          hookActivity: "mentor-oath advanced",
          mood: "紧绷",
          chapterType: "主线推进",
        },
        notes: ["保留商会噪音，但不盖过主线"],
      }, null, 2),
      "```",
    ].join("\n"));

    expect(result.postSettlement).toContain("mentor-oath");
    expect(result.runtimeStateDelta.chapter).toBe(12);
    expect(result.runtimeStateDelta.hookOps.upsert[0]?.hookId).toBe("mentor-oath");
    expect(result.runtimeStateDelta.chapterSummary?.title).toBe("河埠对账");
  });

  it("rejects invalid runtime-state delta payloads", () => {
    expect(() =>
      parseSettlerDeltaOutput([
        "=== RUNTIME_STATE_DELTA ===",
        "```json",
        JSON.stringify({
          chapter: 12,
          hookOps: {
            upsert: [
              {
                hookId: "mentor-oath",
                startChapter: 8,
                type: "relationship",
                status: "open",
                lastAdvancedChapter: "chapter twelve",
              },
            ],
            resolve: [],
            defer: [],
          },
        }),
        "```",
      ].join("\n")),
    ).toThrow(/runtime state delta/i);
  });

  it("parses hook resolve and defer operations", () => {
    const result = parseSettlerDeltaOutput([
      "=== RUNTIME_STATE_DELTA ===",
      "```json",
      JSON.stringify({
        chapter: 20,
        hookOps: {
          upsert: [],
          mention: ["mentor-oath"],
          resolve: ["old-seal"],
          defer: ["guild-route"],
        },
        notes: [],
      }),
      "```",
    ].join("\n"));

    expect(result.runtimeStateDelta.hookOps.mention).toEqual(["mentor-oath"]);
    expect(result.runtimeStateDelta.hookOps.resolve).toEqual(["old-seal"]);
    expect(result.runtimeStateDelta.hookOps.defer).toEqual(["guild-route"]);
  });

  it("parses new hook candidates separately from existing hook ops", () => {
    const result = parseSettlerDeltaOutput([
      "=== RUNTIME_STATE_DELTA ===",
      "```json",
      JSON.stringify({
        chapter: 21,
        hookOps: {
          upsert: [],
          mention: ["mentor-oath"],
          resolve: [],
          defer: [],
        },
        newHookCandidates: [
          {
            type: "source-risk",
            expectedPayoff: "Reveal what the anonymous source already knew about the route and address",
            notes: "This chapter opens a fresh unresolved question about source knowledge.",
          },
        ],
        notes: [],
      }),
      "```",
    ].join("\n"));

    expect(result.runtimeStateDelta.hookOps.upsert).toEqual([]);
    expect(result.runtimeStateDelta.newHookCandidates).toEqual([
      expect.objectContaining({
        type: "source-risk",
      }),
    ]);
  });

  it("handles truncated JSON output missing closing fence", () => {
    // Simulate maxTokens truncation: opening ```json is present but closing ``` is cut off
    const truncatedContent = [
      "=== POST_SETTLEMENT ===",
      "本章推进了剧情。",
      "",
      "=== RUNTIME_STATE_DELTA ===",
      "```json",
      JSON.stringify({
        chapter: 44,
        currentStatePatch: {
          currentLocation: "老城区钟楼内部",
          currentGoal: "调查苏晚死亡真相",
        },
        hookOps: {
          upsert: [
            {
              hookId: "shadow-trace",
              startChapter: 43,
              type: "mystery",
              status: "progressing",
              lastAdvancedChapter: 44,
              expectedPayoff: "揭开Shadow的追踪技术",
              payoffTiming: "near-term",
              notes: "钟楼内发现新线索",
            },
          ],
          mention: [],
          resolve: [],
          defer: [],
        },
        chapterSummary: {
          chapter: 44,
          title: "钟楼探秘",
          characters: "林予安,苏青",
          events: "进入钟楼调查",
          stateChanges: "确立了战术同盟",
          hookActivity: "shadow-trace advanced",
          mood: "紧张",
          chapterType: "主线推进",
        },
        notes: ["本章完成关键转折"],
      }),
      // Missing closing ``` — truncation happens here
    ].join("\n");

    const result = parseSettlerDeltaOutput(truncatedContent);
    expect(result.postSettlement).toBe("本章推进了剧情。");
    expect(result.runtimeStateDelta.chapter).toBe(44);
    expect(result.runtimeStateDelta.currentStatePatch?.currentLocation).toBe("老城区钟楼内部");
    expect(result.runtimeStateDelta.hookOps.upsert[0]?.hookId).toBe("shadow-trace");
    expect(result.runtimeStateDelta.chapterSummary?.title).toBe("钟楼探秘");
  });

  it("handles raw JSON without any code fence markers", () => {
    const rawJson = JSON.stringify({
      chapter: 50,
      currentStatePatch: {
        currentGoal: "完成最终决战",
      },
      hookOps: {
        upsert: [],
        mention: ["main-plot"],
        resolve: [],
        defer: [],
      },
      notes: [],
    });

    const result = parseSettlerDeltaOutput([
      "=== POST_SETTLEMENT ===",
      "最终章完成。",
      "",
      "=== RUNTIME_STATE_DELTA ===",
      rawJson,
    ].join("\n"));

    expect(result.postSettlement).toBe("最终章完成。");
    expect(result.runtimeStateDelta.chapter).toBe(50);
    expect(result.runtimeStateDelta.hookOps.mention).toEqual(["main-plot"]);
  });
});
