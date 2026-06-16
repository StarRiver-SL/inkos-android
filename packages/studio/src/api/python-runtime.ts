import { spawn } from "node:child_process";

export interface PythonRuntimeStatus {
  readonly available: boolean;
  readonly command: string | null;
  readonly version: string | null;
  readonly platform: NodeJS.Platform;
  readonly arch: string;
  readonly android: boolean;
  readonly lastError: string | null;
  readonly capabilities: readonly string[];
}

export interface PythonExtractResult {
  readonly ok: boolean;
  readonly text: string;
  readonly method: string;
  readonly warnings: readonly string[];
}

export interface PythonHeadroomResult {
  readonly ok: boolean;
  readonly compressed: string;
  readonly hash?: string;
  readonly originalTokens?: number;
  readonly compressedTokens?: number;
  readonly savingsPercent?: number;
  readonly transforms: readonly string[];
  readonly warnings: readonly string[];
}

export interface MaintenanceIssue {
  readonly severity: "info" | "warning" | "danger";
  readonly category: string;
  readonly path: string;
  readonly message: string;
}

export interface MaintenanceFileInfo {
  readonly path: string;
  readonly bytes: number;
}

export interface MaintenanceSection {
  readonly name: string;
  readonly path: string;
  readonly exists: boolean;
  readonly fileCount: number;
  readonly dirCount: number;
  readonly totalBytes: number;
  readonly largestFiles: readonly MaintenanceFileInfo[];
  readonly invalidFiles: readonly unknown[];
  readonly candidateCleanupFiles: readonly MaintenanceFileInfo[];
  readonly knowledge?: {
    readonly libraryCount: number;
    readonly sourceCount: number;
    readonly chunkCount: number;
    readonly missingSearchIndexes: readonly string[];
    readonly orphanChunkSources: readonly unknown[];
    readonly sourceChunkMismatches: readonly unknown[];
  };
}

export interface MaintenanceScanResult {
  readonly ok: boolean;
  readonly method: string;
  readonly error?: string;
  readonly summary: {
    readonly root: string;
    readonly totalFiles: number;
    readonly totalBytes: number;
    readonly durationMs: number;
    readonly issueCount: number;
    readonly scannedAt: number;
  };
  readonly sections: {
    readonly books: MaintenanceSection;
    readonly worlds: MaintenanceSection;
    readonly knowledge: MaintenanceSection;
    readonly logs: MaintenanceSection;
    readonly runtime: MaintenanceSection;
  };
  readonly duplicates: readonly unknown[];
  readonly issues: readonly MaintenanceIssue[];
  readonly recommendations: ReadonlyArray<{
    readonly title: string;
    readonly detail: string;
    readonly severity: "info" | "warning" | "danger";
  }>;
}

const PYTHON_COMMANDS = ["python3", "python", "py"] as const;
const PYTHON_TIMEOUT_MS = 12_000;
const PYTHON_MAINTENANCE_TIMEOUT_MS = 30_000;
const ANDROID_BRIDGE_TIMEOUT_MS = 15_000;

