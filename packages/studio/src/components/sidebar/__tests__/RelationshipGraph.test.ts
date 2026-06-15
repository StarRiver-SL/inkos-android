import { describe, expect, it } from "vitest";
import {
  buildRelationshipGraphModel,
  buildTruthRelationshipGraph,
  mergeRelationshipGraphs,
  relationshipVisual,
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
    expect(Math.max(...model.nodes.map((node) => node.x)) - Math.min(...model.nodes.map((node) => node.x))).toBeGreaterThan(250);
    expect(Math.max(...model.nodes.map((node) => node.y)) - Math.min(...model.nodes.map((node) => node.y))).toBeGreaterThan(180);
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

  it("can keep disconnected book actors visible while chapter settlement is pending", () => {
    const model = buildRelationshipGraphModel(graph, { includeDisconnected: true });

    expect(model.nodes.map((node) => node.id)).toContain("orphan");
    expect(model.typeCounts.find((item) => item.type === "actor")?.count).toBe(3);
  });

  it("assigns distinct visual colors to semantic relationship types", () => {
    expect(relationshipVisual("敌对").key).toBe("hostile");
    expect(relationshipVisual("母女").key).toBe("family");
    expect(relationshipVisual("盟友")).toMatchObject({ key: "alliance", color: "#22c55e" });
    expect(relationshipVisual("上下级")).toMatchObject({ key: "authority", color: "#eab308" });
    expect(relationshipVisual("普通认识").key).toBe("neutral");
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

  it("builds book relationships from colon-delimited current_focus lines", () => {
    const truthGraph = buildTruthRelationshipGraph([
      { name: "roles/次要角色/陈默.md", content: "# 陈默" },
      { name: "roles/次要角色/赵总.md", content: "# 赵总" },
      { name: "roles/次要角色/林母.md", content: "# 林母" },
      { name: "roles/主要角色/苏青.md", content: "# 苏青" },
      { name: "roles/主要角色/林予安.md", content: "# 林予安" },
      {
        name: "current_focus.md",
        content: [
          "核心关系：陈默、赵总、林母、苏青、林予安",
          "本章关系变化：赵总试图压制苏青，林予安开始保护苏青。",
        ].join("\n"),
      },
    ]);

    const model = buildRelationshipGraphModel(truthGraph, { includeDisconnected: true });

    expect(model.nodes).toHaveLength(5);
    expect(model.edges.length).toBeGreaterThan(0);
    expect(truthGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromId: "book-actor:陈默",
        toId: "book-actor:赵总",
        type: "核心关系",
      }),
      expect.objectContaining({
        fromId: "book-actor:苏青",
        toId: "book-actor:林予安",
        type: "核心关系",
      }),
    ]));
  });

  it("extracts static relationship tables from role cards", () => {
    const truthGraph = buildTruthRelationshipGraph([
      {
        name: "roles/主要角色/林玄.md",
        content: [
          "# 林玄",
          "## 人际关系",
          "| 角色 | 关系 | 态度 |",
          "|------|------|------|",
          "| 林雨 | 妹妹 | 绝对保护，情感软肋 |",
          "| 苏晚晴 | 盟友/观察者 | 信任但保持警惕 |",
        ].join("\n"),
      },
      { name: "roles/次要角色/林雨.md", content: "# 林雨" },
      { name: "roles/主要角色/苏晚晴.md", content: "# 苏晚晴" },
    ]);

    expect(truthGraph.edges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        fromId: "book-actor:林玄",
        toId: "book-actor:林雨",
        type: "妹妹",
      }),
      expect.objectContaining({
        fromId: "book-actor:林玄",
        toId: "book-actor:苏晚晴",
        type: "盟友",
      }),
    ]));
    const model = buildRelationshipGraphModel(truthGraph, { includeDisconnected: true });
    expect(model.edges.every((edge) => typeof edge.summary === "string" && edge.summary.length > 0)).toBe(true);
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
