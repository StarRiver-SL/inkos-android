import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readCharacterContext,
  readCurrentStateWithFallback,
  readStoryFrame,
  readVolumeMap,
} from "../utils/outline-paths.js";
import {
  applyTruthContextBudget,
  contextCacheKey,
  fileCacheKey,
  isTruthContextBudgeted,
  type TruthContextReadOptions,
} from "./truth-context-cache.js";

export const REVIEW_CONTEXT_MISSING = "(文件不存在)";

export interface RevisionTruthContext {
  readonly currentState: string;
  readonly ledger: string;
  readonly hooks: string;
  readonly styleGuideRaw: string;
  readonly volumeOutline: string;
  readonly storyBible: string;
  readonly characterMatrix: string;
  readonly chapterSummaries: string;
  readonly parentCanon: string;
  readonly fanficCanon: string;
}

export interface AuditTruthContext {
  readonly currentState: string;
  readonly ledger: string;
  readonly hooks: string;
  readonly styleGuideRaw: string;
  readonly subplotBoard: string;
  readonly emotionalArcs: string;
  readonly characterMatrix: string;
  readonly chapterSummaries: string;
  readonly parentCanon: string;
  readonly fanficCanon: string;
  readonly volumeOutline: string;
}

const REVISION_CONTEXT_WEIGHTS = {
  currentState: 3,
  ledger: 2,
  hooks: 3,
  styleGuideRaw: 1,
  volumeOutline: 2,
  storyBible: 2,
  characterMatrix: 2,
  chapterSummaries: 2,
  parentCanon: 2,
  fanficCanon: 2,
} as const;

const AUDIT_CONTEXT_WEIGHTS = {
  currentState: 3,
  ledger: 2,
  hooks: 3,
  styleGuideRaw: 1,
  subplotBoard: 2,
  emotionalArcs: 2,
  characterMatrix: 2,
  chapterSummaries: 2,
  parentCanon: 2,
  fanficCanon: 2,
  volumeOutline: 2,
} as const;

function readFileSafe(
  path: string,
  fallback = REVIEW_CONTEXT_MISSING,
  options?: TruthContextReadOptions,
): Promise<string> {
  const load = async (): Promise<string> => {
    try {
      return await readFile(path, "utf-8");
    } catch {
      return fallback;
    }
  };
  if (isTruthContextBudgeted(options)) return load();
  return options?.cache?.getOrLoad(fileCacheKey(path, fallback), load) ?? load();
}

export async function readRevisionTruthContext(
  bookDir: string,
  fallback = REVIEW_CONTEXT_MISSING,
  options?: TruthContextReadOptions,
): Promise<RevisionTruthContext> {
  const key = contextCacheKey("review:revision", bookDir, fallback, options);
  return options?.cache?.getOrLoad(key, () => loadRevisionTruthContext(bookDir, fallback, options))
    ?? loadRevisionTruthContext(bookDir, fallback, options);
}

async function loadRevisionTruthContext(
  bookDir: string,
  fallback: string,
  options?: TruthContextReadOptions,
): Promise<RevisionTruthContext> {
  const audit = await options?.cache?.peek<AuditTruthContext>(
    contextCacheKey("review:audit", bookDir, fallback, options),
  );
  if (audit) {
    return applyRevisionBudget({
      currentState: audit.currentState,
      ledger: audit.ledger,
      hooks: audit.hooks,
      styleGuideRaw: audit.styleGuideRaw,
      volumeOutline: audit.volumeOutline,
      storyBible: await readStoryFrame(bookDir, fallback),
      characterMatrix: audit.characterMatrix,
      chapterSummaries: audit.chapterSummaries,
      parentCanon: audit.parentCanon,
      fanficCanon: audit.fanficCanon,
    }, options);
  }

  const [
    currentState,
    ledger,
    hooks,
    styleGuideRaw,
    volumeOutline,
    storyBible,
    characterMatrix,
    chapterSummaries,
    parentCanon,
    fanficCanon,
  ] = await Promise.all([
    readCurrentStateWithFallback(bookDir, fallback),
    readFileSafe(join(bookDir, "story/particle_ledger.md"), fallback, options),
    readFileSafe(join(bookDir, "story/pending_hooks.md"), fallback, options),
    readFileSafe(join(bookDir, "story/style_guide.md"), fallback, options),
    readVolumeMap(bookDir, fallback),
    readStoryFrame(bookDir, fallback),
    readCharacterContext(bookDir, fallback),
    readFileSafe(join(bookDir, "story/chapter_summaries.md"), fallback, options),
    readFileSafe(join(bookDir, "story/parent_canon.md"), fallback, options),
    readFileSafe(join(bookDir, "story/fanfic_canon.md"), fallback, options),
  ]);

  return applyRevisionBudget({
    currentState,
    ledger,
    hooks,
    styleGuideRaw,
    volumeOutline,
    storyBible,
    characterMatrix,
    chapterSummaries,
    parentCanon,
    fanficCanon,
  }, options);
}

export async function readAuditTruthContext(
  bookDir: string,
  fallback = REVIEW_CONTEXT_MISSING,
  options?: TruthContextReadOptions,
): Promise<AuditTruthContext> {
  const key = contextCacheKey("review:audit", bookDir, fallback, options);
  return options?.cache?.getOrLoad(key, () => loadAuditTruthContext(bookDir, fallback, options))
    ?? loadAuditTruthContext(bookDir, fallback, options);
}

async function loadAuditTruthContext(
  bookDir: string,
  fallback: string,
  options?: TruthContextReadOptions,
): Promise<AuditTruthContext> {
  const [
    currentState,
    ledger,
    hooks,
    styleGuideRaw,
    subplotBoard,
    emotionalArcs,
    characterMatrix,
    chapterSummaries,
    parentCanon,
    fanficCanon,
    volumeOutline,
  ] = await Promise.all([
    readCurrentStateWithFallback(bookDir, fallback),
    readFileSafe(join(bookDir, "story/particle_ledger.md"), fallback, options),
    readFileSafe(join(bookDir, "story/pending_hooks.md"), fallback, options),
    readFileSafe(join(bookDir, "story/style_guide.md"), fallback, options),
    readFileSafe(join(bookDir, "story/subplot_board.md"), fallback, options),
    readFileSafe(join(bookDir, "story/emotional_arcs.md"), fallback, options),
    readCharacterContext(bookDir, fallback),
    readFileSafe(join(bookDir, "story/chapter_summaries.md"), fallback, options),
    readFileSafe(join(bookDir, "story/parent_canon.md"), fallback, options),
    readFileSafe(join(bookDir, "story/fanfic_canon.md"), fallback, options),
    readVolumeMap(bookDir, fallback),
  ]);

  const context = {
    currentState,
    ledger,
    hooks,
    styleGuideRaw,
    subplotBoard,
    emotionalArcs,
    characterMatrix,
    chapterSummaries,
    parentCanon,
    fanficCanon,
    volumeOutline,
  };
  const budgeted = applyTruthContextBudget(context, options ?? {}, {
    weights: AUDIT_CONTEXT_WEIGHTS,
  });
  options?.cache?.recordBudget(budgeted);
  return budgeted.context;
}

function applyRevisionBudget(
  context: RevisionTruthContext,
  options?: TruthContextReadOptions,
): RevisionTruthContext {
  const budgeted = applyTruthContextBudget(context, options ?? {}, {
    weights: REVISION_CONTEXT_WEIGHTS,
  });
  options?.cache?.recordBudget(budgeted);
  return budgeted.context;
}