const EXTRACT_SCRIPT = String.raw`
import base64
import csv
import html
import io
import json
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

def clean(text):
    text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
    text = re.sub(r"[ \t]+\n", "\n", text)
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    return text.strip()

def extract_docx(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        names = [name for name in zf.namelist() if name.startswith("word/") and name.endswith(".xml")]
        preferred = ["word/document.xml"] + [name for name in names if name != "word/document.xml"]
        parts = []
        ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
        for name in preferred:
            if name not in names and name != "word/document.xml":
                continue
            try:
                root = ET.fromstring(zf.read(name))
            except Exception:
                continue
            for paragraph in root.findall(".//w:p", ns):
                texts = [node.text or "" for node in paragraph.findall(".//w:t", ns)]
                line = "".join(texts).strip()
                if line:
                    parts.append(line)
        return clean("\n\n".join(parts))

def extract_pdf(raw):
    try:
        from pypdf import PdfReader
    except Exception as exc:
        raise RuntimeError("PDF extraction requires optional Python package pypdf") from exc
    reader = PdfReader(io.BytesIO(raw))
    pages = []
    for page in reader.pages:
        pages.append(page.extract_text() or "")
    return clean("\n\n".join(pages))

def extract_json(raw):
    text = raw.decode("utf-8", errors="replace")
    data = json.loads(text)
    return clean(json.dumps(data, ensure_ascii=False, indent=2))

def extract_csv(raw):
    text = raw.decode("utf-8-sig", errors="replace")
    rows = []
    for row in csv.reader(io.StringIO(text)):
        rows.append(" | ".join(cell.strip() for cell in row))
    return clean("\n".join(rows))

def extract_html(raw):
    text = raw.decode("utf-8", errors="replace")
    text = re.sub(r"<(script|style)[\s\S]*?</\1>", " ", text, flags=re.I)
    text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
    text = re.sub(r"</p\s*>", "\n\n", text, flags=re.I)
    text = re.sub(r"<[^>]+>", " ", text)
    return clean(html.unescape(text))

def extract_epub(raw):
    parts = []
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        content_files = sorted(
            name for name in zf.namelist()
            if name.endswith((".html", ".htm", ".xhtml"))
            and not name.startswith("META-INF/"))
        for name in content_files:
            try:
                data = zf.read(name)
                text = data.decode("utf-8", errors="replace")
                text = re.sub(r"<(script|style)[\s\S]*?</\1>", " ", text, flags=re.I)
                text = re.sub(r"<br\s*/?>", "\n", text, flags=re.I)
                text = re.sub(r"</p\s*>", "\n\n", text, flags=re.I)
                text = re.sub(r"<[^>]+>", " ", text)
                text = clean(html.unescape(text))
                if text and len(text) > 20:
                    parts.append(text)
            except Exception:
                continue
    return clean("\n\n".join(parts))

def extract_xlsx(raw):
    rows = []
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        shared = []
        try:
            tree = ET.fromstring(zf.read("xl/sharedStrings.xml"))
            ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
            for si in tree.findall(".//s:si", ns):
                texts = [t.text or "" for t in si.findall(".//s:t", ns)]
                shared.append("".join(texts))
        except (KeyError, Exception):
            pass
        sheet_files = sorted(
            name for name in zf.namelist()
            if name.startswith("xl/worksheets/sheet") and name.endswith(".xml"))
        ns = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        for sheet_name in sheet_files:
            try:
                tree = ET.fromstring(zf.read(sheet_name))
                for row in tree.findall(".//s:row", ns):
                    cells = []
                    for c in row.findall("s:c", ns):
                        v = c.find("s:v", ns)
                        val = v.text if v is not None and v.text else ""
                        if c.get("t") == "s" and val.isdigit():
                            idx = int(val)
                            val = shared[idx] if idx < len(shared) else val
                        cells.append(val.strip())
                    if any(cells):
                        rows.append(" | ".join(cells))
            except Exception:
                continue
    return clean("\n".join(rows))

def extract_pptx(raw):
    slides = []
    with zipfile.ZipFile(io.BytesIO(raw)) as zf:
        slide_files = sorted(
            name for name in zf.namelist()
            if name.startswith("ppt/slides/slide") and name.endswith(".xml"))
        ns = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}
        for slide_name in slide_files:
            try:
                tree = ET.fromstring(zf.read(slide_name))
                texts = []
                for t in tree.findall(".//a:t", ns):
                    if t.text:
                        texts.append(t.text)
                slide_text = "\n".join(texts).strip()
                if slide_text:
                    slides.append(slide_text)
            except Exception:
                continue
    return clean("\n\n".join(slides))

def main():
    payload = json.loads(sys.stdin.read() or "{}")
    name = str(payload.get("name") or "source")
    raw = base64.b64decode(payload.get("base64") or "")
    lower = name.lower()
    warnings = []
    method = "python:text"
    try:
        if lower.endswith(".docx"):
            text = extract_docx(raw)
            method = "python:docx"
        elif lower.endswith(".pdf"):
            text = extract_pdf(raw)
            method = "python:pdf"
        elif lower.endswith(".json"):
            text = extract_json(raw)
            method = "python:json"
        elif lower.endswith(".csv") or lower.endswith(".tsv"):
            text = extract_csv(raw)
            method = "python:csv"
        elif lower.endswith(".html") or lower.endswith(".htm"):
            text = extract_html(raw)
            method = "python:html"
        elif lower.endswith(".epub"):
            text = extract_epub(raw)
            method = "python:epub"
        elif lower.endswith(".xlsx") or lower.endswith(".xls"):
            text = extract_xlsx(raw)
            method = "python:xlsx"
        elif lower.endswith(".pptx"):
            text = extract_pptx(raw)
            method = "python:pptx"
        else:
            text = clean(raw.decode("utf-8-sig", errors="replace"))
        if not text:
            warnings.append("No text extracted from file.")
        print(json.dumps({"ok": bool(text), "text": text, "method": method, "warnings": warnings}, ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({"ok": False, "text": "", "method": method, "warnings": [str(exc)]}, ensure_ascii=False))

if __name__ == "__main__":
    main()
`;

