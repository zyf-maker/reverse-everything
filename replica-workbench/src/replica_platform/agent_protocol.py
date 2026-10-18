"""Stable JSON protocol for driving the workbench from any agent runtime.

The protocol deliberately exposes named workbench operations instead of a
generic shell command.  That keeps integrations portable while preserving
the case authorization and target boundary checks implemented by the core
package.
"""

from __future__ import annotations

import datetime as dt
import json
import stat
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

from .adapters import run_behavior_replay, run_runtime_capture, run_static
from .analyze import inventory
from .case import add_evidence, create_case, load_case
from .config import save_json
from .preflight import inspect
from .report import write_report
from .scope import validate, validate_loopback_endpoint, validate_replay_page
from .verification import verify_case


SCHEMA = "replica-agent/v1"
OPERATIONS = (
    "capabilities",
    "doctor",
    "init",
    "status",
    "evidence.add",
    "analyze",
    "capture",
    "rebuild",
    "replay",
    "verify",
    "report",
)


def _path(value: Any, field: str) -> Path:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} must be a non-empty path string")
    return Path(value)


def _case_storage_path(case: Path, name: str, directory: bool) -> Path:
    case_root = case.resolve(strict=True)
    path = case / name
    info = path.lstat()
    reparse_attribute = getattr(stat, "FILE_ATTRIBUTE_REPARSE_POINT", 0x400)
    if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & reparse_attribute:
        raise ValueError("case evidence storage cannot use symlinks or reparse points")
    resolved = path.resolve(strict=True)
    if not resolved.is_relative_to(case_root):
        raise ValueError("case evidence storage must stay inside the case folder")
    if directory and not resolved.is_dir():
        raise ValueError("case evidence folder is invalid")
    if not directory and not resolved.is_file():
        raise ValueError("case manifest is invalid")
    return resolved


def _validate_case_evidence_storage(case: Path) -> None:
    _case_storage_path(case, "case.json", directory=False)
    _case_storage_path(case, "evidence", directory=True)


def _add_agent_evidence(case: Path, kind: str, title: str, data: Any, source: str) -> Path:
    _validate_case_evidence_storage(case)
    return add_evidence(case, kind, title, data, source)


def _case_path(cwd: Path, value: Any) -> Path:
    work_root = (cwd / "work").resolve(strict=False)
    case = _path(value, "case").resolve(strict=True)
    if not case.is_relative_to(work_root) or not (case / "case.json").is_file():
        raise ValueError("case must be a valid case directory inside the workbench work folder")
    _validate_case_evidence_storage(case)
    return case


def _workspace_input(cwd: Path, value: Any, field: str) -> Path:
    path = _path(value, field).resolve(strict=True)
    roots = [(cwd / name).resolve(strict=True) for name in ("scenarios", "work") if (cwd / name).is_dir()]
    if not any(path == root or path.is_relative_to(root) for root in roots):
        raise ValueError(f"{field} must be inside the workbench scenarios or work folder")
    return path


def _work_output(cwd: Path, value: Any, field: str) -> Path:
    path = _path(value, field)
    if not path.is_absolute():
        path = cwd / path
    resolved = path.resolve(strict=False)
    work_root = (cwd / "work").resolve(strict=True)
    if not resolved.is_relative_to(work_root):
        raise ValueError(f"{field} must stay inside the workbench work folder")
    return resolved


def _required(params: dict[str, Any], name: str) -> Any:
    if name not in params:
        raise ValueError(f"missing required parameter: {name}")
    return params[name]


def _status(case_path: Path) -> dict[str, Any]:
    case_path = case_path.resolve(strict=True)
    case = load_case(case_path)
    runs: list[dict[str, Any]] = []
    evidence_dir = case_path / "evidence"
    for path in sorted(evidence_dir.glob("*.json")):
        try:
            item = json.loads(path.read_text(encoding="utf-8-sig"))
        except (OSError, ValueError):
            continue
        if item.get("title") == "Fresh workbench verification" and isinstance(item.get("data"), dict):
            runs.append({"recorded_at": item.get("recorded_at"), "data": item["data"]})
    latest = max(runs, key=lambda item: item.get("recorded_at") or "", default=None)
    return {
        "case": str(case_path),
        "id": case.get("id"),
        "authorization": case.get("authorization", {}),
        "evidence_count": len(list(evidence_dir.glob("*.json"))),
        "latest_verification": (
            {
                "recorded_at": latest.get("recorded_at"),
                "run_id": latest["data"].get("run_id"),
                "verdict": latest["data"].get("verdict"),
            }
            if latest
            else None
        ),
    }


