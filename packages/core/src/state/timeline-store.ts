import { z } from "zod";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export const TimelineAnchorSchema = z.object({
  chapter: z.number().int().min(1),
  timeDescription: z.string().min(1),
  parsedDate: z.string().optional(),
  charactersPresent: z.array(z.string()).default([]),
  eventSummary: z.string().min(1),
  position: z.number().optional(),
  contextParagraph: z.string().optional(),
});
export type TimelineAnchor = z.infer<typeof TimelineAnchorSchema>;

export const TimelineDataSchema = z.object({
  bookId: z.string().min(1),
  anchors: z.array(TimelineAnchorSchema).default([]),
  lastRebuilt: z.string().datetime().optional(),
});
export type TimelineData = z.infer<typeof TimelineDataSchema>;

const TIMELINE_FILE = "timeline.json";

export async function loadTimeline(bookDir: string): Promise<TimelineData> {
  try {
    const raw = await readFile(join(bookDir, TIMELINE_FILE), "utf-8");
    return TimelineDataSchema.parse(JSON.parse(raw));
  } catch {
    return { bookId: "", anchors: [] };
  }
}

export async function saveTimeline(bookDir: string, data: TimelineData): Promise<void> {
  await mkdir(bookDir, { recursive: true });
  await writeFile(join(bookDir, TIMELINE_FILE), JSON.stringify(data, null, 2), "utf-8");
}

const CHINESE_DATE_PATTERNS: ReadonlyArray<{
  re: RegExp;
  extract: (match: RegExpMatchArray) => string;
}> = [
  // 绝对日期：第X年
  {
    re: /第([零一二三四五六七八九十百千万\d]+)年/g,
    extract: (m) => `第${m[1]}年`,
  },
  // 绝对日期：X月X日
  {
    re: /([一二三四五六七八九十\d]+)月([一二三四五六七八九十百\d]+)[日号]/g,
    extract: (m) => `${m[1]}月${m[2]}日`,
  },
  // 绝对日期：YYYY-MM-DD / YYYY年MM月DD日 / YYYY/MM/DD
  {
    re: /(\d{4})[年/-](\d{1,2})[月/-](\d{1,2})[日号]?/g,
    extract: (m) => `${m[1]}-${m[2]!.padStart(2, "0")}-${m[3]!.padStart(2, "0")}`,
  },
  // 相对时间：X天/月/年后（含"前后以内"等）
  {
    re: /[零一二三四五六七八九十百千\d]+(?:天|日|个月|月|年)(?:前|后|之间|以内|多)?/g,
    extract: (m) => m[0],
  },
  // 经典相对时间
  {
    re: /翌日|次日|第二天|第三天|当晚|那天|今日|昨日|前天|当天|当月|当年|隔日|隔天/g,
    extract: (m) => m[0],
  },
  // 时间段
  {
    re: /清晨|黎明|拂晓|天亮|早上|上午|正午|中午|下午|傍晚|黄昏|天黑|晚上|入夜|午夜|深夜|凌晨|日出|日落|破晓|早春|盛夏|金秋|寒冬/g,
    extract: (m) => m[0],
  },
  // 状态时间
  {
    re: /此刻|这时|此时|不久之后?|片刻之后?|半晌|良久|须臾|忽然之间|眨眼之间|一瞬间|一转眼|功夫/g,
    extract: (m) => m[0],
  },
  // 星期时间
  {
    re: /星期一|星期二|星期三|星期四|星期五|星期六|星期日|星期天|周一|周二|周三|周四|周五|周六|周日/g,
    extract: (m) => m[0],
  },
  // 季节时间
  {
    re: /春天|夏季|秋天|冬季|春分|夏至|秋分|冬至|春末|夏初|秋末|冬初|开春|入秋|入冬|入夏/g,
    extract: (m) => m[0],
  },
  // 节日时间
  {
    re: /除夕|春节|元宵节|清明节|端午节|中秋节|重阳节|新年伊始|年终|岁末|年末|年中|开年/g,
    extract: (m) => m[0],
  },
  // 传统时辰
  {
    re: /子时|丑时|寅时|卯时|辰时|巳时|午时|未时|申时|酉时|戌时|亥时|三更|五更|一更|二更|四更|半夜|更深夜静/g,
    extract: (m) => m[0],
  },
  // 模糊时间
  {
    re: /很久以前|很久之后|遥远的过去|未来的某一天|若干年后|数十年后?|数百年后?|数千年后?/g,
    extract: (m) => m[0],
  },
  // 时代/年代
  {
    re: /战争时期|和平年代|乱世|盛世|衰世|末世|远古|近古|中古|上古|史前|史后/g,
    extract: (m) => m[0],
  },
  // 人生阶段
  {
    re: /童年|少年|青年|中年|老年|幼年|婴幼儿|成年|壮年|暮年|垂暮之年|花甲之年|古稀之年|弱冠之年|及笄之年/g,
    extract: (m) => m[0],
  },
];

