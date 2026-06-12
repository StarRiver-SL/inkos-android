import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";

export const TRUTH_FLAT_FILES = [
  "author_intent.md", "current_focus.md",
  "story_bible.md", "book_rules.md", "volume_outline.md", "current_state.md",
  "particle_ledger.md", "pending_hooks.md", "chapter_summaries.md",
  "subplot_board.md", "emotional_arcs.md", "character_matrix.md",
  "style_guide.md", "parent_canon.md", "fanfic_canon.md",
];

// Authoritative Phase 5 paths — prose outline + role sheets live under
// dedicated subdirectories of story/. The full path (relative to story/) is
// matched literally here. `节奏原则.md` / `rhythm_principles.md` is optional
// after Phase 5 consolidation (rhythm lives in volume_map's closing paragraph);
// the entries stay whitelisted for legacy books and manual overrides.
export const TRUTH_OUTLINE_FILES = [
  "outline/story_frame.md",
  "outline/volume_map.md",
  "outline/节奏原则.md",
  "outline/rhythm_principles.md",
];

// Pointer shims that the runtime no longer treats as authoritative. The
// GET handler tags them with `legacy: true` so the UI can surface that the
// edits won't land where the user expects.
export const LEGACY_SHIM_FILES = new Set(["story_bible.md", "book_rules.md"]);
export const RUNTIME_DIAGNOSTIC_FILE_RE =
  /^runtime\/chapter-\d{4}\.(?:intent\.md|plan\.md|context\.json|rule-stack\.yaml|trace\.json)$/;
export const RUNTIME_STATE_FILE_RE =
  /^state\/(?:manifest|current_state|hooks|chapter_summaries)\.json$/;

/**
 * Validate a requested truth-file path:
 *   1. Must be one of the declared flat files, an outline/* allow-listed
 *      entry, a runtime chapter trace file, a structured runtime state file,
 *      or a role markdown file under 主要角色/ | 次要角色/.
 *   2. Must resolve to a path inside bookDir/story/ (no `..`, no absolute
 *      paths, no traversal via the tier-name segment).
 */
export function resolveTruthFilePath(bookDir: string, file: string): string | null {
  // Reject absolute paths, traversal, null bytes outright.
  if (!file || file.includes("\0") || isAbsolute(file) || file.includes("..")) {
    return null;
  }

  // Phase hotfix 3: accept both Chinese and English locale role dirs so
  // English-layout books (roles/major, roles/minor) are reachable through
  // Studio. The runtime reader (utils/outline-paths.ts:75) already scans
  // both — Studio used to drop English books to read-only.
  const allowed =
    TRUTH_FLAT_FILES.includes(file)
    || TRUTH_OUTLINE_FILES.includes(file)
    || RUNTIME_DIAGNOSTIC_FILE_RE.test(file)
    || RUNTIME_STATE_FILE_RE.test(file)
    || /^roles\/(主要角色|次要角色|major|minor)\/[^/]+\.md$/.test(file);

  if (!allowed) return null;

  const storyDir = resolve(bookDir, "story");
  const resolved = resolve(storyDir, file);
  const relativePath = relative(storyDir, resolved);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return null;
  }
  return resolved;
}

export function resolveSnapshotTruthFilePath(bookDir: string, chapter: number, file: string): string | null {
  if (!Number.isInteger(chapter) || chapter < 0) return null;
  if (!resolveTruthFilePath(bookDir, file)) return null;

  const snapshotDir = resolve(bookDir, "story", "snapshots", String(chapter));
  const resolved = resolve(snapshotDir, file);
  const relativePath = relative(snapshotDir, resolved);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) {
    return null;
  }
  return resolved;
}

export async function listTruthFileHistory(
  bookDir: string,
  file: string,
): Promise<ReadonlyArray<{ chapter: number; size: number; preview: string }>> {
  if (!resolveTruthFilePath(bookDir, file)) return [];
  const snapshotsDir = join(bookDir, "story", "snapshots");
  try {
    const entries = await readdir(snapshotsDir, { withFileTypes: true });
    const versions = await Promise.all(entries
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map(async (entry) => {
        const chapter = Number(entry.name);
        const snapshotPath = resolveSnapshotTruthFilePath(bookDir, chapter, file);
        if (!snapshotPath) return null;
        try {
          const content = await readFile(snapshotPath, "utf-8");
          return {
            chapter,
            size: content.length,
            preview: content.slice(0, 200),
          };
        } catch {
          return null;
        }
      }));
    return versions
      .filter((version): version is { chapter: number; size: number; preview: string } => version !== null)
      .sort((a, b) => b.chapter - a.chapter);
  } catch {
    return [];
  }
}

