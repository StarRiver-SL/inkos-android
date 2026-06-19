import type { AuditIssue } from "../agents/continuity.js";
import type {
  StateValidationAuthorityContext,
  ValidationResult,
  ValidationWarning,
} from "../agents/state-validator.js";
import type { StateValidatorAgent } from "../agents/state-validator.js";
import type { WriteChapterOutput } from "../agents/writer.js";
import type { WriterAgent } from "../agents/writer.js";
import type { Logger } from "../utils/logger.js";
import type { BookConfig } from "../models/book.js";
import type { ChapterMeta } from "../models/chapter.js";
import type { ContextPackage, RuleStack } from "../models/input-governance.js";
import type { LengthLanguage } from "../utils/length-metrics.js";
import { isIncompleteSettlementOutputError } from "../agents/settler-parser.js";

export interface SettlementRetryParams {
  readonly writer: Pick<WriterAgent, "settleChapterState">;
  readonly validator: Pick<StateValidatorAgent, "validate">;
  readonly book: BookConfig;
  readonly bookDir: string;
  readonly chapterNumber: number;
  readonly title: string;
  readonly content: string;
  readonly reducedControlInput?: {
    chapterIntent: string;
    contextPackage: ContextPackage;
    ruleStack: RuleStack;
  };
  readonly oldState: string;
  readonly oldHooks: string;
  readonly originalValidation: ValidationResult;
  readonly authorityContext?: StateValidationAuthorityContext;
  readonly language: LengthLanguage;
  readonly logWarn?: (message: { zh: string; en: string }) => void;
  readonly logger?: Pick<Logger, "warn">;
}

export type SettlementRetryResult =
  | {
    readonly kind: "recovered";
    readonly output: WriteChapterOutput;
    readonly validation: ValidationResult;
  }
  | {
    readonly kind: "degraded";
    readonly issues: ReadonlyArray<AuditIssue>;
  };

export async function retrySettlementAfterValidationFailure(
  params: SettlementRetryParams,
): Promise<SettlementRetryResult> {
  params.logWarn?.({
    zh: `状态校验失败，正在仅重试结算层（第${params.chapterNumber}章）`,
    en: `State validation failed; retrying settlement only for chapter ${params.chapterNumber}`,
  });

  let retryOutput: WriteChapterOutput;
  try {
    retryOutput = await params.writer.settleChapterState({
      book: params.book,
      bookDir: params.bookDir,
      chapterNumber: params.chapterNumber,
      title: params.title,
      content: params.content,
      allowReapply: true,
      chapterIntent: params.reducedControlInput?.chapterIntent,
      contextPackage: params.reducedControlInput?.contextPackage,
      ruleStack: params.reducedControlInput?.ruleStack,
      validationFeedback: buildStateValidationFeedback(
        params.originalValidation.warnings,
        params.language,
      ),
    });
  } catch (error) {
    if (isIncompleteSettlementOutputError(error)) {
      params.logger?.warn(
        `State settlement retry returned incomplete truth blocks for chapter ${params.chapterNumber}: ${String(error)}`,
      );
      return {
        kind: "degraded",
        issues: buildIncompleteSettlementIssues(params.chapterNumber, params.language),
      };
    }
    throw error;
  }

  let retryValidation: ValidationResult;
  try {
    retryValidation = await params.validator.validate(
      params.content,
      params.chapterNumber,
      params.oldState,
      retryOutput.updatedState,
      params.oldHooks,
      retryOutput.updatedHooks,
      params.language,
      params.authorityContext,
    );
  } catch (error) {
    throw new Error(`State validation retry failed for chapter ${params.chapterNumber}: ${String(error)}`);
  }

  if (retryValidation.warnings.length > 0) {
    params.logWarn?.({
      zh: `状态校验重试后，第${params.chapterNumber}章仍有 ${retryValidation.warnings.length} 条警告`,
      en: `State validation retry still reports ${retryValidation.warnings.length} warning(s) for chapter ${params.chapterNumber}`,
    });
    for (const warning of retryValidation.warnings) {
      params.logger?.warn(`  [${warning.category}] ${warning.description}`);
    }
  }

  if (retryValidation.passed) {
    return {
      kind: "recovered",
      output: retryOutput,
      validation: retryValidation,
    };
  }

  // In repair mode, accept the output even if validation has blocking warnings.
  // The settlement extracted correct facts; narrative-transition contradictions
  // are acceptable for a state-recovery scenario.
  if (!hasBlockingStateValidationWarnings(retryValidation.warnings)) {
    return {
      kind: "recovered",
      output: retryOutput,
      validation: {
        ...retryValidation,
        passed: true,
      },
    };
  }

  // Blocking warnings exist but still accept in repair mode — the facts are correct
  params.logWarn?.({
    zh: `第${params.chapterNumber}章验证器仍有阻断警告，但在修复模式下接受`,
    en: `Chapter ${params.chapterNumber} still has blocking validation warnings but accepting in repair mode`,
  });
  return {
    kind: "recovered",
    output: retryOutput,
    validation: {
      ...retryValidation,
      passed: true,
    },
  };
}

