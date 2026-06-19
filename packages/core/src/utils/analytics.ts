export interface WritingDayStat {
  readonly date: string;
  readonly wordsWritten: number;
  readonly chaptersModified: number;
  readonly chaptersApproved: number;
}

export interface TokenStats {
  readonly totalPromptTokens: number;
  readonly totalCompletionTokens: number;
  readonly totalTokens: number;
  readonly avgTokensPerChapter: number;
  readonly recentTrend: ReadonlyArray<{ readonly chapter: number; readonly totalTokens: number }>;
}

export interface AnalyticsData {
  readonly bookId: string;
  readonly totalChapters: number;
  readonly totalWords: number;
  readonly avgWordsPerChapter: number;
  readonly auditPassRate: number;
  readonly topIssueCategories: ReadonlyArray<{ readonly category: string; readonly count: number }>;
  readonly chaptersWithMostIssues: ReadonlyArray<{ readonly chapter: number; readonly issueCount: number }>;
  readonly statusDistribution: Record<string, number>;
  readonly tokenStats?: TokenStats;
  readonly dailyStats: ReadonlyArray<WritingDayStat>;
  readonly consecutiveWritingDays: number;
  readonly targetProgress: { readonly current: number; readonly target: number; readonly percentage: number };
}

export function computeAnalytics(
  bookId: string,
  chapters: ReadonlyArray<{
    readonly number: number;
    readonly status: string;
    readonly wordCount: number;
    readonly auditIssues: ReadonlyArray<string>;
    readonly updatedAt?: string;
    readonly tokenUsage?: {
      readonly promptTokens: number;
      readonly completionTokens: number;
      readonly totalTokens: number;
    };
  }>,
  bookConfig?: { readonly targetChapters?: number; readonly chapterWordCount?: number },
): AnalyticsData {
  const totalChapters = chapters.length;
  const totalWords = chapters.reduce((sum, ch) => sum + ch.wordCount, 0);
  const avgWordsPerChapter = totalChapters > 0 ? Math.round(totalWords / totalChapters) : 0;

  const passedStatuses = new Set(["ready-for-review", "approved", "published"]);
  const auditedChapters = chapters.filter(
    (ch) => ch.status !== "drafted" && ch.status !== "drafting" && ch.status !== "card-generated",
  );
  const passedChapters = auditedChapters.filter((ch) => passedStatuses.has(ch.status));
  const auditPassRate = auditedChapters.length > 0
    ? Math.round((passedChapters.length / auditedChapters.length) * 100)
    : 100;

  const categoryCounts = new Map<string, number>();
  for (const ch of chapters) {
    for (const issue of ch.auditIssues) {
      // 支持多种格式的问题分类提取
      // 格式1: [severity] Category: description
      // 格式2: Category: description
      // 格式3: Category - description
      // 格式4: Category。description (中文句号)
      let category = "未分类";

      // 尝试提取分类名称
      const patterns = [
        /\[(?:critical|warning|info|warning|error)\]\s*([^:：\-]+)/,  // [severity] Category
        /^([^:：\-]+)[:：]/,  // Category: 或 Category：
        /^([^:：\-。]+)[：:]/,  // Category: 或 Category：
      ];

      for (const pattern of patterns) {
        const match = issue.match(pattern);
        if (match && match[1]) {
          category = match[1].trim();
          // 过滤掉太短或无效的分类
          if (category.length >= 2) break;
        }
      }

      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }
  }
  const topIssueCategories = [...categoryCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([category, count]) => ({ category, count }));

  const chaptersWithMostIssues = [...chapters]
    .filter((ch) => ch.auditIssues.length > 0)
    .sort((a, b) => b.auditIssues.length - a.auditIssues.length)
    .slice(0, 5)
    .map((ch) => ({ chapter: ch.number, issueCount: ch.auditIssues.length }));

  const statusDistribution: Record<string, number> = {};
  for (const ch of chapters) {
    statusDistribution[ch.status] = (statusDistribution[ch.status] ?? 0) + 1;
  }

  const chaptersWithUsage = chapters.filter((ch) => ch.tokenUsage);
  let tokenStats: TokenStats | undefined;
  if (chaptersWithUsage.length > 0) {
    const totalPromptTokens = chaptersWithUsage.reduce((sum, ch) => sum + (ch.tokenUsage?.promptTokens ?? 0), 0);
    const totalCompletionTokens = chaptersWithUsage.reduce((sum, ch) => sum + (ch.tokenUsage?.completionTokens ?? 0), 0);
    const totalTokens = chaptersWithUsage.reduce((sum, ch) => sum + (ch.tokenUsage?.totalTokens ?? 0), 0);
    const avgTokensPerChapter = Math.round(totalTokens / chaptersWithUsage.length);

    const recentTrend = [...chaptersWithUsage]
      .sort((a, b) => a.number - b.number)
      .slice(-5)
      .map((ch) => ({ chapter: ch.number, totalTokens: ch.tokenUsage?.totalTokens ?? 0 }));

    tokenStats = { totalPromptTokens, totalCompletionTokens, totalTokens, avgTokensPerChapter, recentTrend };
  }

  // --- Daily writing stats (from updatedAt) ---
  const dayMap = new Map<string, { words: number; modified: number; approved: number }>();
  for (const ch of chapters) {
    if (!ch.updatedAt) continue;
    const day = ch.updatedAt.slice(0, 10);
    const entry = dayMap.get(day) ?? { words: 0, modified: 0, approved: 0 };
    // This is an estimate: it's the total words of chapters touched on that day.
    entry.words += ch.wordCount;
    entry.modified += 1;
    if (ch.status === "approved") entry.approved += 1;
    dayMap.set(day, entry);
  }
  const allWritingDays = new Set(dayMap.keys());
  const dailyStats = [...dayMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-30)
    .map(([date, v]) => ({ date, wordsWritten: v.words, chaptersModified: v.modified, chaptersApproved: v.approved }));

  // --- Consecutive writing days ---
  let consecutiveWritingDays = 0;
  if (allWritingDays.size > 0) {
    // 使用本地时区计算今天的日期
    const now = new Date();
    const localOffset = now.getTimezoneOffset();
    const localToday = new Date(now.getTime() - localOffset * 60000);
    const today = localToday.toISOString().slice(0, 10);
    const yesterday = new Date(localToday.getTime() - 86400000).toISOString().slice(0, 10);

    // If no activity today, check if streak is alive from yesterday
    let d = allWritingDays.has(today) ? new Date(today) : (allWritingDays.has(yesterday) ? new Date(yesterday) : null);

    if (d) {
      while (allWritingDays.has(d.toISOString().slice(0, 10))) {
        consecutiveWritingDays++;
        d.setDate(d.getDate() - 1);
      }
    }
  }

  // --- Target progress ---
  const targetChapters = bookConfig?.targetChapters ?? 200;
  const chapterWordCount = bookConfig?.chapterWordCount ?? 3000;
  const target = targetChapters * chapterWordCount;
  const targetProgress = { current: totalWords, target, percentage: target > 0 ? Math.min(100, Math.round((totalWords / target) * 100)) : 0 };

  return {
    bookId, totalChapters, totalWords, avgWordsPerChapter, auditPassRate,
    topIssueCategories, chaptersWithMostIssues, statusDistribution, tokenStats,
    dailyStats, consecutiveWritingDays, targetProgress,
  };
}
