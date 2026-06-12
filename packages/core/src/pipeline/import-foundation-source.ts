import type { LengthLanguage } from "../utils/length-metrics.js";

interface ImportFoundationSourceOptions {
  readonly maxFullTextChars?: number;
  readonly chapterExcerptChars?: number;
  readonly titleCatalogChars?: number;
  readonly edgeChapterCount?: number;
  readonly middleAnchorCount?: number;
}

const DEFAULT_IMPORT_FOUNDATION_MAX_FULL_TEXT_CHARS = 80_000;
const DEFAULT_IMPORT_CHAPTER_EXCERPT_CHARS = 6_000;
const DEFAULT_IMPORT_TITLE_CATALOG_CHARS = 24_000;
const DEFAULT_IMPORT_EDGE_CHAPTER_COUNT = 4;
const DEFAULT_IMPORT_MIDDLE_ANCHOR_COUNT = 8;

function formatImportedChapter(
  chapter: { readonly title: string; readonly content: string },
  index: number,
  language: LengthLanguage,
  content = chapter.content,
): string {
  return language === "en"
    ? `Chapter ${index + 1}: ${chapter.title}\n\n${content}`
    : `第${index + 1}章 ${chapter.title}\n\n${content}`;
}

function estimateImportFullTextLength(
  chapters: ReadonlyArray<{ readonly title: string; readonly content: string }>,
): number {
  return chapters.reduce((total, chapter) => total + chapter.title.length + chapter.content.length + 24, 0);
}

function excerptHeadTail(text: string, maxChars: number, language: LengthLanguage): string {
  const clean = text.trim();
  if (clean.length <= maxChars) return clean;
  const headChars = Math.max(200, Math.floor(maxChars * 0.6));
  const tailChars = Math.max(200, maxChars - headChars);
  const omitted = clean.length - headChars - tailChars;
  const marker = language === "en"
    ? `\n\n[... ${omitted} chars omitted for import-context budget ...]\n\n`
    : `\n\n【中间省略 ${omitted} 字，用于控制导入上下文预算】\n\n`;
  return `${clean.slice(0, headChars).trimEnd()}${marker}${clean.slice(-tailChars).trimStart()}`;
}

function pickImportAnchorIndexes(
  chapterCount: number,
  edgeChapterCount: number,
  middleAnchorCount: number,
): ReadonlyArray<number> {
  const selected = new Set<number>();
  for (let i = 0; i < Math.min(edgeChapterCount, chapterCount); i++) selected.add(i);
  for (let i = Math.max(0, chapterCount - edgeChapterCount); i < chapterCount; i++) selected.add(i);

  const middleStart = Math.min(edgeChapterCount, chapterCount);
  const middleEnd = Math.max(middleStart, chapterCount - edgeChapterCount);
  const middleSize = middleEnd - middleStart;
  const anchors = Math.min(middleAnchorCount, middleSize);
  for (let i = 0; i < anchors; i++) {
    const offset = Math.floor(((i + 1) * middleSize) / (anchors + 1));
    selected.add(Math.min(chapterCount - 1, middleStart + offset));
  }

  return [...selected].sort((a, b) => a - b);
}

function buildTitleCatalog(
  chapters: ReadonlyArray<{ readonly title: string; readonly content: string }>,
  language: LengthLanguage,
  maxChars: number,
): string {
  const lines = chapters.map((chapter, index) =>
    language === "en"
      ? `- Chapter ${index + 1}: ${chapter.title} (${chapter.content.length} chars)`
      : `- 第${index + 1}章：${chapter.title}（${chapter.content.length}字）`,
  );
  const joined = lines.join("\n");
  if (joined.length <= maxChars) return joined;

  const headBudget = Math.floor(maxChars * 0.55);
  const tailBudget = maxChars - headBudget;
  const head: string[] = [];
  const tail: string[] = [];
  let headChars = 0;
  let tailChars = 0;
  for (const line of lines) {
    if (headChars + line.length + 1 > headBudget) break;
    head.push(line);
    headChars += line.length + 1;
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!;
    if (tailChars + line.length + 1 > tailBudget) break;
    tail.unshift(line);
    tailChars += line.length + 1;
  }
  const omitted = lines.length - head.length - tail.length;
  const marker = language === "en"
    ? `- ... ${omitted} chapter titles omitted ...`
    : `- ……中间 ${omitted} 个章节标题省略……`;
  return [...head, marker, ...tail].join("\n");
}