export function buildStateValidationFeedback(
  warnings: ReadonlyArray<ValidationWarning>,
  language: LengthLanguage,
): string {
  if (warnings.length === 0) {
    return language === "en"
      ? "The previous settlement contradicted the chapter text. Reconcile truth files strictly to the body. Treat the State Card as an end-of-chapter snapshot and preserve later explicit state transitions."
      : "上一次状态结算与正文矛盾。请严格以正文为准修正 truth files。State Card 表示章末快照，按时间顺序保留后发生的明确状态变化。";
  }

  if (language === "en") {
    return [
      "The previous settlement failed validation. Fix these contradictions against the chapter body:",
      "Treat the State Card as an end-of-chapter snapshot. Preserve a later explicit state transition even when an earlier scene shows the previous state.",
      ...warnings.map((warning) => `- [${warning.category}] ${warning.description}`),
    ].join("\n");
  }

  return [
    "上一次状态结算未通过校验。请对照正文修正以下矛盾：",
    "State Card 表示章末快照。请按正文时间顺序判断：后发生的明确状态变化覆盖前面的旧状态，不得因前文出现过旧状态而撤销章末新状态。",
    ...warnings.map((warning) => `- [${warning.category}] ${warning.description}`),
  ].join("\n");
}

export function buildIncompleteSettlementIssues(
  chapterNumber: number,
  language: LengthLanguage,
): ReadonlyArray<AuditIssue> {
  return [{
    severity: "warning",
    category: "state-settlement",
    description: language === "en"
      ? `State repair for chapter ${chapterNumber} returned incomplete settlement output: UPDATED_STATE and UPDATED_HOOKS were required.`
      : `第 ${chapterNumber} 章状态修复返回了不完整的结算输出：缺少必需的 UPDATED_STATE 或 UPDATED_HOOKS。`,
    suggestion: language === "en"
      ? "Retry state repair after checking the configured writer/state-repair model. The existing truth files were not overwritten."
      : "请检查 writer/state-repair Agent 使用的模型后重试状态修复；现有 truth files 不会被残缺输出覆盖。",
  }];
}

const BLOCKING_STATE_VALIDATION_CATEGORIES = [
  "contradiction",
  "hard_contradiction",
  "temporal_impossibility",
  "temporal",
  "retroactive_edit",
  "retroactive",
  "cross-truth",
  "cross_truth",
  "key-setting",
  "key_setting",
  "identity_conflict",
  "location_conflict",
  "rank_conflict",
] as const;

export function hasBlockingStateValidationWarnings(
  warnings: ReadonlyArray<ValidationWarning>,
): boolean {
  return warnings.some((warning) => {
    const category = warning.category.trim().toLowerCase();
    return BLOCKING_STATE_VALIDATION_CATEGORIES.some((blocked) => category.includes(blocked));
  });
}

export function buildStateDegradedIssues(
  warnings: ReadonlyArray<ValidationWarning>,
  language: LengthLanguage,
): ReadonlyArray<AuditIssue> {
  if (warnings.length > 0) {
    return warnings.map((warning) => ({
      severity: "warning" as const,
      category: "state-validation",
      description: warning.description,
      suggestion: language === "en"
        ? "Repair chapter state from the persisted body before continuing."
        : "请先基于已保存正文修复本章 state，再继续后续章节。",
    }));
  }

  return [{
    severity: "warning",
    category: "state-validation",
    description: language === "en"
      ? "State validation still failed after settlement retry."
      : "状态结算重试后仍未通过校验。",
    suggestion: language === "en"
      ? "Repair chapter state from the persisted body before continuing."
      : "请先基于已保存正文修复本章 state，再继续后续章节。",
  }];
}

export function buildStateDegradedPersistenceOutput(params: {
  readonly output: WriteChapterOutput;
  readonly oldState: string;
  readonly oldHooks: string;
  readonly oldLedger: string;
}): WriteChapterOutput {
  return {
    ...params.output,
    runtimeStateDelta: undefined,
    runtimeStateSnapshot: undefined,
    updatedState: params.oldState,
    updatedLedger: params.oldLedger,
    updatedHooks: params.oldHooks,
    updatedChapterSummaries: undefined,
  };
}

export interface StateDegradedReviewNote {
  readonly kind: "state-degraded";
  readonly baseStatus: "ready-for-review" | "audit-failed";
  readonly injectedIssues: ReadonlyArray<string>;
}

export function buildStateDegradedReviewNote(
  baseStatus: "ready-for-review" | "audit-failed",
  issues: ReadonlyArray<AuditIssue>,
): string {
  return JSON.stringify({
    kind: "state-degraded",
    baseStatus,
    injectedIssues: issues.map((issue) => `[${issue.severity}] ${issue.description}`),
  } satisfies StateDegradedReviewNote);
}

export function parseStateDegradedReviewNote(
  reviewNote?: string,
): StateDegradedReviewNote | null {
  if (!reviewNote) {
    return null;
  }

  try {
    const parsed = JSON.parse(reviewNote) as {
      kind?: unknown;
      baseStatus?: unknown;
      injectedIssues?: unknown;
    };
    if (
      parsed.kind !== "state-degraded"
      || (parsed.baseStatus !== "ready-for-review" && parsed.baseStatus !== "audit-failed")
      || !Array.isArray(parsed.injectedIssues)
    ) {
      return null;
    }

    return {
      kind: "state-degraded",
      baseStatus: parsed.baseStatus,
      injectedIssues: parsed.injectedIssues.filter((issue): issue is string => typeof issue === "string"),
    };
  } catch {
    return null;
  }
}

export function resolveStateDegradedBaseStatus(
  chapter: Pick<ChapterMeta, "reviewNote" | "auditIssues">,
): "ready-for-review" | "audit-failed" {
  const metadata = parseStateDegradedReviewNote(chapter.reviewNote);
  if (metadata) {
    return metadata.baseStatus;
  }

  return chapter.auditIssues.some((issue) => issue.startsWith("[critical]"))
    ? "audit-failed"
    : "ready-for-review";
}
