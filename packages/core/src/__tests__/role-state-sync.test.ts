import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mkdtemp } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  buildRoleRuntimeStateUpdate,
  syncRoleRuntimeStates,
  upsertRoleRuntimeStateBlock,
} from "../utils/role-state-sync.js";
import type { RuntimeStateSnapshot } from "../state/state-reducer.js";

describe("role-state-sync", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "inkos-role-state-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("builds an update only for roles involved in the current chapter", () => {
    const update = buildRoleRuntimeStateUpdate({
      roleName: "林月",
      tier: "major",
      chapter: 7,
      language: "zh",
      facts: [
        {
          subject: "林月",
          predicate: "状态变化",
          object: "受伤后仍守住旧账册",
          validFromChapter: 7,
          validUntilChapter: null,
          sourceChapter: 7,
        },
        {
          subject: "沈砚",
          predicate: "位置",
          object: "离开码头",
          validFromChapter: 7,
          validUntilChapter: null,
          sourceChapter: 7,
        },
      ],
      summary: {
        chapter: 7,
        title: "雨夜旧账",
        events: "林月守住旧账册。",
        characters: "林月、沈砚",
        stateChanges: "林月开始怀疑沈砚隐瞒账册来源。",
        hookActivity: "",
        mood: "",
        chapterType: "",
      },
    });

    expect(update).toMatchObject({
      chapter: 7,
      lines: expect.arrayContaining([
        "状态变化: 受伤后仍守住旧账册",
        "林月开始怀疑沈砚隐瞒账册来源。",
      ]),
    });

    const unrelated = buildRoleRuntimeStateUpdate({
      roleName: "陈叔",
      tier: "minor",
      chapter: 7,
      language: "zh",
      facts: [],
      summary: {
        chapter: 7,
        title: "雨夜旧账",
        events: "林月守住旧账册。",
        characters: "林月、沈砚",
        stateChanges: "",
        hookActivity: "",
        mood: "",
        chapterType: "",
      },
    });
    expect(unrelated).toBeNull();
  });

  it("replaces the managed block instead of duplicating it", () => {
    const first = upsertRoleRuntimeStateBlock(
      ["# 林月", "", "## 初始状态", "第 0 章在码头。"].join("\n"),
      { chapter: 3, lines: ["状态变化: 暂时相信沈砚"] },
      "zh",
    );
    const second = upsertRoleRuntimeStateBlock(
      first,
      { chapter: 4, lines: ["关系变化: 开始怀疑沈砚"] },
      "zh",
    );

    expect(second.match(/INKOS:ROLE_RUNTIME_STATE_START/g)).toHaveLength(1);
    expect(second).toContain("更新至第 4 章。");
    expect(second).toContain("关系变化: 开始怀疑沈砚");
    expect(second).not.toContain("暂时相信沈砚");
  });

  it("writes latest-state blocks only to mentioned role files", async () => {
    const rolesDir = join(root, "story", "roles", "主要角色");
    await mkdir(rolesDir, { recursive: true });
    const linPath = join(rolesDir, "林月.md");
    const chenPath = join(rolesDir, "陈叔.md");
    await Promise.all([
      writeFile(linPath, ["# 林月", "", "## 初始状态", "第 0 章在码头。"].join("\n"), "utf-8"),
      writeFile(chenPath, ["# 陈叔", "", "## 初始状态", "第 0 章在茶馆。"].join("\n"), "utf-8"),
    ]);

    const snapshot = {
      manifest: {
        schemaVersion: 2,
        language: "zh",
        lastAppliedChapter: 8,
        projectionVersion: 1,
        migrationWarnings: [],
      },
      hooks: { hooks: [] },
      currentState: {
        chapter: 8,
        facts: [{
          subject: "林月",
          predicate: "状态变化",
          object: "带伤转移旧账册",
          validFromChapter: 8,
          validUntilChapter: null,
          sourceChapter: 8,
        }],
      },
      chapterSummaries: {
        rows: [{
          chapter: 8,
          title: "暗巷",
          events: "林月带走旧账册。",
          characters: "林月",
          stateChanges: "林月和沈砚的信任出现裂缝。",
          hookActivity: "",
          mood: "",
          chapterType: "",
        }],
      },
    } satisfies RuntimeStateSnapshot;

    const written = await syncRoleRuntimeStates({ bookDir: root, snapshot, language: "zh" });

    expect(written).toEqual([linPath]);
    await expect(readFile(linPath, "utf-8")).resolves.toContain("更新至第 8 章。");
    await expect(readFile(linPath, "utf-8")).resolves.toContain("带伤转移旧账册");
    await expect(readFile(chenPath, "utf-8")).resolves.not.toContain("INKOS:ROLE_RUNTIME_STATE_START");
  });
});