const MAINTENANCE_SCRIPT = String.raw`
import hashlib
import json
import os
import time
import sys

TARGET_DIRS = ["books", "worlds", "knowledge", "logs", ".inkos"]
MAX_LARGEST_FILES = 12
MAX_ISSUES = 200
MAX_DUPLICATES = 30
LARGE_FILE_BYTES = 5 * 1024 * 1024
LARGE_DIR_BYTES = 80 * 1024 * 1024

def now_ms():
    return int(time.time() * 1000)

def rel(root, path):
    try:
        return os.path.relpath(path, root).replace("\\", "/")
    except Exception:
        return path

def issue(severity, category, path, message):
    return {"severity": severity, "category": category, "path": path, "message": message}

def read_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)

def sample_hash(path, size):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        if size <= 256 * 1024:
            digest.update(handle.read())
        else:
            digest.update(handle.read(128 * 1024))
            handle.seek(max(0, size - 128 * 1024))
            digest.update(handle.read(128 * 1024))
    return digest.hexdigest()

def validate_jsonl(path):
    rows = []
    with open(path, "r", encoding="utf-8") as handle:
        for index, line in enumerate(handle, start=1):
            text = line.strip()
            if not text:
                continue
            try:
                json.loads(text)
            except Exception as exc:
                rows.append({"line": index, "error": str(exc)[:160]})
                if len(rows) >= 8:
                    break
    return rows

def empty_section(name, path):
    return {
        "name": name,
        "path": path,
        "exists": False,
        "fileCount": 0,
        "dirCount": 0,
        "totalBytes": 0,
        "largestFiles": [],
        "invalidFiles": [],
        "candidateCleanupFiles": [],
    }

def scan_section(root, name, path, issues):
    section = empty_section(name, path)
    if not os.path.isdir(path):
        issues.append(issue("info", "missing-directory", name, "Directory does not exist yet."))
        return section, {}
    section["exists"] = True
    largest = []
    invalid = []
    cleanup = []
    size_groups = {}
    for dirpath, dirnames, filenames in os.walk(path):
        section["dirCount"] += len(dirnames)
        for filename in filenames:
            full = os.path.join(dirpath, filename)
            path_rel = rel(root, full)
            try:
                stat = os.stat(full)
            except OSError as exc:
                issues.append(issue("warning", "unreadable-file", path_rel, str(exc)))
                continue
            size = int(stat.st_size)
            section["fileCount"] += 1
            section["totalBytes"] += size
            largest.append({"path": path_rel, "bytes": size})
            if size >= LARGE_FILE_BYTES:
                issues.append(issue("warning", "large-file", path_rel, "Large file may slow sync or backup."))
            lower = filename.lower()
            if lower.endswith(".json"):
                try:
                    read_json(full)
                except Exception as exc:
                    invalid.append({"path": path_rel, "kind": "json", "message": str(exc)[:200]})
                    issues.append(issue("danger", "invalid-json", path_rel, str(exc)[:200]))
            elif lower.endswith(".jsonl"):
                rows = validate_jsonl(full)
                if rows:
                    invalid.append({"path": path_rel, "kind": "jsonl", "rows": rows})
                    issues.append(issue("warning", "invalid-jsonl", path_rel, "Some JSONL rows are invalid."))
            if name == "logs" and (lower.endswith(".log") or lower.endswith(".txt")) and size > 1024 * 1024:
                cleanup.append({"path": path_rel, "bytes": size, "reason": "large-log"})
            if size > 0:
                size_groups.setdefault(size, []).append(full)
    largest.sort(key=lambda item: item["bytes"], reverse=True)
    section["largestFiles"] = largest[:MAX_LARGEST_FILES]
    section["invalidFiles"] = invalid[:MAX_ISSUES]
    section["candidateCleanupFiles"] = cleanup[:MAX_LARGEST_FILES]
    if section["totalBytes"] >= LARGE_DIR_BYTES:
        issues.append(issue("warning", "large-directory", name, "Directory is large; consider reviewing generated files."))
    return section, size_groups

def scan_duplicates(root, size_groups, issues):
    duplicates = []
    for size, paths in size_groups.items():
        if len(paths) < 2 or size == 0:
            continue
        hash_groups = {}
        for path in paths[:40]:
            try:
                key = sample_hash(path, size)
            except OSError:
                continue
            hash_groups.setdefault(key, []).append(path)
        for digest, group in hash_groups.items():
            if len(group) < 2:
                continue
            item = {"hash": digest[:16], "bytes": size, "paths": [rel(root, p) for p in group[:8]]}
            duplicates.append(item)
            issues.append(issue("info", "duplicate-file", item["paths"][0], "Potential duplicate file detected."))
            if len(duplicates) >= MAX_DUPLICATES:
                return duplicates
    return duplicates

def scan_knowledge(root, section, issues):
    knowledge_root = os.path.join(root, "knowledge")
    status = {
        "libraryCount": 0,
        "sourceCount": 0,
        "chunkCount": 0,
        "missingSearchIndexes": [],
        "orphanChunkSources": [],
        "sourceChunkMismatches": [],
    }
    if not os.path.isdir(knowledge_root):
        section["knowledge"] = status
        return
    for dirpath, _dirnames, filenames in os.walk(knowledge_root):
        if "sources.json" not in filenames and "chunks.json" not in filenames:
            continue
        status["libraryCount"] += 1
        dir_rel = rel(root, dirpath)
        try:
            sources = read_json(os.path.join(dirpath, "sources.json")) if "sources.json" in filenames else []
            chunks = read_json(os.path.join(dirpath, "chunks.json")) if "chunks.json" in filenames else []
        except Exception as exc:
            issues.append(issue("danger", "knowledge-index-invalid", dir_rel, str(exc)[:200]))
            continue
        if not isinstance(sources, list):
            sources = []
        if not isinstance(chunks, list):
            chunks = []
        status["sourceCount"] += len(sources)
        status["chunkCount"] += len(chunks)
        if "search-index.json" not in filenames:
            status["missingSearchIndexes"].append(dir_rel)
            issues.append(issue("warning", "knowledge-search-index-missing", dir_rel, "Knowledge search-index.json is missing."))
        source_ids = {str(source.get("id")) for source in sources if isinstance(source, dict)}
        chunk_counts = {}
        for chunk in chunks:
            if not isinstance(chunk, dict):
                continue
            source_id = str(chunk.get("sourceId"))
            chunk_counts[source_id] = chunk_counts.get(source_id, 0) + 1
            if source_id not in source_ids:
                status["orphanChunkSources"].append({"library": dir_rel, "sourceId": source_id})
                issues.append(issue("warning", "knowledge-orphan-chunk-source", dir_rel, "Chunk references a missing sourceId."))
        for source in sources:
            if not isinstance(source, dict):
                continue
            source_id = str(source.get("id"))
            expected = int(source.get("chunkCount") or 0)
            actual = chunk_counts.get(source_id, 0)
            if expected != actual:
                status["sourceChunkMismatches"].append({"library": dir_rel, "sourceId": source_id, "expected": expected, "actual": actual})
                issues.append(issue("warning", "knowledge-chunk-mismatch", dir_rel, "Source chunkCount does not match chunks.json."))
    section["knowledge"] = status

def scan_project(root):
    started = now_ms()
    root = os.path.abspath(str(root or "."))
    issues = []
    sections = {}
    merged_size_groups = {}
    for name in TARGET_DIRS:
        path = os.path.abspath(os.path.join(root, name))
        root_abs = os.path.abspath(root)
        if path != root_abs and not path.startswith(root_abs + os.sep):
            raise ValueError("Path escapes project root: " + name)
        section, size_groups = scan_section(root, name, path, issues)
        sections[name.replace(".", "runtime")] = section
        for size, paths in size_groups.items():
            merged_size_groups.setdefault(size, []).extend(paths)
    scan_knowledge(root, sections["knowledge"], issues)
    duplicates = scan_duplicates(root, merged_size_groups, issues)
    issues = issues[:MAX_ISSUES]
    recommendations = []
    if sections["logs"]["candidateCleanupFiles"]:
        recommendations.append({"title": "Review large logs", "detail": "Large log files can be cleaned in a future confirmed repair flow.", "severity": "info"})
    knowledge_status = sections["knowledge"].get("knowledge", {})
    if knowledge_status.get("missingSearchIndexes") or knowledge_status.get("sourceChunkMismatches") or knowledge_status.get("orphanChunkSources"):
        recommendations.append({"title": "Rebuild knowledge indexes", "detail": "Some knowledge libraries have missing or inconsistent indexes.", "severity": "warning"})
    if duplicates:
        recommendations.append({"title": "Review duplicate files", "detail": "Potential duplicates were detected. No files were changed.", "severity": "info"})
    return {
        "ok": True,
        "method": "python:maintenance",
        "summary": {
            "root": root,
            "totalFiles": sum(section["fileCount"] for section in sections.values()),
            "totalBytes": sum(section["totalBytes"] for section in sections.values()),
            "durationMs": now_ms() - started,
            "issueCount": len(issues),
            "scannedAt": now_ms(),
        },
        "sections": sections,
        "duplicates": duplicates,
        "issues": issues,
        "recommendations": recommendations,
    }

def main():
    payload = json.loads(sys.stdin.read() or "{}")
    print(json.dumps(scan_project(payload.get("root") or "."), ensure_ascii=False))

if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(json.dumps({"ok": False, "method": "python:maintenance", "error": str(exc)}, ensure_ascii=False))
`;