def _run(operation: str, params: dict[str, Any], cwd: Path) -> Any:
    """Execute one named operation without invoking a shell or a second CLI."""
    if operation == "capabilities":
        return {
            "protocol": SCHEMA,
            "operations": list(OPERATIONS),
            "transport": ["json", "jsonl"],
            "authorization": "case-scoped and explicit",
            "network": "offline or exact loopback allowlist",
        }
    if operation == "doctor":
        return inspect(params.get("cdp"), bool(params.get("require_docker", False)))
    if operation == "init":
        if params.get("authorize"):
            raise ValueError("agent protocol cannot grant authorization; an operator must authorize the case explicitly")
        case = create_case(
            cwd,
            str(_required(params, "name")),
            str(_required(params, "target")),
            str(params.get("type", "web")),
            params.get("version"),
            str(_required(params, "basis")),
            str(params.get("profile", "lite")),
            False,
            None,
            list(params.get("cdp_endpoints", [])),
        )
        return {"case": str(case)}
    if operation == "status":
        return _status(_case_path(cwd, _required(params, "case")))
    if operation == "evidence.add":
        case = _case_path(cwd, _required(params, "case"))
        return {
            "evidence": str(
            _add_agent_evidence(
                    case,
                    str(_required(params, "kind")),
                    str(_required(params, "title")),
                    _required(params, "data"),
                    str(params.get("source", "agent")),
                )
            )
        }
    if operation == "analyze":
        case = _case_path(cwd, _required(params, "case"))
        target = _path(_required(params, "target"), "target")
        validate(load_case(case), "static", str(target.resolve()))
        engine = str(params.get("engine", "inventory"))
        result = run_static(target) if engine == "own-static" else inventory(target)
        evidence = _add_agent_evidence(case, "observation", "Static target inventory", result, "agent")
        count = result.get("summary", {}).get("files", result.get("file_count", 0))
        return {"evidence": str(evidence), "engine": engine, "file_count": count}
    if operation == "capture":
        case = _case_path(cwd, _required(params, "case"))
        endpoint = params.get("endpoint")
        if endpoint:
            case_data = load_case(case)
            validate_loopback_endpoint(case_data, "runtime", str(endpoint))
            navigate = params.get("navigate")
            page_url = params.get("page_url")
            if not page_url:
                raise ValueError("capture with endpoint requires the exact current page_url")
            if navigate:
                validate_replay_page(case_data, "runtime", str(navigate), str(endpoint))
            if page_url:
                validate_replay_page(case_data, "runtime", str(page_url), str(endpoint))
            result = run_runtime_capture(
                str(endpoint), int(params.get("duration", 3000)), None,
                str(page_url) if page_url else None, str(navigate) if navigate else None,
                sorted({f"{urlsplit(str(value)).scheme}://{urlsplit(str(value)).netloc}"
                        for value in (page_url, navigate) if value}),
            )
            evidence = _add_agent_evidence(case, "network", "Browser runtime capture", result, "agent-runtime")
            return {"evidence": str(evidence), "events": result.get("summary", {}).get("eventCount", 0)}
        data = _required(params, "data")
        evidence = _add_agent_evidence(case, str(params.get("kind", "observation")),
                                       str(_required(params, "title")), data, "agent")
        return {"evidence": str(evidence)}
    if operation == "rebuild":
        case = _case_path(cwd, _required(params, "case"))
        output = _work_output(cwd, _required(params, "output"), "rebuild output")
        output.mkdir(parents=True, exist_ok=False)
        save_json(output / "rebuild.json", {
            "schema_version": 1, "case": str(case.resolve()), "status": "scaffold",
            "implementation": "independent", "next": ["implement behavior", "run verify"],
        })
        (output / "README.md").write_text(
            "# Independent Rebuild\n\nThis workspace is intentionally separate from the analyzed target.\n",
            encoding="utf-8",
        )
        return {"output": str(output)}
    if operation == "replay":
        case = _case_path(cwd, _required(params, "case"))
        case_data = load_case(case)
        reference_endpoint = str(_required(params, "reference_endpoint"))
        replica_endpoint = str(_required(params, "replica_endpoint"))
        reference_page = str(_required(params, "reference_page_url"))
        replica_page = str(_required(params, "replica_page_url"))
        validate_loopback_endpoint(case_data, "runtime", reference_endpoint)
        validate_loopback_endpoint(case_data, "runtime", replica_endpoint)
        validate_replay_page(case_data, "runtime", reference_page, reference_endpoint)
        validate_replay_page(case_data, "runtime", replica_page, replica_endpoint)
        result = run_behavior_replay(
            reference_endpoint, replica_endpoint, _workspace_input(cwd, _required(params, "scenario"), "scenario"),
            None, reference_page, replica_page,
            sorted({f"{urlsplit(value).scheme}://{urlsplit(value).netloc}"
                    for value in (reference_page, replica_page)}),
        )
        evidence = _add_agent_evidence(case, "test", "Behavior replay", result, "agent-runtime")
        return {"result": result, "evidence": str(evidence)}
    if operation == "verify":
        case = _case_path(cwd, _required(params, "case"))
        result = verify_case(case, _workspace_input(cwd, _required(params, "rebuild"), "rebuild"),
                             _workspace_input(cwd, _required(params, "scenario"), "scenario"))
        if (case / "case.json").is_file():
            if "static_analysis" in result:
                _add_agent_evidence(case, "observation", "Fresh target static analysis",
                                    result["static_analysis"], "agent-runtime")
            if "behavior_replay_result" in result:
                _add_agent_evidence(case, "test", "Fresh behavior replay",
                                    result["behavior_replay_result"], "agent-runtime")
            _add_agent_evidence(case, "test", "Fresh workbench verification", result, "agent")
            write_report(case)
        return result
    if operation == "report":
        return {"report": str(write_report(_case_path(cwd, _required(params, "case"))))}
    raise ValueError(f"unknown operation: {operation}")


