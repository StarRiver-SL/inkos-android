/**
 * Lightweight token estimation for CJK + non-CJK mixed text.
 * Uses a fast heuristic: CJK chars ≈ 1 char/token, non-CJK ≈ 4 chars/token.
 * This matches the OpenAI tiktoken behavior for mixed-language content
 * without requiring the tiktoken dependency.
 */
export function estimateTokens(text: string): number {
  const cjk = (text.match(/[㐀-鿿]/g) ?? []).length;
  const other = text.length - cjk;
  return Math.max(1, Math.ceil(cjk + other / 4));
}

/**
 * Estimate tokens from pre-counted character breakdown.
 * Useful when you already have totalChars and chineseChars from a streaming API.
 */
export function estimateTokensFromChars(totalChars: number, chineseChars: number): number {
  const total = Math.max(0, totalChars);
  const chinese = Math.max(0, Math.min(total, chineseChars));
  const nonChinese = Math.max(0, total - chinese);
  return Math.max(0, Math.ceil(chinese + nonChinese / 4));
}