const QUALITY_SCRIPT = String.raw`
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

def main():
    payload = json.loads(sys.stdin.read() or "{}")
    text = str(payload.get("text") or payload.get("content") or "")
    char_count = len(text)
    if char_count < 50:
        print(json.dumps({"ok": False, "error": "Text too short for quality analysis (min 50 chars)."}, ensure_ascii=False))
        return
    paragraphs = [p.strip() for p in text.split("\n\n") if p.strip()]
    sentences = [s.strip() for s in re.split(r"(?<=[。！？.!?\n])\s*", text) if s.strip()]
    para_lengths = [len(p) for p in paragraphs]
    sent_lengths = [len(s) for s in sentences]
    ai_tell_count = _count_pattern(text, _AI_TELL_WORDS_ZH)
    ai_tell_density = round(ai_tell_count / max(1, char_count / 1000), 2)
    para_cv = round(_cv(para_lengths), 3)
    transition_count = _count_pattern(text, _TRANSITION_WORDS_ZH)
    dialogue_lines = len(re.findall(r'[""「」]', text))
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
        warnings.append(f"公式化转折词过多 (共{transition_count}次)。")
    if sent_cv < 0.2 and len(sentences) >= 8:
        warnings.append(f"句子长度过于均匀 (CV={sent_cv})，缺少节奏变化。")
    if dialogue_ratio < 0.05 and char_count > 1000:
        warnings.append(f"对话比例极低 ({dialogue_ratio})，可能缺少对话。")
    if repetition_rate > 0.05:
        warnings.append(f"文本重复率偏高 ({repetition_rate})。")
    score = 100
    if para_cv < 0.15: score -= 15
    if ai_tell_density > 3.0: score -= min(20, (ai_tell_density - 3.0) * 5)
    if transition_count >= 3: score -= min(10, (transition_count - 2) * 3)
    if sent_cv < 0.2: score -= 10
    if dialogue_ratio < 0.05 and char_count > 1000: score -= 10
    if repetition_rate > 0.05: score -= min(15, repetition_rate * 100)
    score = max(0, min(100, round(score)))
    print(json.dumps({
        "ok": True, "method": "python:quality", "charCount": char_count,
        "paragraphCount": len(paragraphs), "sentenceCount": len(sentences),
        "scores": {
            "aiTellDensity": ai_tell_density, "paragraphUniformity": para_cv,
            "formulaicTransitions": transition_count, "dialogueRatio": dialogue_ratio,
            "sentenceLengthCV": sent_cv, "sensoryWordDensity": sensory_density,
            "repetitionRate": repetition_rate,
        },
        "overallScore": score, "warnings": warnings,
    }, ensure_ascii=False))

if __name__ == "__main__":
    main()
`;

