import { BaseAgent } from "./base.js";

export interface ValidationWarning {
  readonly category: string;
  readonly description: string;
}

export interface ValidationResult {
  readonly warnings: ReadonlyArray<ValidationWarning>;
  readonly passed: boolean;
}

export interface StateValidationAuthorityContext {
  readonly storyFrame?: string;
  readonly bookRules?: string;
  readonly chapterSummaries?: string;
}

/**
 * Validates Settler output by comparing old and new truth files via LLM.
 * Catches contradictions, missing state changes, and temporal inconsistencies.
 *
 * Uses a minimal verdict protocol instead of requiring structured JSON:
 *   A standalone verdict line: PASS or FAIL
 *   Remaining lines: free-form warnings (one per line, optional category prefix)
 */
export class StateValidatorAgent extends BaseAgent {
  get name(): string {
    return "state-validator";
  }

  async validate(
    chapterContent: string,
    chapterNumber: number,
    oldState: string,
    newState: string,
    oldHooks: string,
    newHooks: string,
    language: "zh" | "en" = "zh",
    authorityContext?: StateValidationAuthorityContext,
  ): Promise<ValidationResult> {
    const stateDiff = this.computeDiff(oldState, newState, "State Card");
    const hooksDiff = this.computeDiff(oldHooks, newHooks, "Hooks Pool");

    // Skip validation if nothing changed
    if (!stateDiff && !hooksDiff) {
      return { warnings: [], passed: true };
    }

    const langInstruction = language === "en"
      ? "Respond in English."
      : "全程使用中文回答，包括分类标签（如 [矛盾]、[不支持的变更] 等）。";

    const isZh = language === "zh";

    const systemPrompt = isZh
      ? `你是一个小说写作系统的连续性校验器。全程使用中文回答。

给定章节文本和 truth 文件（状态卡 + 伏笔池）的变更，检查是否存在矛盾：

1. 无叙事支撑的状态变更 — truth 文件说某事发生了，但章节正文没有描述
2. 遗漏的状态变更 — 章节正文描述了某事发生，但 truth 文件没有记录
3. 时间不可能性 — 角色在没有过渡的情况下移动位置，伤势在没有时间流逝的情况下愈合
4. 伏笔异常 — 伏笔消失但未标记为已解决，或新伏笔在章节中没有依据
5. 回溯性编辑 — truth 文件变更暗示某事发生在前一章，而非当前章
6. 跨 truth 关键设定冲突 — 编号规则、名称、等级、身份、地点或关系标签与章节文本或权威上下文矛盾

## 章末快照语义

- 新的状态卡是章节末尾的快照，不是声称其值在整个章节中都成立。
- 按时间顺序阅读章节。后面明确的过渡会覆盖前面的条件。
- 更早的事件是历史证据，当章节后来改变该状态时不是矛盾。
- 例如：之前收到消息并不与"手机物理隔离"的终态矛盾，如果角色后来关机并取出电池。
- 只有当最终明确的章节状态与新状态卡冲突，或没有叙事过渡支持新的终态时，才报告矛盾。

输出格式（简单，非 JSON）：
- 包含一个独立的判定行：恰好 PASS 或 FAIL（该行不放其他内容）
- 后续行：每行一条警告，可选 [类别] 前缀
- 如果完全没有问题，直接输出：PASS

示例：
PASS
[无支撑的变更] 状态卡说角色移动到了森林，但正文只显示了意图
[次要] 伏笔 H03 推进了但正文描述简略

或者如果有硬矛盾：
FAIL
[矛盾] 状态说角色已死但章节正文显示他们在说话
[无支撑的变更] 新地点在正文中完全没有提及

重要：只对与正文直接冲突的事实性矛盾输出 FAIL。不要对以下情况输出 FAIL：
- 稍微超前于正文的推断
- 状态卡没有捕获的缺失细节
- 从正文合理的推断
- 不与正文矛盾的伏笔管理差异
这些应该是 PASS 附带警告，而不是 FAIL。`
      : `You are a continuity validator for a novel writing system. ${langInstruction}

Given the chapter text and the CHANGES made to truth files (state card + hooks pool), check for contradictions:

1. State change without narrative support — truth file says something changed but the chapter text doesn't describe it
2. Missing state change — chapter text describes something happening but the truth file didn't capture it
3. Temporal impossibility — character moves locations without transition, injury heals without time passing
4. Hook anomaly — a hook disappeared without being marked resolved, or a new hook has no basis in the chapter
5. Retroactive edit — truth file change implies something happened in a PREVIOUS chapter, not the current one
6. Cross-truth key-setting conflict — numbered rules, named laws, ranks, identities, locations, or relationship labels in the new truth files contradict the chapter text or the authority context

## End-of-Chapter Snapshot Semantics

- The new State Card is a snapshot taken at the END of the chapter, not a claim that its values were true throughout the entire chapter.
- Read the chapter in chronological order. A later explicit transition supersedes an earlier condition.
- Earlier events are historical evidence, not contradictions, when the chapter later changes that state.
- Example: receiving messages earlier does not contradict an end-state of "phone physically isolated" if the character later powers it off and removes the battery.
- Report a contradiction only when the final explicit chapter state conflicts with the new State Card, or when no narrative transition supports the new end-state.

Output format (simple, NOT JSON):
- Include one standalone verdict line: exactly PASS or FAIL (nothing else on that line)
- Following lines: one warning per line, optionally prefixed with [category]
- If no issues at all, just output: PASS

Example:
PASS
[unsupported_change] State card says character moved to the forest, but text only shows intent
[minor] Hook H03 advanced but text mention is brief

Or if there are hard contradictions:
FAIL
[contradiction] State says character is dead but chapter text shows them speaking
[unsupported_change] New location not mentioned anywhere in chapter text

IMPORTANT: Output FAIL ONLY for hard contradictions — facts that directly conflict with the chapter text. Do NOT fail for:
- Slightly ahead-of-text inferences
- Missing details that the state card didn't capture
- Reasonable extrapolations from text
- Hook management differences that don't contradict text
These should be warnings with PASS, not FAIL.`;

    const authorityBlock = this.buildAuthorityContextBlock(authorityContext);

    const userPrompt = isZh
      ? `第 ${chapterNumber} 章校验：\n\n${authorityBlock}\n\n## 状态卡变更\n${stateDiff || "（无变更）"}\n\n## 伏笔池变更\n${hooksDiff || "（无变更）"}\n\n## 章节正文（按时间顺序；后面明确的状态变化覆盖前面的条件）\n${chapterContent}`
      : `Chapter ${chapterNumber} validation:\n\n${authorityBlock}\n\n## State Card Changes\n${stateDiff || "(no changes)"}\n\n## Hooks Pool Changes\n${hooksDiff || "(no changes)"}\n\n## Chapter Text (chronological; later explicit state changes override earlier conditions)\n${chapterContent}`;

    try {
      const response = await this.chat(
        [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        { temperature: 0.1 },
      );

      return this.parseResult(response.content);
    } catch (error) {
      this.log?.warn(`State validation failed: ${error}`);
      throw error;
    }
  }

  private computeDiff(oldText: string, newText: string, label: string): string | null {
    if (oldText === newText) return null;

    const oldLines = oldText.split("\n").filter((l) => l.trim());
    const newLines = newText.split("\n").filter((l) => l.trim());

    const added = newLines.filter((l) => !oldLines.includes(l));
    const removed = oldLines.filter((l) => !newLines.includes(l));

    if (added.length === 0 && removed.length === 0) return null;

    const parts = [`### ${label}`];
    if (removed.length > 0) parts.push("Removed:\n" + removed.map((l) => `- ${l}`).join("\n"));
    if (added.length > 0) parts.push("Added:\n" + added.map((l) => `+ ${l}`).join("\n"));
    return parts.join("\n");
  }

  private buildAuthorityContextBlock(authorityContext?: StateValidationAuthorityContext): string {
    if (!authorityContext) return "## Authority / Cross-Truth Context\n(no authority context provided)";

    const storyFrame = (authorityContext.storyFrame ?? "").trim();
    const bookRules = (authorityContext.bookRules ?? "").trim();
    const chapterSummaries = (authorityContext.chapterSummaries ?? "").trim();

    return [
      "## Authority / Cross-Truth Context",
      "Authority priority: current chapter text > runtime truth files/current summaries > story_frame/book_rules > legacy story_bible intro or marketing-style prose. If the current chapter establishes a numbered/name mapping, new truth files must follow that mapping instead of preserving an older intro-only version.",
      "",
      "### story_frame / legacy story_bible excerpt",
      storyFrame || "(empty)",
      "",
      "### book_rules excerpt",
      bookRules || "(empty)",
      "",
      "### recent chapter_summaries excerpt",
      chapterSummaries || "(empty)",
    ].join("\n");
  }

  private parseResult(content: string): ValidationResult {
    const trimmed = content.trim();
    if (!trimmed) {
      throw new Error("LLM returned empty response");
    }

    const jsonResult = this.tryParseJsonResult(trimmed);
    if (jsonResult) {
      return jsonResult;
    }

    const lines = trimmed.split("\n").map((line) => line.trim()).filter(Boolean);
    if (lines.length === 0) {
      throw new Error("LLM returned empty response");
    }

    const verdictIndex = findVerdictLineIndex(lines);
    if (verdictIndex < 0) {
      throw new Error("State validator returned invalid response");
    }
    const verdictLine = lines[verdictIndex]!;
    const passed = /^PASS$/i.test(verdictLine);

    const warnings: ValidationWarning[] = [];
    const warningLines = passed
      ? lines.slice(verdictIndex + 1)
      : [...lines.slice(0, verdictIndex), ...lines.slice(verdictIndex + 1)];
    for (const line of warningLines) {
      if (/^(PASS|FAIL)$/i.test(line)) continue;

      const categoryMatch = line.match(/^\[([^\]]+)\]\s*(.+)$/);
      if (categoryMatch) {
        warnings.push({
          category: categoryMatch[1]!.trim(),
          description: categoryMatch[2]!.trim(),
        });
      } else if (line.startsWith("- ") || line.startsWith("* ")) {
        warnings.push({
          category: "general",
          description: line.slice(2).trim(),
        });
      } else if (line.length > 5) {
        warnings.push({
          category: "general",
          description: line,
        });
      }
    }

    return { warnings, passed };
  }