def handle_request(request: Any, cwd: Path | None = None) -> dict[str, Any]:
    """Return a protocol response for one JSON request."""
    cwd = (cwd or Path.cwd()).resolve()
    request_id = request.get("request_id") if isinstance(request, dict) else None
    base = {"schema": SCHEMA, "request_id": request_id}
    try:
        if not isinstance(request, dict):
            raise ValueError("request must be a JSON object")
        if request.get("schema") != SCHEMA:
            raise ValueError(f"schema must be {SCHEMA}")
        operation = request.get("operation")
        if operation not in OPERATIONS:
            raise ValueError(f"operation must be one of: {', '.join(OPERATIONS)}")
        params = request.get("params", {})
        if not isinstance(params, dict):
            raise ValueError("params must be a JSON object")
        result = _run(operation, params, cwd)
        return {**base, "operation": operation, "ok": True, "status": "completed", "result": result}
    except (OSError, ValueError, RuntimeError, KeyError, TypeError) as exc:
        return {
            **base,
            "operation": request.get("operation") if isinstance(request, dict) else None,
            "ok": False,
            "status": "failed",
            "error": {"type": type(exc).__name__, "message": str(exc)},
        }


def process_json(text: str, cwd: Path | None = None) -> str:
    """Process one JSON document and emit one compact JSON response."""
    try:
        request = json.loads(text)
    except json.JSONDecodeError as exc:
        return json.dumps({"schema": SCHEMA, "ok": False, "status": "failed",
                           "error": {"type": "JSONDecodeError", "message": str(exc)}},
                          ensure_ascii=False)
    return json.dumps(handle_request(request, cwd), ensure_ascii=False, separators=(",", ":"))


def process_stream(lines: list[str], cwd: Path | None = None) -> list[str]:
    """Process newline-delimited JSON, preserving one response per input line."""
    return [process_json(line, cwd) for line in lines if line.strip()]