let cachedStatus: PythonRuntimeStatus | null = null;

export async function detectPythonRuntime(force = false): Promise<PythonRuntimeStatus> {
  if (cachedStatus && !force) return cachedStatus;
  const bridge = await probeAndroidPythonBridge();
  if (bridge) {
    cachedStatus = bridge;
    return cachedStatus;
  }
  const commands = configuredPythonCommands();
  for (const command of commands) {
    const probe = await runPython(command, ["--version"], "", 4_000);
    if (probe.ok) {
      cachedStatus = {
        available: true,
        command,
        version: probe.output.trim() || null,
        platform: process.platform,
        arch: process.arch,
        android: process.env.INKOS_ANDROID === "1",
        lastError: null,
        capabilities: ["text", "markdown", "json", "csv", "html", "docx", "epub", "xlsx", "pptx", "quality-analysis", "pdf-if-pypdf-installed"],
      };
      return cachedStatus;
    }
  }
  cachedStatus = {
    available: false,
    command: null,
    version: null,
    platform: process.platform,
    arch: process.arch,
    android: process.env.INKOS_ANDROID === "1",
    lastError: "Python command not found. Tried: " + commands.join(", "),
    capabilities: [],
  };
  return cachedStatus;
}

export async function extractTextWithPython(input: {
  readonly name: string;
  readonly base64: string;
}): Promise<PythonExtractResult | null> {
  const status = await detectPythonRuntime();
  if (!status.available || !status.command) return null;
  if (status.command === "android-chaquopy") {
    const result = await extractWithAndroidPythonBridge(input);
    if (result) return result;
    cachedStatus = { ...status, available: false, lastError: "Android Python bridge request failed." };
    return {
      ok: false,
      text: "",
      method: "android-python:error",
      warnings: [cachedStatus.lastError ?? "Android Python bridge request failed."],
    };
  }
  const payload = JSON.stringify({ name: input.name, base64: input.base64 });
  const result = await runPython(status.command, ["-c", EXTRACT_SCRIPT], payload, PYTHON_TIMEOUT_MS);
  if (!result.ok) {
    cachedStatus = { ...status, lastError: result.error || result.output || "Python extraction failed." };
    return {
      ok: false,
      text: "",
      method: "python:error",
      warnings: [cachedStatus.lastError ?? "Python extraction failed."],
    };
  }
  try {
    const parsed = JSON.parse(result.output) as Partial<PythonExtractResult>;
    return {
      ok: Boolean(parsed.ok),
      text: typeof parsed.text === "string" ? parsed.text : "",
      method: typeof parsed.method === "string" ? parsed.method : "python",
      warnings: Array.isArray(parsed.warnings) ? parsed.warnings.map(String) : [],
    };
  } catch {
    return { ok: false, text: "", method: "python:parse-error", warnings: [result.output.slice(0, 500)] };
  }
}

export async function compressHeadroomWithPython(content: string): Promise<PythonHeadroomResult | null> {
  const status = await detectPythonRuntime();
  if (!status.available || status.command !== "android-chaquopy") return null;
  const bridgeUrl = androidPythonBridgeUrl();
  if (!bridgeUrl) return null;
  try {
    const parsed = await fetchJsonWithTimeout(`${bridgeUrl}/headroom`, {
      method: "POST",
      body: JSON.stringify({ content }),
      timeoutMs: ANDROID_BRIDGE_TIMEOUT_MS,
    }) as Partial<{
      ok: boolean;
      compressed: string;
      hash: string;
      original_tokens: number;
      compressed_tokens: number;
      savings_percent: number;
      transforms: string[];
      error: string;
      warnings: string[];
    }>;
    return {
      ok: Boolean(parsed.ok),
      compressed: typeof parsed.compressed === "string" ? parsed.compressed : "",
      ...(typeof parsed.hash === "string" && parsed.hash ? { hash: parsed.hash } : {}),
      ...(Number.isFinite(parsed.original_tokens) ? { originalTokens: Number(parsed.original_tokens) } : {}),
      ...(Number.isFinite(parsed.compressed_tokens) ? { compressedTokens: Number(parsed.compressed_tokens) } : {}),
      ...(Number.isFinite(parsed.savings_percent) ? { savingsPercent: Number(parsed.savings_percent) } : {}),
      transforms: Array.isArray(parsed.transforms) ? parsed.transforms.map(String) : ["android-python-headroom"],
      warnings: Array.isArray(parsed.warnings)
        ? parsed.warnings.map(String)
        : (parsed.error ? [String(parsed.error)] : []),
    };
  } catch (error) {
    cachedStatus = { ...status, lastError: error instanceof Error ? error.message : String(error) };
    return null;
  }
}

