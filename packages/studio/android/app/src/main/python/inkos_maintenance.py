import hashlib
import json
import os
import time


TARGET_DIRS = ["books", "worlds", "knowledge", "logs", ".inkos"]
MAX_LARGEST_FILES = 12
MAX_ISSUES = 200
MAX_DUPLICATES = 30
LARGE_FILE_BYTES = 5 * 1024 * 1024
LARGE_DIR_BYTES = 80 * 1024 * 1024


def _now_ms():
    return int(time.time() * 1000)


def _safe_join(root, rel):
    path = os.path.abspath(os.path.join(root, rel))
    root_abs = os.path.abspath(root)
    if path != root_abs and not path.startswith(root_abs + os.sep):
        raise ValueError("Path escapes project root: " + rel)
    return path


def _rel(root, path):
    try:
        return os.path.relpath(path, root).replace("\\", "/")
    except Exception:
        return path


def _issue(severity, category, path, message):
    return {
        "severity": severity,
        "category": category,
        "path": path,
        "message": message,
    }


def _read_json(path):
    with open(path, "r", encoding="utf-8") as handle:
        return json.load(handle)


def _sample_hash(path, size):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        if size <= 256 * 1024:
            digest.update(handle.read())
        else:
            digest.update(handle.read(128 * 1024))
            handle.seek(max(0, size - 128 * 1024))
            digest.update(handle.read(128 * 1024))
    return digest.hexdigest()


def _validate_jsonl(path):
    invalid_rows = []
    with open(path, "r", encoding="utf-8") as handle:
        for index, line in enumerate(handle, start=1):
            text = line.strip()
            if not text:
                continue
            try:
                json.loads(text)
            except Exception as exc:
                invalid_rows.append({"line": index, "error": str(exc)[:160]})
                if len(invalid_rows) >= 8:
                    break
    return invalid_rows


def _empty_section(name, path):
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


def _scan_section(root, name, path, issues):
    section = _empty_section(name, path)
    if not os.path.isdir(path):
        issues.append(_issue("info", "missing-directory", name, "Directory does not exist yet."))
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
            rel = _rel(root, full)
            try:
                stat = os.stat(full)
            except OSError as exc:
                issues.append(_issue("warning", "unreadable-file", rel, str(exc)))
                continue

            size = int(stat.st_size)
            section["fileCount"] += 1
            section["totalBytes"] += size
            largest.append({"path": rel, "bytes": size})
            if size >= LARGE_FILE_BYTES:
                issues.append(_issue("warning", "large-file", rel, "Large file may slow sync or backup."))

            lower = filename.lower()
            if lower.endswith(".json"):
                try:
                    _read_json(full)
                except Exception as exc:
                    invalid.append({"path": rel, "kind": "json", "message": str(exc)[:200]})
                    issues.append(_issue("danger", "invalid-json", rel, str(exc)[:200]))
            elif lower.endswith(".jsonl"):
                rows = _validate_jsonl(full)
                if rows:
                    invalid.append({"path": rel, "kind": "jsonl", "rows": rows})
                    issues.append(_issue("warning", "invalid-jsonl", rel, "Some JSONL rows are invalid."))

            if name == "logs" and (lower.endswith(".log") or lower.endswith(".txt")) and size > 1024 * 1024:
                cleanup.append({"path": rel, "bytes": size, "reason": "large-log"})

            if size > 0:
                size_groups.setdefault(size, []).append(full)

    largest.sort(key=lambda item: item["bytes"], reverse=True)
    section["largestFiles"] = largest[:MAX_LARGEST_FILES]
    section["invalidFiles"] = invalid[:MAX_ISSUES]
    section["candidateCleanupFiles"] = cleanup[:MAX_LARGEST_FILES]
    if section["totalBytes"] >= LARGE_DIR_BYTES:
        issues.append(_issue("warning", "large-directory", name, "Directory is large; consider reviewing generated files."))
    return section, size_groups


def _scan_duplicates(root, size_groups, issues):
    duplicates = []
    for size, paths in size_groups.items():
        if len(paths) < 2 or size == 0:
            continue
        hash_groups = {}
        for path in paths[:40]:
            try:
                key = _sample_hash(path, size)
            except OSError:
                continue
            hash_groups.setdefault(key, []).append(path)
        for digest, group in hash_groups.items():
            if len(group) < 2:
                continue
            item = {
                "hash": digest[:16],
                "bytes": size,
                "paths": [_rel(root, p) for p in group[:8]],
            }
            duplicates.append(item)
            issues.append(_issue("info", "duplicate-file", item["paths"][0], "Potential duplicate file detected."))
            if len(duplicates) >= MAX_DUPLICATES:
                return duplicates
    return duplicates