/** 提取匹配位置所在的完整段落（以 \n\n 为边界） */
function extractParagraph(content: string, matchIndex: number): string {
  let start = matchIndex;
  while (start > 0) {
    const nl = content.lastIndexOf("\n\n", start - 1);
    if (nl === -1 || nl < start - 500) break;
    start = nl + 2;
  }
  let end = matchIndex;
  while (end < content.length) {
    const nl = content.indexOf("\n\n", end);
    if (nl === -1 || nl > end + 1000) break;
    end = nl;
  }
  return content.slice(start, end).replace(/\n/g, " ").trim();
}

export function extractTimelineAnchors(
  chapterNumber: number,
  content: string,
): ReadonlyArray<Omit<TimelineAnchor, "id">> {
  const raw: Array<{ parsedDate: string; timeDescription: string; position: number; context: string; paragraph: string }> = [];

  for (const pattern of CHINESE_DATE_PATTERNS) {
    let match: RegExpExecArray | null;
    while ((match = pattern.re.exec(content)) !== null) {
      const parsedDate = pattern.extract(match);
      const pos = match.index;

      // Larger context window: 200 chars before and after
      const ctxStart = Math.max(0, pos - 200);
      const ctxEnd = Math.min(content.length, pos + match[0].length + 200);
      const context = content.slice(ctxStart, ctxEnd).replace(/\n/g, " ").trim();

      const paragraph = extractParagraph(content, pos);

      // Dedup by position (same spot in text)
      const alreadyExists = raw.some((a) => Math.abs(a.position - pos) < 10 && a.parsedDate === parsedDate);
      if (!alreadyExists) {
        raw.push({ parsedDate, timeDescription: match[0], position: pos, context, paragraph });
      }
    }
  }

  // Merge: same chapter + same parsedDate → keep the one with longest context
  const merged = new Map<string, (typeof raw)[0]>();
  for (const item of raw) {
    const key = `${chapterNumber}:${item.parsedDate}`;
    const existing = merged.get(key);
    if (!existing || item.context.length > existing.context.length) {
      merged.set(key, item);
    }
  }

  // Convert to anchors
  const anchors: Array<Omit<TimelineAnchor, "id">> = [];
  for (const item of merged.values()) {
    const summary = item.context.length > 300 ? `${item.context.slice(0, 297)}…` : item.context;
    anchors.push({
      chapter: chapterNumber,
      timeDescription: item.timeDescription,
      parsedDate: item.parsedDate,
      charactersPresent: [],
      eventSummary: summary,
      position: item.position,
      contextParagraph: item.paragraph,
    });
  }

  return anchors;
}

export function validateTimelineConsistency(
  anchors: ReadonlyArray<TimelineAnchor>,
): ReadonlyArray<{ chapter: number; issue: string }> {
  const issues: Array<{ chapter: number; issue: string }> = [];

  for (let i = 1; i < anchors.length; i += 1) {
    const prev = anchors[i - 1]!;
    const curr = anchors[i]!;

    // Simple check: if chapter goes backward but time goes forward
    if (curr.chapter < prev.chapter && curr.parsedDate && prev.parsedDate) {
      // Numeric dates: check ordering
      const prevNum = parseInt(prev.parsedDate.replace(/\D/g, ""), 10);
      const currNum = parseInt(curr.parsedDate.replace(/\D/g, ""), 10);
      if (!Number.isNaN(prevNum) && !Number.isNaN(currNum) && currNum < prevNum) {
        issues.push({
          chapter: curr.chapter,
          issue: `时间倒流：第${curr.chapter}章的时间(${curr.parsedDate})早于第${prev.chapter}章(${prev.parsedDate})`,
        });
      }
    }
  }

  return issues;
}

export type { TimelineAnchor as TimelineAnchorType };