  private tryParseJsonResult(text: string): ValidationResult | null {
    const direct = this.tryParseExactJsonResult(text);
    if (direct) {
      return direct;
    }

    const candidate = extractBalancedJsonObject(text);
    if (!candidate) {
      return null;
    }
    return this.tryParseExactJsonResult(candidate);
  }

  private tryParseExactJsonResult(text: string): ValidationResult | null {
    try {
      const parsed = JSON.parse(text) as {
        warnings?: Array<{ category?: string; description?: string }>;
        passed?: boolean;
      };
      if (typeof parsed.passed !== "boolean") return null;
      return {
        warnings: (parsed.warnings ?? []).map((w) => ({
          category: w.category ?? "unknown",
          description: w.description ?? "",
        })),
        passed: parsed.passed,
      };
    } catch {
      return null;
    }
  }
}

function findVerdictLineIndex(lines: readonly string[]): number {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (/^(PASS|FAIL)$/i.test(lines[index]!)) {
      return index;
    }
  }
  return -1;
}

function extractBalancedJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start < 0) {
    return null;
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  let endIndex = -1;

  for (let index = start; index < text.length; index += 1) {
    const char = text[index]!;

    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{") {
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        endIndex = index;
        break;
      }
      if (depth < 0) {
        return null;
      }
    }
  }

  if (endIndex < 0) return null;

  // Only accept the candidate if what follows the closing brace is
  // nothing, whitespace, or a structural JSON terminator.
  // This rejects trailing content like "{...} more text here"
  const followingChar = text[endIndex + 1];
  if (
    followingChar !== undefined &&
    followingChar !== "\n" &&
    followingChar !== "\r" &&
    followingChar !== "\t" &&
    followingChar !== " " &&
    followingChar !== "," &&
    followingChar !== "]" &&
    followingChar !== "}"
  ) {
    return null;
  }

  return text.slice(start, endIndex + 1);
}
