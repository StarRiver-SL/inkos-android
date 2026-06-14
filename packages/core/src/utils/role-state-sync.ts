import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ChapterSummaryRow, CurrentStateFact } from "../models/runtime-state.js";
import type { RuntimeStateSnapshot } from "../state/state-reducer.js";

const ROLE_STATE_START = "<!-- INKOS:ROLE_RUNTIME_STATE_START -->";
const ROLE_STATE_END = "<!-- INKOS:ROLE_RUNTIME_STATE_END -->";
const ROLE_DIRS = [
  { dir: "主要角色", tier: "major" },
  { dir: "次要角色", tier: "minor" },
  { dir: "major", tier: "major" },
  { dir: "minor", tier: "minor" },
] as const;

interface RoleFile {
  readonly path: string;
  readonly name: string;
  readonly tier: "major" | "minor";
  readonly content: string;
}

export interface RoleRuntimeStateUpdate {
  readonly chapter: number;
  readonly lines: ReadonlyArray<string>;
}

export async function syncRoleRuntimeStates(params: {
  readonly bookDir: string;
  readonly snapshot: RuntimeStateSnapshot;
  readonly language?: "zh" | "en";
}): Promise<ReadonlyArray<string>> {
  const roleFiles = await readRoleFiles(params.bookDir);
  if (roleFiles.length === 0) return [];

  const latestSummary = latestChapterSummary(params.snapshot.chapterSummaries.rows, params.snapshot.currentState.chapter);
  const written: string[] = [];

  await Promise.all(roleFiles.map(async (role) => {
    const update = buildRoleRuntimeStateUpdate({
      roleName: role.name,
      tier: role.tier,
      facts: params.snapshot.currentState.facts,
      summary: latestSummary,
      chapter: params.snapshot.currentState.chapter,
      language: params.language ?? params.snapshot.manifest.language,
    });
    if (!update) return;
    const next = upsertRoleRuntimeStateBlock(role.content, update, params.language ?? params.snapshot.manifest.language);
    if (next === role.content) return;
    await writeFile(role.path, next, "utf-8");
    written.push(role.path);
  }));

  return written.sort();
}

export function buildRoleRuntimeStateUpdate(params: {
  readonly roleName: string;
  readonly tier: "major" | "minor";
  readonly facts: ReadonlyArray<CurrentStateFact>;
  readonly summary: ChapterSummaryRow | null;
  readonly chapter: number;
  readonly language: "zh" | "en";
}): RoleRuntimeStateUpdate | null {
  const roleName = params.roleName.trim();
  if (!roleName) return null;

  const lines = new Set<string>();
  const mentionedInSummary = summaryMentionsRole(params.summary, roleName);
  for (const fact of params.facts) {
    if (fact.validUntilChapter !== null) continue;
    if (fact.sourceChapter !== params.chapter && fact.validFromChapter !== params.chapter) continue;
    const subject = fact.subject.toLowerCase();
    const object = fact.object.trim();
    if (!object) continue;
    if (mentionsRole(fact.subject, roleName) || mentionsRole(object, roleName)) {
      lines.add(formatFactLine(fact));
      continue;
    }
    if (params.tier === "major" && subject === "protagonist" && mentionedInSummary) {
      lines.add(formatFactLine(fact));
    }
  }

  if (params.summary && mentionedInSummary) {
    addSummaryLine(lines, params.summary.stateChanges);
    addSummaryLine(lines, params.summary.events);
    addSummaryLine(lines, params.summary.hookActivity);
  }

  if (lines.size === 0) return null;
  return {
    chapter: params.chapter,
    lines: [...lines].slice(0, 6),
  };
}

export function upsertRoleRuntimeStateBlock(
  content: string,
  update: RoleRuntimeStateUpdate,
  language: "zh" | "en" = "zh",
): string {
  const heading = language === "en" ? "## Latest State" : "## 最新状态";
  const chapterLabel = language === "en"
    ? `Updated through chapter ${update.chapter}.`
    : `更新至第 ${update.chapter} 章。`;
  const block = [
    ROLE_STATE_START,
    heading,
    "",
    `- ${chapterLabel}`,
    ...update.lines.map((line) => `- ${line}`),
    ROLE_STATE_END,
  ].join("\n");

  const markerPattern = new RegExp(
    `${escapeRegExp(ROLE_STATE_START)}[\\s\\S]*?${escapeRegExp(ROLE_STATE_END)}`,
    "m",
  );
  if (markerPattern.test(content)) {
    return content.replace(markerPattern, block);
  }

  const initialSection = /^##\s*(?:当前现状|初始状态|Current[_\s]?State|Initial[_\s]?State)[^\n]*\n[\s\S]*?(?=^##\s|\s*$)/im;
  const match = content.match(initialSection);
  if (match && match.index !== undefined) {
    const insertAt = match.index + match[0].trimEnd().length;
    return `${content.slice(0, insertAt)}\n\n${block}${content.slice(insertAt)}`;
  }

  return `${content.trimEnd()}\n\n${block}\n`;
}

async function readRoleFiles(bookDir: string): Promise<ReadonlyArray<RoleFile>> {
  const rolesRoot = join(bookDir, "story", "roles");
  const files: RoleFile[] = [];
  await Promise.all(ROLE_DIRS.map(async ({ dir, tier }) => {
    const fullDir = join(rolesRoot, dir);
    let entries: string[];
    try {
      entries = await readdir(fullDir);
    } catch {
      return;
    }
    await Promise.all(entries
      .filter((entry) => entry.endsWith(".md"))
      .map(async (entry) => {
        const path = join(fullDir, entry);
        const content = await readFile(path, "utf-8").catch(() => "");
        if (!content.trim()) return;
        files.push({ path, tier, name: entry.replace(/\.md$/, ""), content });
      }));
  }));
  return files;
}

function latestChapterSummary(
  rows: ReadonlyArray<ChapterSummaryRow>,
  chapter: number,
): ChapterSummaryRow | null {
  return [...rows]
    .filter((row) => row.chapter <= chapter)
    .sort((left, right) => right.chapter - left.chapter)[0] ?? null;
}

function summaryMentionsRole(summary: ChapterSummaryRow | null, roleName: string): boolean {
  if (!summary) return false;
  return [summary.characters, summary.events, summary.stateChanges, summary.hookActivity]
    .some((value) => mentionsRole(value, roleName));
}

function mentionsRole(value: string, roleName: string): boolean {
  return normalizeText(value).includes(normalizeText(roleName));
}

function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "");
}

function formatFactLine(fact: CurrentStateFact): string {
  return `${fact.predicate}: ${fact.object}`.replace(/\s+/g, " ").trim();
}

function addSummaryLine(lines: Set<string>, value: string): void {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized) lines.add(normalized);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
