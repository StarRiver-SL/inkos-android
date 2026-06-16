import base64
import csv
import html
import io
import json
import platform
import re
import hashlib
import sys
import zipfile
import xml.etree.ElementTree as ET


def clean(text):
    text = (text or "").replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
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
        raise RuntimeError("PDF extraction requires pypdf in the embedded Android Python runtime") from exc
    reader = PdfReader(io.BytesIO(raw))
    pages = []
    for page in reader.pages:
        pages.append(page.extract_text() or "")
    return clean("\n\n".join(pages))


def extract_json_file(raw):
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
            and not name.startswith("META-INF/")
        )
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
            if name.startswith("xl/worksheets/sheet") and name.endswith(".xml")
        )
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
            if name.startswith("ppt/slides/slide") and name.endswith(".xml")
        )
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


def estimate_tokens(text):
    cjk = len(re.findall(r"[\u3400-\u9fff]", text or ""))
    other = max(0, len(text or "") - cjk)
    return max(1, int((cjk / 1.7) + (other / 4) + 0.999))


def _score_sentences(text):
    scored = []
    sentences = re.split(r"(?<=[。！？.!?\n])\s*", text)
    sentences = [s.strip() for s in sentences if s.strip() and len(s.strip()) > 8]
    if not sentences:
        return scored
    ngram_counts = {}
    for s in sentences:
        for i in range(len(s) - 5):
            gram = s[i:i+6]
            ngram_counts[gram] = ngram_counts.get(gram, 0) + 1
    for i, s in enumerate(sentences):
        score = 1.0
        if re.search(r"[㐀-鿿]{2,4}", s) and not re.match(r"^[　-〿]", s):
            score *= 1.3
        if re.search(r"\d{2,}", s):
            score *= 1.2
        if re.search(r'[「」“”‘’"]', s):
            score *= 1.2
        if i < 3 or i >= len(sentences) - 2:
            score *= 1.1
        repeats = sum(1 for g in (s[j:j+6] for j in range(len(s)-5)) if ngram_counts.get(g, 0) > 2)
        if repeats > len(s) * 0.1:
            score *= 0.5
        scored.append((score, s))
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored


def headroom_compress_json(payload):
    try:
        data = json.loads(payload or "{}")
        content = str(data.get("content") or "")
        lines = content.splitlines()
        headings = [line.strip() for line in lines if re.match(r"^#{1,6}\s+\S", line.strip())][:80]
        scored = _score_sentences(content)
        summary_sentences = [s for _, s in scored[:12]] if scored else []
        summary_text = "\n".join(summary_sentences)
        parts = ["[Android Python Headroom-compatible compression]"]
        if headings:
            parts.append("## Markdown outline\n" + "\n".join(headings))
        parts.append("## Front context\n" + content[:800].strip())
        if summary_text:
            parts.append("## Key sentences\n" + summary_text.strip())
        if len(content) > 2800:
            parts.append("## Tail context\n" + content[-600:].strip())
        compressed = clean("\n\n".join(part for part in parts if part.strip()))
        original_tokens = estimate_tokens(content)
        compressed_tokens = estimate_tokens(compressed)
        savings = max(0, round((1 - compressed_tokens / max(1, original_tokens)) * 100))
        return json.dumps(
            {
                "ok": bool(compressed),
                "compressed": compressed,
                "hash": hashlib.sha256(content.encode("utf-8")).hexdigest()[:16],
                "original_tokens": original_tokens,
                "compressed_tokens": compressed_tokens,
                "savings_percent": savings,
                "transforms": ["android-python-smart-compress", "sentence-scoring", "front-tail-retention"],
            },
            ensure_ascii=False,
        )
    except Exception as exc:
        return json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False)


def status(_payload="{}"):
    return json.dumps(
        {
            "ok": True,
            "available": True,
            "command": "android-chaquopy",
            "version": "Python " + sys.version.split()[0],
            "implementation": platform.python_implementation(),
            "capabilities": ["text", "markdown", "json", "csv", "html", "docx", "epub", "xlsx", "pptx", "headroom-compress", "quality-analysis", "pdf-if-pypdf-installed"],
        },
        ensure_ascii=False,
    )


def extract_json(payload):
    try:
        data = json.loads(payload or "{}")
        name = str(data.get("name") or "source")
        raw = base64.b64decode(data.get("base64") or "")
        lower = name.lower()
        warnings = []
        method = "android-python:text"
        if lower.endswith(".docx"):
            text = extract_docx(raw)
            method = "android-python:docx"
        elif lower.endswith(".pdf"):
            text = extract_pdf(raw)
            method = "android-python:pdf"
        elif lower.endswith(".json"):
            text = extract_json_file(raw)
            method = "android-python:json"
        elif lower.endswith(".csv") or lower.endswith(".tsv"):
            text = extract_csv(raw)
            method = "android-python:csv"
        elif lower.endswith(".html") or lower.endswith(".htm"):
            text = extract_html(raw)
            method = "android-python:html"
        elif lower.endswith(".epub"):
            text = extract_epub(raw)
            method = "android-python:epub"
        elif lower.endswith(".xlsx") or lower.endswith(".xls"):
            text = extract_xlsx(raw)
            method = "android-python:xlsx"
        elif lower.endswith(".pptx"):
            text = extract_pptx(raw)
            method = "android-python:pptx"
        else:
            text = clean(raw.decode("utf-8-sig", errors="replace"))
        if not text:
            warnings.append("No text extracted from file.")
        return json.dumps({"ok": bool(text), "text": text, "method": method, "warnings": warnings}, ensure_ascii=False)
    except Exception as exc:
        return json.dumps({"ok": False, "text": "", "method": "android-python:error", "warnings": [str(exc)]}, ensure_ascii=False)
