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

export const WRITER_CONTEXT_MISSING = "(文件尚未创建)";

export interface WriterTruthContext {
  readonly storyBibleRaw: string;
  readonly volumeOutline: string;
  readonly styleGuide: string;
  readonly currentState: string;
  readonly ledger: string;
  readonly hooks: string;
  readonly chapterSummaries: string;
  readonly subplotBoard: string;
  readonly emotionalArcs: string;
  readonly characterMatrix: string;
  readonly styleProfileRaw: string;
  readonly parentCanon: string;
  readonly fanficCanonRaw: string;
}

export interface WriterSettleContext {
  readonly currentState: string;
  readonly ledger: string;
  readonly hooks: string;
  readonly chapterSummaries: string;
  readonly subplotBoard: string;
  readonly emotionalArcs: string;
  readonly characterMatrix: string;
  readonly volumeOutline: string;
}

const WRITER_TRUTH_WEIGHTS = {
  storyBibleRaw: 3,
  volumeOutline: 3,
  styleGuide: 1,
  currentState: 4,
  ledger: 2,
  hooks: 4,
  chapterSummaries: 3,
  subplotBoard: 2,
  emotionalArcs: 2,
  characterMatrix: 3,
  styleProfileRaw: 1,
  parentCanon: 3,
  fanficCanonRaw: 3,
} as const;

const WRITER_SETTLE_WEIGHTS = {
  currentState: 4,
  ledger: 2,
  hooks: 4,
  chapterSummaries: 3,
  subplotBoard: 2,
  emotionalArcs: 2,
  characterMatrix: 3,
  volumeOutline: 3,
} as const;

function readFileOrDefault(
  path: string,
  fallback = WRITER_CONTEXT_MISSING,
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

export async function readWriterTruthContext(
  bookDir: string,
  fallback = WRITER_CONTEXT_MISSING,
  options?: TruthContextReadOptions,
): Promise<WriterTruthContext> {
  const key = contextCacheKey("writer:truth", bookDir, fallback, options);
  return options?.cache?.getOrLoad(key, () => loadWriterTruthContext(bookDir, fallback, options))
    ?? loadWriterTruthContext(bookDir, fallback, options);
}

async function loadWriterTruthContext(
  bookDir: string,
  fallback: string,
  options?: TruthContextReadOptions,
): Promise<WriterTruthContext> {
  const [
    storyBibleRaw,
    volumeOutline,
    styleGuide,
    currentState,
    ledger,
    hooks,
    chapterSummaries,
    subplotBoard,
    emotionalArcs,
    characterMatrix,
    styleProfileRaw,
    parentCanon,
    fanficCanonRaw,
  ] = await Promise.all([
    readStoryFrame(bookDir, fallback),
    readVolumeMap(bookDir, fallback),
    readFileOrDefault(join(bookDir, "story/style_guide.md"), fallback, options),
    readCurrentStateWithFallback(bookDir, fallback),
    readFileOrDefault(join(bookDir, "story/particle_ledger.md"), fallback, options),
    readFileOrDefault(join(bookDir, "story/pending_hooks.md"), fallback, options),
    readFileOrDefault(join(bookDir, "story/chapter_summaries.md"), fallback, options),
    readFileOrDefault(join(bookDir, "story/subplot_board.md"), fallback, options),
    readFileOrDefault(join(bookDir, "story/emotional_arcs.md"), fallback, options),
    readCharacterContext(bookDir, fallback),
    readFileOrDefault(join(bookDir, "story/style_profile.json"), fallback, options),
    readFileOrDefault(join(bookDir, "story/parent_canon.md"), fallback, options),
    readFileOrDefault(join(bookDir, "story/fanfic_canon.md"), fallback, options),
  ]);

  const context = {
    storyBibleRaw,
    volumeOutline,
    styleGuide,
    currentState,
    ledger,
    hooks,
    chapterSummaries,
    subplotBoard,
    emotionalArcs,
    characterMatrix,
    styleProfileRaw,
    parentCanon,
    fanficCanonRaw,
  };
  const budgeted = applyTruthContextBudget(context, options ?? {}, {
    weights: WRITER_TRUTH_WEIGHTS,
  });
  options?.cache?.recordBudget(budgeted);
  return budgeted.context;
}

export async function readWriterSettleContext(
  bookDir: string,
  fallback = WRITER_CONTEXT_MISSING,
  options?: TruthContextReadOptions,
): Promise<WriterSettleContext> {
  const key = contextCacheKey("writer:settle", bookDir, fallback, options);
  return options?.cache?.getOrLoad(key, () => loadWriterSettleContext(bookDir, fallback, options))
    ?? loadWriterSettleContext(bookDir, fallback, options);
}

async function loadWriterSettleContext(
  bookDir: string,
  fallback: string,
  options?: TruthContextReadOptions,
): Promise<WriterSettleContext> {
  const truth = await options?.cache?.peek<WriterTruthContext>(contextCacheKey("writer:truth", bookDir, fallback, options));
  if (truth) {
    return applySettleBudget({
      currentState: truth.currentState,
      ledger: truth.ledger,
      hooks: truth.hooks,
      chapterSummaries: truth.chapterSummaries,
      subplotBoard: truth.subplotBoard,
      emotionalArcs: truth.emotionalArcs,
      characterMatrix: truth.characterMatrix,
      volumeOutline: truth.volumeOutline,
    }, options);
  }

  const [
    currentState,
    ledger,
    hooks,
    chapterSummaries,
    subplotBoard,
    emotionalArcs,
    characterMatrix,
    volumeOutline,
  ] = await Promise.all([
    readCurrentStateWithFallback(bookDir, fallback),
    readFileOrDefault(join(bookDir, "story/particle_ledger.md"), fallback, options),
    readFileOrDefault(join(bookDir, "story/pending_hooks.md"), fallback, options),
    readFileOrDefault(join(bookDir, "story/chapter_summaries.md"), fallback, options),
    readFileOrDefault(join(bookDir, "story/subplot_board.md"), fallback, options),
    readFileOrDefault(join(bookDir, "story/emotional_arcs.md"), fallback, options),
    readCharacterContext(bookDir, fallback),
    readVolumeMap(bookDir, fallback),
  ]);

  return applySettleBudget({
    currentState,
    ledger,
    hooks,
    chapterSummaries,
    subplotBoard,
    emotionalArcs,
    characterMatrix,
    volumeOutline,
  }, options);
}

function applySettleBudget(
  context: WriterSettleContext,
  options?: TruthContextReadOptions,
): WriterSettleContext {
  const budgeted = applyTruthContextBudget(context, options ?? {}, {
    weights: WRITER_SETTLE_WEIGHTS,
  });
  options?.cache?.recordBudget(budgeted);
  return budgeted.context;
}
