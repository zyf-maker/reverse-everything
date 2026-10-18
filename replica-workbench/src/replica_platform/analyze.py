"""Deterministic, read-only project inventory for local targets."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path
from typing import Any


IGNORED = {".git", "node_modules", ".venv", "__pycache__"}


def _digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def inventory(target: str | Path) -> dict[str, Any]:
    root = Path(target).resolve(strict=True)
    if not root.is_dir():
        raise ValueError("analyze currently accepts a local directory")
    files: list[dict[str, Any]] = []
    extensions: dict[str, int] = {}
    for path in sorted(root.rglob("*")):
        if not path.is_file() or any(part in IGNORED for part in path.relative_to(root).parts):
            continue
        relative = path.relative_to(root).as_posix()
        suffix = path.suffix.lower() or "<none>"
        extensions[suffix] = extensions.get(suffix, 0) + 1
        item = {"path": relative, "bytes": path.stat().st_size, "sha256": _digest(path)}
        if suffix in {".html", ".htm"}:
            text = path.read_text(encoding="utf-8", errors="replace")
            title = re.search(r"<title[^>]*>(.*?)</title>", text, re.I | re.S)
            item["title"] = re.sub(r"\s+", " ", title.group(1)).strip() if title else None
            item["script_count"] = len(re.findall(r"<script\b", text, re.I))
        files.append(item)
    return {"schema_version": 1, "root": str(root), "file_count": len(files),
            "bytes": sum(item["bytes"] for item in files), "extensions": extensions, "files": files}