export interface PythonQualityResult {
  readonly ok: boolean;
  readonly method: string;
  readonly charCount?: number;
  readonly paragraphCount?: number;
  readonly sentenceCount?: number;
  readonly scores?: {
    readonly aiTellDensity: number;
    readonly paragraphUniformity: number;
    readonly formulaicTransitions: number;
    readonly dialogueRatio: number;
    readonly sentenceLengthCV: number;
    readonly sensoryWordDensity: number;
    readonly repetitionRate: number;
  };
  readonly overallScore?: number;
  readonly warnings?: readonly string[];
  readonly error?: string;
}

export async function analyzeTextQuality(text: string): Promise<PythonQualityResult | null> {
  const status = await detectPythonRuntime();
  if (!status.available || !status.command) return null;
  if (status.command === "android-chaquopy") {
    const bridgeUrl = androidPythonBridgeUrl();
    if (!bridgeUrl) return null;
    try {
      const parsed = await fetchJsonWithTimeout(`${bridgeUrl}/quality`, {
        method: "POST",
        body: JSON.stringify({ text }),
        timeoutMs: ANDROID_BRIDGE_TIMEOUT_MS,
      }) as Partial<PythonQualityResult>;
      return {
        ok: Boolean(parsed.ok),
        method: typeof parsed.method === "string" ? parsed.method : "android-python:quality",
        ...(parsed.charCount !== undefined ? { charCount: parsed.charCount } : {}),
        ...(parsed.paragraphCount !== undefined ? { paragraphCount: parsed.paragraphCount } : {}),
        ...(parsed.sentenceCount !== undefined ? { sentenceCount: parsed.sentenceCount } : {}),
        ...(parsed.scores ? { scores: parsed.scores } : {}),
        ...(parsed.overallScore !== undefined ? { overallScore: parsed.overallScore } : {}),
        ...(parsed.warnings ? { warnings: parsed.warnings } : {}),
        ...(parsed.error ? { error: parsed.error } : {}),
      };
    } catch (error) {
      cachedStatus = { ...status, lastError: error instanceof Error ? error.message : String(error) };
      return null;
    }
  }
  const result = await runPython(status.command, ["-c", QUALITY_SCRIPT], JSON.stringify({ text }), PYTHON_TIMEOUT_MS);
  if (!result.ok) {
    cachedStatus = { ...status, lastError: result.error || result.output || "Python quality analysis failed." };
    return null;
  }
  try {
    const parsed = JSON.parse(result.output) as Partial<PythonQualityResult>;
    return {
      ok: Boolean(parsed.ok),
      method: typeof parsed.method === "string" ? parsed.method : "python:quality",
      ...(parsed.charCount !== undefined ? { charCount: parsed.charCount } : {}),
      ...(parsed.paragraphCount !== undefined ? { paragraphCount: parsed.paragraphCount } : {}),
      ...(parsed.sentenceCount !== undefined ? { sentenceCount: parsed.sentenceCount } : {}),
      ...(parsed.scores ? { scores: parsed.scores } : {}),
      ...(parsed.overallScore !== undefined ? { overallScore: parsed.overallScore } : {}),
      ...(parsed.warnings ? { warnings: parsed.warnings } : {}),
      ...(parsed.error ? { error: parsed.error } : {}),
    };
  } catch {
    return { ok: false, method: "python:quality-parse-error", error: result.output.slice(0, 500) };
  }
}