def _scan_knowledge(root, section, issues):
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
        rel_dir = _rel(root, dirpath)
        try:
            sources = _read_json(os.path.join(dirpath, "sources.json")) if "sources.json" in filenames else []
            chunks = _read_json(os.path.join(dirpath, "chunks.json")) if "chunks.json" in filenames else []
        except Exception as exc:
            issues.append(_issue("danger", "knowledge-index-invalid", rel_dir, str(exc)[:200]))
            continue
        if not isinstance(sources, list):
            sources = []
        if not isinstance(chunks, list):
            chunks = []
        status["sourceCount"] += len(sources)
        status["chunkCount"] += len(chunks)
        if "search-index.json" not in filenames:
            status["missingSearchIndexes"].append(rel_dir)
            issues.append(_issue("warning", "knowledge-search-index-missing", rel_dir, "Knowledge search-index.json is missing."))
        source_ids = {str(source.get("id")) for source in sources if isinstance(source, dict)}
        chunk_counts = {}
        for chunk in chunks:
            if not isinstance(chunk, dict):
                continue
            source_id = str(chunk.get("sourceId"))
            chunk_counts[source_id] = chunk_counts.get(source_id, 0) + 1
            if source_id not in source_ids:
                status["orphanChunkSources"].append({"library": rel_dir, "sourceId": source_id})
                issues.append(_issue("warning", "knowledge-orphan-chunk-source", rel_dir, "Chunk references a missing sourceId."))
        for source in sources:
            if not isinstance(source, dict):
                continue
            source_id = str(source.get("id"))
            expected = int(source.get("chunkCount") or 0)
            actual = chunk_counts.get(source_id, 0)
            if expected != actual:
                status["sourceChunkMismatches"].append({
                    "library": rel_dir,
                    "sourceId": source_id,
                    "expected": expected,
                    "actual": actual,
                })
                issues.append(_issue("warning", "knowledge-chunk-mismatch", rel_dir, "Source chunkCount does not match chunks.json."))
    section["knowledge"] = status


def scan_project(root):
    started = _now_ms()
    root = os.path.abspath(str(root or "."))
    issues = []
    sections = {}
    merged_size_groups = {}

    for name in TARGET_DIRS:
        path = _safe_join(root, name)
        section, size_groups = _scan_section(root, name, path, issues)
        sections[name.replace(".", "runtime")] = section
        for size, paths in size_groups.items():
            merged_size_groups.setdefault(size, []).extend(paths)

    _scan_knowledge(root, sections["knowledge"], issues)
    duplicates = _scan_duplicates(root, merged_size_groups, issues)
    issues = issues[:MAX_ISSUES]
    recommendations = []
    if sections["logs"]["candidateCleanupFiles"]:
        recommendations.append({
            "title": "Review large logs",
            "detail": "Large log files can be cleaned in a future confirmed repair flow.",
            "severity": "info",
        })
    knowledge_status = sections["knowledge"].get("knowledge", {})
    if (
        knowledge_status.get("missingSearchIndexes")
        or knowledge_status.get("sourceChunkMismatches")
        or knowledge_status.get("orphanChunkSources")
    ):
        recommendations.append({
            "title": "Rebuild knowledge indexes",
            "detail": "Some knowledge libraries have missing or inconsistent indexes.",
            "severity": "warning",
        })
    if duplicates:
        recommendations.append({
            "title": "Review duplicate files",
            "detail": "Potential duplicates were detected. No files were changed.",
            "severity": "info",
        })

    total_files = sum(section["fileCount"] for section in sections.values())
    total_bytes = sum(section["totalBytes"] for section in sections.values())
    return {
        "ok": True,
        "method": "android-python:maintenance",
        "summary": {
            "root": root,
            "totalFiles": total_files,
            "totalBytes": total_bytes,
            "durationMs": _now_ms() - started,
            "issueCount": len(issues),
            "scannedAt": _now_ms(),
        },
        "sections": sections,
        "duplicates": duplicates,
        "issues": issues,
        "recommendations": recommendations,
    }


def scan_json(payload):
    try:
        data = json.loads(payload or "{}")
        root = data.get("root") or "."
        return json.dumps(scan_project(root), ensure_ascii=False)
    except Exception as exc:
        return json.dumps({"ok": False, "method": "android-python:maintenance", "error": str(exc)}, ensure_ascii=False)
