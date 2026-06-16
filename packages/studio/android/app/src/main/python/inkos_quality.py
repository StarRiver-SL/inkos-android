import json
import math
import re
import sys


_AI_TELL_WORDS_ZH = [
    "似乎", "可能", "或许", "也许", "仿佛", "不禁", "居然", "竟然",
    "忽然", "突然", "微微", "轻轻", "缓缓", "淡淡", "默默", "静静",
    "深吸一口气", "嘴角微扬", "眼中闪过", "嘴角勾起",
]

_TRANSITION_WORDS_ZH = [
    "然而", "不过", "可是", "但是", "因此", "所以", "于是", "随后",
    "接着", "随即", "与此同时", "此刻", "此时", "瞬间",
]

_SENSE_WORDS = [
    "看见", "看到", "望着", "盯着", "注视", "目光", "视线", "眼中",
    "听见", "听到", "传来", "响起", "声音", "耳边", "嗓音",
    "触摸", "手感", "冰凉", "滚烫", "温暖", "柔软", "粗糙", "光滑",
    "闻到", "香味", "臭味", "气息", "味道", "气味",
    "尝到", "苦涩", "甘甜", "酸楚", "咸味", "辛辣",
]


def _split_sentences(text):
    parts = re.split(r"(?<=[。！？.!?\n])\s*", text)
    return [s.strip() for s in parts if s.strip()]


def _cv(lengths):
    if len(lengths) < 3:
        return 1.0
    mean = sum(lengths) / len(lengths)
    if mean < 1:
        return 1.0
    variance = sum((x - mean) ** 2 for x in lengths) / len(lengths)
    return math.sqrt(variance) / mean


def _count_pattern(text, patterns):
    count = 0
    for word in patterns:
        count += len(re.findall(re.escape(word), text))
    return count


def analyze_quality(text):
    text = text or ""
    char_count = len(text)
    if char_count < 50:
        return {"ok": False, "error": "Text too short for quality analysis (min 50 chars)."}

    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    sentences = _split_sentences(text)
    para_lengths = [len(p) for p in paragraphs]
    sent_lengths = [len(s) for s in sentences]

    ai_tell_count = _count_pattern(text, _AI_TELL_WORDS_ZH)
    ai_tell_density = round(ai_tell_count / max(1, char_count / 1000), 2)

    para_cv = round(_cv(para_lengths), 3)

    transition_count = _count_pattern(text, _TRANSITION_WORDS_ZH)

    dialogue_lines = len(re.findall(r'[「」""]', text))
    dialogue_ratio = round(dialogue_lines / max(1, len(sentences)), 3)

    sent_cv = round(_cv(sent_lengths), 3)

    sense_count = _count_pattern(text, _SENSE_WORDS)
    sensory_density = round(sense_count / max(1, char_count / 1000), 2)

    ngram_counts = {}
    for i in range(len(text) - 5):
        gram = text[i:i + 6]
        if not gram.isspace():
            ngram_counts[gram] = ngram_counts.get(gram, 0) + 1
    repeated = sum(1 for c in ngram_counts.values() if c > 2)
    repetition_rate = round(repeated / max(1, len(ngram_counts)), 4)

    warnings = []
    if para_cv < 0.15 and len(paragraphs) >= 4:
        warnings.append(f"段落长度过于均匀 (CV={para_cv} < 0.15)，可能是 AI 生成痕迹。")
    if ai_tell_density > 3.0:
        warnings.append(f"AI-tell 词汇密度偏高 ({ai_tell_density}/千字)。")
    if transition_count >= 3:
        top_transitions = []
        for w in _TRANSITION_WORDS_ZH:
            c = len(re.findall(re.escape(w), text))
            if c >= 2:
                top_transitions.append(f"{w}×{c}")
        if top_transitions:
            warnings.append(f"公式化转折词过多 ({', '.join(top_transitions[:3])})。")
    if sent_cv < 0.2 and len(sentences) >= 8:
        warnings.append(f"句子长度过于均匀 (CV={sent_cv})，缺少节奏变化。")
    if dialogue_ratio < 0.05 and char_count > 1000:
        warnings.append(f"对话比例极低 ({dialogue_ratio})，可能缺少对话。")
    if repetition_rate > 0.05:
        warnings.append(f"文本重复率偏高 ({repetition_rate})。")

    score = 100
    if para_cv < 0.15:
        score -= 15
    if ai_tell_density > 3.0:
        score -= min(20, (ai_tell_density - 3.0) * 5)
    if transition_count >= 3:
        score -= min(10, (transition_count - 2) * 3)
    if sent_cv < 0.2:
        score -= 10
    if dialogue_ratio < 0.05 and char_count > 1000:
        score -= 10
    if repetition_rate > 0.05:
        score -= min(15, repetition_rate * 100)
    score = max(0, min(100, round(score)))

    return {
        "ok": True,
        "method": "python:quality",
        "charCount": char_count,
        "paragraphCount": len(paragraphs),
        "sentenceCount": len(sentences),
        "scores": {
            "aiTellDensity": ai_tell_density,
            "paragraphUniformity": para_cv,
            "formulaicTransitions": transition_count,
            "dialogueRatio": dialogue_ratio,
            "sentenceLengthCV": sent_cv,
            "sensoryWordDensity": sensory_density,
            "repetitionRate": repetition_rate,
        },
        "overallScore": score,
        "warnings": warnings,
    }


def quality_json(payload):
    try:
        data = json.loads(payload or "{}")
        text = str(data.get("text") or data.get("content") or "")
        result = analyze_quality(text)
        return json.dumps(result, ensure_ascii=False)
    except Exception as exc:
        return json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False)


if __name__ == "__main__":
    try:
        payload = sys.stdin.read() or "{}"
        print(quality_json(payload))
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