export async function runMaintenanceScan(root: string): Promise<MaintenanceScanResult> {
  const status = await detectPythonRuntime();
  const fallback = (error: string): MaintenanceScanResult => ({
    ok: false,
    method: "python:maintenance-unavailable",
    error,
    summary: {
      root,
      totalFiles: 0,
      totalBytes: 0,
      durationMs: 0,
      issueCount: 1,
      scannedAt: Date.now(),
    },
    sections: {
      books: emptyMaintenanceSection("books", `${root}/books`),
      worlds: emptyMaintenanceSection("worlds", `${root}/worlds`),
      knowledge: emptyMaintenanceSection("knowledge", `${root}/knowledge`),
      logs: emptyMaintenanceSection("logs", `${root}/logs`),
      runtime: emptyMaintenanceSection(".inkos", `${root}/.inkos`),
    },
    duplicates: [],
    issues: [{
      severity: "warning",
      category: "python-unavailable",
      path: root,
      message: error,
    }],
    recommendations: [{
      title: "Python runtime unavailable",
      detail: "Project health scan needs the embedded Android Python bridge or a desktop Python command.",
      severity: "warning",
    }],
  });
  if (!status.available || !status.command) {
    return fallback(status.lastError ?? "Python runtime is unavailable.");
  }
  if (status.command === "android-chaquopy") {
    const bridgeUrl = androidPythonBridgeUrl();
    if (!bridgeUrl) return fallback("Android Python bridge URL is not configured.");
    try {
      const parsed = await fetchJsonWithTimeout(`${bridgeUrl}/maintenance`, {
        method: "POST",
        body: JSON.stringify({ root }),
        timeoutMs: PYTHON_MAINTENANCE_TIMEOUT_MS,
      }) as Partial<MaintenanceScanResult & { error?: string }>;
      return normalizeMaintenanceResult(parsed, root, parsed.error);
    } catch (error) {
      cachedStatus = { ...status, lastError: error instanceof Error ? error.message : String(error) };
      return fallback(cachedStatus.lastError ?? "Android Python maintenance scan failed.");
    }
  }
  const result = await runPython(status.command, ["-c", MAINTENANCE_SCRIPT], JSON.stringify({ root }), PYTHON_MAINTENANCE_TIMEOUT_MS);
  if (!result.ok) {
    cachedStatus = { ...status, lastError: result.error || result.output || "Python maintenance scan failed." };
    return fallback(cachedStatus.lastError ?? "Python maintenance scan failed.");
  }
  try {
    const parsed = JSON.parse(result.output) as Partial<MaintenanceScanResult & { error?: string }>;
    return normalizeMaintenanceResult(parsed, root, parsed.error);
  } catch {
    return fallback(`Unable to parse Python maintenance output: ${result.output.slice(0, 240)}`);
  }
}

function configuredPythonCommands(): string[] {
  const configured = String(process.env.INKOS_PYTHON_COMMAND ?? "").trim();
  return configured ? [configured, ...PYTHON_COMMANDS.filter((item) => item !== configured)] : [...PYTHON_COMMANDS];
}

function emptyMaintenanceSection(name: string, path: string): MaintenanceSection {
  return {
    name,
    path,
    exists: false,
    fileCount: 0,
    dirCount: 0,
    totalBytes: 0,
    largestFiles: [],
    invalidFiles: [],
    candidateCleanupFiles: [],
  };
}

function normalizeMaintenanceResult(
  value: Partial<MaintenanceScanResult & { error?: string }>,
  root: string,
  error?: string,
): MaintenanceScanResult {
  const sections = value.sections ?? {} as Partial<MaintenanceScanResult["sections"]>;
  const issues = Array.isArray(value.issues) ? value.issues : [];
  return {
    ok: Boolean(value.ok),
    method: typeof value.method === "string" ? value.method : "python:maintenance",
    ...(error ? { error } : {}),
    summary: {
      root: typeof value.summary?.root === "string" ? value.summary.root : root,
      totalFiles: Number(value.summary?.totalFiles ?? 0),
      totalBytes: Number(value.summary?.totalBytes ?? 0),
      durationMs: Number(value.summary?.durationMs ?? 0),
      issueCount: Number(value.summary?.issueCount ?? issues.length),
      scannedAt: Number(value.summary?.scannedAt ?? Date.now()),
    },
    sections: {
      books: normalizeMaintenanceSection(sections.books, "books", `${root}/books`),
      worlds: normalizeMaintenanceSection(sections.worlds, "worlds", `${root}/worlds`),
      knowledge: normalizeMaintenanceSection(sections.knowledge, "knowledge", `${root}/knowledge`),
      logs: normalizeMaintenanceSection(sections.logs, "logs", `${root}/logs`),
      runtime: normalizeMaintenanceSection(sections.runtime, ".inkos", `${root}/.inkos`),
    },
    duplicates: Array.isArray(value.duplicates) ? value.duplicates : [],
    issues: issues.map(normalizeMaintenanceIssue),
    recommendations: Array.isArray(value.recommendations)
      ? value.recommendations.map((item) => ({
          title: String(item.title ?? "Review project"),
          detail: String(item.detail ?? ""),
          severity: normalizeSeverity(item.severity),
        }))
      : [],
  };
}

function normalizeMaintenanceSection(value: unknown, name: string, path: string): MaintenanceSection {
  if (!value || typeof value !== "object") return emptyMaintenanceSection(name, path);
  const record = value as Record<string, unknown>;
  return {
    name: typeof record.name === "string" ? record.name : name,
    path: typeof record.path === "string" ? record.path : path,
    exists: Boolean(record.exists),
    fileCount: Number(record.fileCount ?? 0),
    dirCount: Number(record.dirCount ?? 0),
    totalBytes: Number(record.totalBytes ?? 0),
    largestFiles: Array.isArray(record.largestFiles) ? record.largestFiles.map(normalizeMaintenanceFile) : [],
    invalidFiles: Array.isArray(record.invalidFiles) ? record.invalidFiles : [],
    candidateCleanupFiles: Array.isArray(record.candidateCleanupFiles) ? record.candidateCleanupFiles.map(normalizeMaintenanceFile) : [],
    ...(record.knowledge && typeof record.knowledge === "object"
      ? { knowledge: normalizeKnowledgeMaintenance(record.knowledge as Record<string, unknown>) }
      : {}),
  };
}