export async function readTruthFileHistory(bookDir: string, file: string, chapter: number): Promise<{
  readonly file: string;
  readonly chapter: number;
  readonly content: string | null;
  readonly frontmatter?: unknown;
  readonly body?: string;
}> {
  const snapshotPath = resolveSnapshotTruthFilePath(bookDir, chapter, file);
  if (!snapshotPath) {
    return { file, chapter, content: null };
  }
  try {
    const content = await readFile(snapshotPath, "utf-8");
    const { tryParseBookRulesFrontmatter } = await import("@actalk/inkos-core");
    const parsed = tryParseBookRulesFrontmatter(content);
    const structured = parsed ? { frontmatter: parsed.rules, body: parsed.body } : {};
    return { file, chapter, content, ...structured };
  } catch {
    return { file, chapter, content: null };
  }
}

export type TruthFileBrowserEntry = {
  readonly name: string;
  readonly size: number;
  readonly preview: string;
  readonly legacy?: true;
  readonly readonly?: true;
  readonly readonlyReason?: string;
};

export async function listBookTruthFiles(bookDir: string): Promise<ReadonlyArray<TruthFileBrowserEntry>> {
  const storyDir = join(bookDir, "story");

  async function listDir(subdir: string): Promise<string[]> {
    try {
      const entries = await readdir(join(storyDir, subdir));
      return entries.filter((file) =>
        file.endsWith(".md") || file.endsWith(".json") || file.endsWith(".yaml")
      );
    } catch {
      return [];
    }
  }

  const flatFiles = (await listDir(".")).filter((file) =>
    !file.startsWith("outline") && !file.startsWith("roles")
  );
  const hasLegacyShim = flatFiles.some((file) => LEGACY_SHIM_FILES.has(file));
  const newLayout = hasLegacyShim
    ? await import("@actalk/inkos-core").then(({ isNewLayoutBook }) => isNewLayoutBook(bookDir))
    : false;

  async function describe(relPath: string): Promise<TruthFileBrowserEntry | null> {
    try {
      const content = await readFile(join(storyDir, relPath), "utf-8");
      const base = {
        name: relPath,
        preview: content.slice(0, 200),
        size: content.length,
      };
      if (LEGACY_SHIM_FILES.has(relPath) && newLayout) {
        return { ...base, legacy: true };
      }
      if (RUNTIME_DIAGNOSTIC_FILE_RE.test(relPath)) {
        return { ...base, readonly: true, readonlyReason: "runtime-diagnostic" };
      }
      if (RUNTIME_STATE_FILE_RE.test(relPath)) {
        return { ...base, readonly: true, readonlyReason: "runtime-state" };
      }
      return base;
    } catch {
      return null;
    }
  }

  const outlineFiles = (await listDir("outline")).map((file) => `outline/${file}`);
  const majorRolesZh = (await listDir("roles/主要角色")).map((file) => `roles/主要角色/${file}`);
  const minorRolesZh = (await listDir("roles/次要角色")).map((file) => `roles/次要角色/${file}`);
  const majorRolesEn = (await listDir("roles/major")).map((file) => `roles/major/${file}`);
  const minorRolesEn = (await listDir("roles/minor")).map((file) => `roles/minor/${file}`);
  const runtimeFiles = (await listDir("runtime"))
    .map((file) => `runtime/${file}`)
    .filter((file) => RUNTIME_DIAGNOSTIC_FILE_RE.test(file));
  const stateFiles = (await listDir("state"))
    .map((file) => `state/${file}`)
    .filter((file) => RUNTIME_STATE_FILE_RE.test(file));

  const candidates = [
    ...flatFiles,
    ...outlineFiles,
    ...majorRolesZh,
    ...minorRolesZh,
    ...majorRolesEn,
    ...minorRolesEn,
    ...stateFiles,
    ...runtimeFiles,
  ].filter((file) => resolveTruthFilePath(bookDir, file) !== null);
  const described = await Promise.all(candidates.map(describe));

  return described.filter((entry): entry is TruthFileBrowserEntry => entry !== null);
}
