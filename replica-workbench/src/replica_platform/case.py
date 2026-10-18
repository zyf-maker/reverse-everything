"""Case lifecycle and evidence storage."""

from __future__ import annotations

import datetime as dt
import json
import re
import uuid
from pathlib import Path
from typing import Any

from .config import save_json


def utc_now() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def slug(value: str) -> str:
    clean = re.sub(r"[^a-zA-Z0-9._-]+", "-", value).strip("-")
    return clean or "case"


def create_case(root: Path, name: str, target: str, target_type: str, version: str | None, basis: str,
                profile: str = "lite", authorize: bool = False, expires_at: str | None = None,
                cdp_endpoints: list[str] | None = None) -> Path:
    authorization_status = "pending"
    if authorize:
        if not expires_at:
            raise ValueError("an explicit authorization expiry is required")
        expiry = dt.datetime.fromisoformat(expires_at.replace("Z", "+00:00"))
        if expiry.tzinfo is None or expiry <= dt.datetime.now(dt.timezone.utc):
            raise ValueError("authorization expiry must be a future timezone-aware timestamp")
        authorization_status = "granted"
    case = root / "work" / slug(name)
    if case.exists():
        raise FileExistsError(f"case already exists: {case}")
    for directory in (case / "evidence", case / "notes", case / "report"):
        directory.mkdir(parents=True, exist_ok=True)
    case_json = {
        "schema_version": 1,
        "id": case.name,
        "created_at": utc_now(),
        "target": {"type": target_type, "value": target, "version": version},
        "profile": profile,
        "authorization": {"status": authorization_status, "basis": basis,
                          "expires_at": expires_at if authorize else None},
        "actions": ["static", "runtime", "network"],
        "network": {"mode": "offline" if target_type != "web" else "loopback"},
        "targets": {"paths": [str(Path(target).resolve())] if Path(target).exists() else [],
                    "origins": [target] if target.startswith(("http://", "https://")) else [],
                    "cdp_endpoints": cdp_endpoints or []},
        "evidence": {"count": 0},
    }
    save_json(case / "case.json", case_json)
    return case


def load_case(case: Path) -> dict[str, Any]:
    return json.loads((case / "case.json").read_text(encoding="utf-8-sig"))


def add_evidence(case: Path, kind: str, title: str, data: Any, source: str = "operator") -> Path:
    record = {"schema_version": 1, "id": f"e-{utc_now().replace(':', '').replace('-', '')}-{uuid.uuid4().hex[:8]}",
              "recorded_at": utc_now(), "kind": kind, "title": title, "source": source,
              "data": data, "limitations": []}
    output = case / "evidence" / f"{record['id']}.json"
    output.write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    case_json = load_case(case)
    case_json.setdefault("evidence", {})["count"] = len(list((case / "evidence").glob("*.json")))
    save_json(case / "case.json", case_json)
    return output