function normalizeKnowledgeMaintenance(value: Record<string, unknown>): NonNullable<MaintenanceSection["knowledge"]> {
  return {
    libraryCount: Number(value.libraryCount ?? 0),
    sourceCount: Number(value.sourceCount ?? 0),
    chunkCount: Number(value.chunkCount ?? 0),
    missingSearchIndexes: Array.isArray(value.missingSearchIndexes) ? value.missingSearchIndexes.map(String) : [],
    orphanChunkSources: Array.isArray(value.orphanChunkSources) ? value.orphanChunkSources : [],
    sourceChunkMismatches: Array.isArray(value.sourceChunkMismatches) ? value.sourceChunkMismatches : [],
  };
}

function normalizeMaintenanceFile(value: unknown): MaintenanceFileInfo {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    path: String(record.path ?? ""),
    bytes: Number(record.bytes ?? 0),
  };
}

function normalizeMaintenanceIssue(value: unknown): MaintenanceIssue {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    severity: normalizeSeverity(record.severity),
    category: String(record.category ?? "unknown"),
    path: String(record.path ?? ""),
    message: String(record.message ?? ""),
  };
}

function normalizeSeverity(value: unknown): "info" | "warning" | "danger" {
  return value === "danger" || value === "warning" || value === "info" ? value : "info";
}

function androidPythonBridgeUrl(): string | null {
  const url = String(process.env.INKOS_ANDROID_PYTHON_BRIDGE_URL ?? "").trim();
  if (!url) return null;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "127.0.0.1" && parsed.hostname !== "localhost") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

async function probeAndroidPythonBridge(): Promise<PythonRuntimeStatus | null> {
  const bridgeUrl = androidPythonBridgeUrl();
  if (!bridgeUrl) return null;
  try {
    const parsed = await fetchJsonWithTimeout(`${bridgeUrl}/status`, {
      method: "GET",
      timeoutMs: 4_000,
    }) as Partial<{
      ok: boolean;
      available: boolean;
      command: string;
      version: string;
      capabilities: string[];
      error: string;
    }>;
    if (!parsed.available && !parsed.ok) {
      return {
        available: false,
        command: "android-chaquopy",
        version: null,
        platform: process.platform,
        arch: process.arch,
        android: process.env.INKOS_ANDROID === "1",
        lastError: parsed.error ?? "Android Python bridge is unavailable.",
        capabilities: [],
      };
    }
    return {
      available: true,
      command: parsed.command ?? "android-chaquopy",
      version: parsed.version ?? "Android embedded Python",
      platform: process.platform,
      arch: process.arch,
      android: process.env.INKOS_ANDROID === "1",
      lastError: null,
      capabilities: Array.isArray(parsed.capabilities)
        ? parsed.capabilities.map(String)
        : ["text", "markdown", "json", "csv", "html", "docx", "pdf"],
    };
  } catch (error) {
    return {
      available: false,
      command: "android-chaquopy",
      version: null,
      platform: process.platform,
      arch: process.arch,
      android: process.env.INKOS_ANDROID === "1",
      lastError: error instanceof Error ? error.message : String(error),
      capabilities: [],
    };
  }
}

async function extractWithAndroidPythonBridge(input: {
  readonly name: string;
  readonly base64: string;
}): Promise<PythonExtractResult | null> {
  const bridgeUrl = androidPythonBridgeUrl();
  if (!bridgeUrl) return null;
  try {
    const parsed = await fetchJsonWithTimeout(`${bridgeUrl}/extract`, {
      method: "POST",
      body: JSON.stringify({ name: input.name, base64: input.base64 }),
      timeoutMs: ANDROID_BRIDGE_TIMEOUT_MS,
    }) as Partial<PythonExtractResult & { error?: string }>;
    return {
      ok: Boolean(parsed.ok),
      text: typeof parsed.text === "string" ? parsed.text : "",
      method: typeof parsed.method === "string" ? parsed.method : "android-python",
      warnings: Array.isArray(parsed.warnings)
        ? parsed.warnings.map(String)
        : (parsed.error ? [String(parsed.error)] : []),
    };
  } catch (error) {
    cachedStatus = {
      available: false,
      command: "android-chaquopy",
      version: null,
      platform: process.platform,
      arch: process.arch,
      android: process.env.INKOS_ANDROID === "1",
      lastError: error instanceof Error ? error.message : String(error),
      capabilities: [],
    };
    return null;
  }
}

async function fetchJsonWithTimeout(
  url: string,
  options: { readonly method: "GET" | "POST"; readonly body?: string; readonly timeoutMs: number },
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, {
      method: options.method,
      body: options.body,
      headers: options.body ? { "content-type": "application/json" } : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`Android Python bridge returned ${response.status}: ${text.slice(0, 240)}`);
    }
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

function runPython(
  command: string,
  args: readonly string[],
  input: string,
  timeoutMs: number,
): Promise<{ readonly ok: boolean; readonly output: string; readonly error: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, [...args], {
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
    let output = "";
    let error = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, output, error: error || `Python timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { output += String(chunk); });
    child.stderr.on("data", (chunk) => { error += String(chunk); });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, output, error: err.message });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, output: `${output}${error && !output.trim() ? error : ""}`, error });
    });
    child.stdin.end(input);
  });
}
