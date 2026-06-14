import { describe, expect, it } from "vitest";
import { parseRoleRuntimeSummary, selectLatestChapterSettlementRoles } from "../CharacterSection";

describe("parseRoleRuntimeSummary", () => {
  it("extracts chapter, state changes, and relationship changes from the managed role block", () => {
    const summary = parseRoleRuntimeSummary([
      "## 初始状态",
      "第 0 章在码头。",
      "",
      "<!-- INKOS:ROLE_RUNTIME_STATE_START -->",
      "## 最新状态",
      "",
      "- 更新至第 7 章。",
      "- 主角状态: 林月受伤后仍守住旧账册",
      "- 关系变化: 林月开始怀疑沈砚隐瞒了账册来源",
      "<!-- INKOS:ROLE_RUNTIME_STATE_END -->",
    ].join("\n"));

    expect(summary).toEqual({
      chapter: 7,
      stateLines: ["主角状态: 林月受伤后仍守住旧账册"],
      relationLines: ["关系变化: 林月开始怀疑沈砚隐瞒了账册来源"],
    });
  });

  it("returns null when no managed block exists", () => {
    expect(parseRoleRuntimeSummary("## 初始状态\n\n未结算。")).toBeNull();
  });

  it("keeps the chapter settlement scoped to the latest updated chapter", () => {
    const roles = [
      {
        ref: { name: "林月", path: "roles/major/林月.md", tier: "major" },
        runtime: { chapter: 8, stateLines: ["带伤转移旧账册"], relationLines: [] },
      },
      {
        ref: { name: "陈叔", path: "roles/minor/陈叔.md", tier: "minor" },
        runtime: { chapter: 7, stateLines: ["守在茶馆"], relationLines: [] },
      },
    ] as const;

    expect(selectLatestChapterSettlementRoles(roles).map((role) => role.ref.name)).toEqual(["林月"]);
  });
});
