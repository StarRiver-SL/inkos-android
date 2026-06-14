import { describe, expect, it } from "vitest";
import {
  buildRelationshipGraphModel,
  buildTruthRelationshipGraph,
  mergeRelationshipGraphs,
} from "../RelationshipGraph";

describe("buildRelationshipGraphModel", () => {
  const graph = {
    entities: [
      { id: "actor_player", type: "actor", label: "Player" },
      { id: "actor_guard", type: "actor", label: "Gate Guard", status: "watching" },
      { id: "loc_gate", type: "location", label: "East Gate" },
      { id: "clue_badge", type: "clue", label: "Copper Badge" },
      { id: "item_key", type: "item", label: "Old Key" },
      { id: "orphan", type: "actor", label: "Unconnected Actor" },
    ],
    edges: [
      { id: "rel-guard-player", fromId: "actor_guard", type: "suspects", toId: "actor_player", value: { role: "relation" } },
      { id: "rel-guard-gate", fromId: "actor_guard", type: "guards", toId: "loc_gate", value: { role: "relation" } },
      { id: "edge-badge", fromId: "clue_badge", type: "supports", toId: "actor_guard" },
      { id: "edge-hold-key", fromId: "actor_player", type: "holds", toId: "item_key", value: { role: "holding" } },
      { id: "expired", fromId: "actor_player", type: "knows", toId: "loc_gate", validUntilEventId: "evt-2" },
    ],
  };

  it("builds a graph from current edges and hides disconnected entities", () => {
    const model = buildRelationshipGraphModel(graph);

    expect(model.nodes.map((node) => node.id)).not.toContain("orphan");
    expect(model.edges.map((edge) => edge.id)).not.toContain("expired");
    expect(model.edges).toHaveLength(4);
    expect(model.nodes.find((node) => node.id === "actor_guard")?.degree).toBe(3);
  });

  it("filters by entity type and query", () => {
    const byType = buildRelationshipGraphModel(graph, { type: "actor" });
    expect(byType.nodes.map((node) => node.id).sort()).toEqual(["actor_guard", "actor_player"]);

    const byQuery = buildRelationshipGraphModel(graph, { query: "badge" });
    expect(byQuery.nodes.map((node) => node.id)).toEqual(["clue_badge"]);
    expect(byQuery.edges).toEqual([]);
    expect(byQuery.hiddenEdges).toBeGreaterThan(0);
  });

  it("can limit the model to semantic relationship edges", () => {
    const model = buildRelationshipGraphModel(graph, { relationsOnly: true });

    expect(model.edges.map((edge) => edge.id).sort()).toEqual([
      "edge-badge",
      "rel-guard-gate",
      "rel-guard-player",
    ]);
    expect(model.nodes.map((node) => node.id)).not.toContain("item_key");
  });

  it("builds book relationships from current_focus relationship groups", () => {
    const truthGraph = buildTruthRelationshipGraph([
      {
        name: "current_focus.md",
        content: [
          "核心关系（林予安-苏青-林母三角）",
          "职场关系（苏青-赵总-林经理-老板）",
          "家庭关系（苏青父母、前男友）",
        ].join("\n"),
      },
    ]);

    expect(truthGraph.entities.map((entity) => entity.label)).toEqual(expect.arrayContaining([
      "林予安",
      "苏青",
      "林母",
      "赵总",
      "林经理",
      "老板",
      "苏青父母",
      "前男友",
    ]));
    expect(truthGraph.edges).toHaveLength(6);
    expect(truthGraph.edges.map((edge) => edge.type)).toContain("核心关系");
  });

  it("extracts chapter-settled relationship changes from role cards", () => {
    const truthGraph = buildTruthRelationshipGraph([
      {
        name: "roles/主要角色/苏青.md",
        content: [
          "# 苏青",
          "<!-- INKOS:ROLE_RUNTIME_STATE_START -->",
          "## 最新状态",
          "- 更新至第 4 章。",
          "- 关系变化：苏青开始怀疑林经理隐瞒合同来源。",
          "<!-- INKOS:ROLE_RUNTIME_STATE_END -->",
        ].join("\n"),
      },
      {
        name: "roles/次要角色/林经理.md",
        content: "# 林经理",
      },
    ]);

    expect(truthGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromId: "book-actor:苏青",
        toId: "book-actor:林经理",
        type: "怀疑",
      }),
    ]));
  });

  it("merges book actors into matching interactive-world actors", () => {
    const merged = mergeRelationshipGraphs(
      {
        entities: [{ id: "play-suqing", type: "actor", label: "苏青" }],
        edges: [],
      },
      {
        entities: [
          { id: "book-actor:苏青", type: "actor", label: "苏青" },
          { id: "book-actor:林经理", type: "actor", label: "林经理" },
        ],
        edges: [{ id: "book-edge", fromId: "book-actor:苏青", type: "怀疑", toId: "book-actor:林经理" }],
      },
    );

    expect(merged.entities.filter((entity) => entity.label === "苏青")).toHaveLength(1);
    expect(merged.edges[0]).toMatchObject({ fromId: "play-suqing", toId: "book-actor:林经理" });
  });
});
