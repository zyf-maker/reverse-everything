"""Load and normalize external behavioral validation results."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def load_result(path: Path, label: str) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8-sig"))
    passed = data.get("passed") is True or data.get("pass") is True or data.get("verdict") == "READY"
    return {"label": label, "path": str(path.resolve()), "passed": passed, "data": data}