/**
 * Build the architect external-context for a side-story (番外) foundation: frame
 * it as a companion work that reuses the parent canon's cast/world but tells an
 * independent side plot, and attach the parent canon as reference material.
 */
export function buildSpinoffFoundationContext(
  parentCanon: string,
  direction: string | undefined,
  language: "zh" | "en",
): string {
  const dir = direction?.trim();
  if (language === "en") {
    return [
      "## This is a SIDE-STORY (番外)",
      "Reuse the established characters, world, and rules from the parent canon below. Tell an INDEPENDENT side plot — a bonus arc, a character backstory, or a what-if — that does NOT advance or contradict the parent work's main storyline.",
      dir ? `\n## Side-story direction\n${dir}` : "",
      `\n## Parent canon (reuse these characters and settings)\n${parentCanon}`,
    ].filter(Boolean).join("\n");
  }
  return [
    "## 这是一部番外",
    "复用下方正传正典里已确立的角色、世界观与规则。讲一个独立的侧篇故事——支线、角色前传或 what-if——不要推进或违背正传的主线剧情。",
    dir ? `\n## 番外方向\n${dir}` : "",
    `\n## 正传正典（复用以下角色与设定）\n${parentCanon}`,
  ].filter(Boolean).join("\n");
}

export function buildImportFoundationSource(
  chapters: ReadonlyArray<{ readonly title: string; readonly content: string }>,
  language: LengthLanguage,
  options: ImportFoundationSourceOptions = {},
): string {
  const maxFullTextChars = options.maxFullTextChars ?? DEFAULT_IMPORT_FOUNDATION_MAX_FULL_TEXT_CHARS;
  const chapterExcerptChars = options.chapterExcerptChars ?? DEFAULT_IMPORT_CHAPTER_EXCERPT_CHARS;
  const titleCatalogChars = options.titleCatalogChars ?? DEFAULT_IMPORT_TITLE_CATALOG_CHARS;
  const edgeChapterCount = options.edgeChapterCount ?? DEFAULT_IMPORT_EDGE_CHAPTER_COUNT;
  const middleAnchorCount = options.middleAnchorCount ?? DEFAULT_IMPORT_MIDDLE_ANCHOR_COUNT;

  if (estimateImportFullTextLength(chapters) <= maxFullTextChars) {
    return chapters.map((chapter, index) => formatImportedChapter(chapter, index, language)).join("\n\n---\n\n");
  }

  const anchorIndexes = pickImportAnchorIndexes(chapters.length, edgeChapterCount, middleAnchorCount);
  const header = language === "en"
    ? [
        "## Import foundation source package",
        "",
        `The imported book has ${chapters.length} chapters. To avoid overflowing the LLM context, this package keeps the opening chapters, ending/continuation point, selected middle anchors, and a capped title catalog. Full chapters will still be replayed sequentially after foundation generation to rebuild truth files.`,
      ].join("\n")
    : [
        "## 导入基础设定压缩资料包",
        "",
        `本次导入共 ${chapters.length} 章。为避免超出 LLM 上下文，这里保留开篇、结尾续写点、少量中段锚点和标题目录；完整章节将在后续顺序回放中逐章分析并沉淀 truth files。`,
      ].join("\n");
  const catalogTitle = language === "en" ? "## Capped chapter title catalog" : "## 章节标题目录（截断）";
  const anchorsTitle = language === "en" ? "## Source excerpts for architecture" : "## 用于反推基础设定的正文摘录";
  const anchorText = anchorIndexes
    .map((index) => {
      const chapter = chapters[index]!;
      return formatImportedChapter(
        chapter,
        index,
        language,
        excerptHeadTail(chapter.content, chapterExcerptChars, language),
      );
    })
    .join("\n\n---\n\n");

  return [
    header,
    "",
    catalogTitle,
    buildTitleCatalog(chapters, language, titleCatalogChars),
    "",
    anchorsTitle,
    anchorText,
  ].join("\n");
}
