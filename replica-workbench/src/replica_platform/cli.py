"""Command line entry point for Replica Workbench."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys
from urllib.parse import urlsplit

from . import __version__
from .case import add_evidence, create_case, load_case
from .analyze import inventory
from .adapters import run_behavior_replay, run_runtime_capture, run_static
from .agent_protocol import process_json, process_stream
from .config import save_json
from .preflight import inspect
from .report import write_report
from .scope import validate, validate_loopback_endpoint, validate_replay_page
from .verification import verify_case


def _root() -> Path:
    return Path.cwd()


def _agent_output_ok(output: str, jsonl: bool = False) -> bool:
    try:
        responses = [json.loads(line) for line in output.splitlines() if line.strip()] if jsonl else [json.loads(output)]
    except json.JSONDecodeError:
        return False
    return all(isinstance(response, dict) and response.get("ok") is True for response in responses)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="replica", description="Evidence-driven behavioral reconstruction workbench")
    parser.add_argument("--version", action="version", version=__version__)
    sub = parser.add_subparsers(dest="command", required=True)
    init = sub.add_parser("init", help="create a case with a pending authorization record")
    init.add_argument("--name", required=True)
    init.add_argument("--target", required=True)
    init.add_argument("--type", choices=("web", "javascript", "desktop", "mobile", "binary"), default="web")
    init.add_argument("--version", dest="target_version")
    init.add_argument("--basis", required=True)
    init.add_argument("--profile", choices=("lite", "standard", "full"), default="lite")
    init.add_argument("--authorize", action="store_true", help="record explicit authorization for the scope")
    init.add_argument("--authorization-expires-at", help="future timezone-aware ISO 8601 timestamp; required with --authorize")
    init.add_argument("--cdp-endpoint", action="append", default=[],
                      help="exact loopback CDP endpoint allowed for capture/replay; may be repeated")
    doctor = sub.add_parser("doctor", help="read-only environment check")
    doctor.add_argument("--cdp")
    doctor.add_argument("--require-docker", action="store_true")
    evidence = sub.add_parser("evidence", help="manage evidence")
    evidence_sub = evidence.add_subparsers(dest="evidence_command", required=True)
    add = evidence_sub.add_parser("add")
    add.add_argument("--case", required=True, type=Path)
    add.add_argument("--kind", required=True, choices=("observation", "inference", "test", "network", "visual", "limitation"))
    add.add_argument("--title", required=True)
    add.add_argument("--data", required=True, help="JSON value")
    add.add_argument("--source", default="operator")
    report = sub.add_parser("report", help="write Markdown report")
    report.add_argument("--case", required=True, type=Path)
    analyze = sub.add_parser("analyze", help="inventory a local target and record evidence")
    analyze.add_argument("--case", required=True, type=Path)
    analyze.add_argument("--target", required=True, type=Path)
    analyze.add_argument("--engine", choices=("inventory", "own-static"), default="inventory")
    capture = sub.add_parser("capture", help="record an operator observation")
    capture.add_argument("--case", required=True, type=Path)
    capture.add_argument("--title")
    capture.add_argument("--data")
    capture.add_argument("--kind", choices=("observation", "test", "network", "visual", "limitation"), default="observation")
    capture.add_argument("--endpoint")
    capture.add_argument("--duration", type=int, default=3000)
    capture.add_argument("--out", type=Path)
    capture.add_argument("--page-url")
    capture.add_argument("--navigate")
    rebuild = sub.add_parser("rebuild", help="create an independent rebuild workspace")
    rebuild.add_argument("--case", required=True, type=Path)
    rebuild.add_argument("--output", required=True, type=Path)
    verify = sub.add_parser("verify", help="run fresh static and browser checks for a local rebuild")
    verify.add_argument("--case", required=True, type=Path)
    verify.add_argument("--rebuild", required=True, type=Path)
    verify.add_argument("--scenario", required=True, type=Path)
    replay = sub.add_parser("replay", help="run a bounded two-browser behavior replay")
    replay.add_argument("--case", required=True, type=Path)
    replay.add_argument("--reference-endpoint", required=True)
    replay.add_argument("--replica-endpoint", required=True)
    replay.add_argument("--reference-page-url", required=True)
    replay.add_argument("--replica-page-url", required=True)
    replay.add_argument("--scenario", required=True, type=Path)
    replay.add_argument("--out", type=Path)
    agent = sub.add_parser("agent", help="process a portable JSON or JSONL agent request")
    agent.add_argument("--request", type=Path, help="read one JSON request from a file; stdin is the default")
    agent.add_argument("--jsonl", action="store_true", help="process newline-delimited JSON requests")
    args = parser.parse_args(argv)
    if args.command == "agent":
        source = args.request.read_text(encoding="utf-8-sig") if args.request else sys.stdin.read()
        if args.jsonl:
            responses = process_stream(source.splitlines(), _root())
            print("\n".join(responses))
            return 0 if _agent_output_ok("\n".join(responses), jsonl=True) else 1
        response = process_json(source, _root())
        print(response)
        return 0 if _agent_output_ok(response) else 1
    if args.command == "init":
        if args.authorize != bool(args.authorization_expires_at):
            parser.error("--authorize and --authorization-expires-at must be supplied together")
        try:
            case = create_case(_root(), args.name, args.target, args.type, args.target_version, args.basis,
                               args.profile, args.authorize, args.authorization_expires_at, args.cdp_endpoint)
        except ValueError as exc:
            parser.error(str(exc))
        print(case)
        return 0
    if args.command == "doctor":
        result = inspect(args.cdp, args.require_docker)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return {"READY": 0, "DEGRADED": 2, "BLOCKED": 1}[result["verdict"]]
    if args.command == "evidence" and args.evidence_command == "add":
        try:
            data = json.loads(args.data)
        except json.JSONDecodeError as exc:
            parser.error(f"--data must be valid JSON: {exc}")
        print(add_evidence(args.case, args.kind, args.title, data, args.source))
        return 0
    if args.command == "analyze":
        validate(load_case(args.case), "static", str(args.target.resolve()))
        result = run_static(args.target) if args.engine == "own-static" else inventory(args.target)
        output = add_evidence(args.case, "observation", "Static target inventory", result, "workbench")
        count = result.get("summary", {}).get("files", result.get("file_count", 0))
        print(json.dumps({"evidence": str(output), "engine": args.engine, "file_count": count}, ensure_ascii=False))
        return 0
    if args.command == "capture":
        if args.endpoint:
            case = load_case(args.case)
            validate_loopback_endpoint(case, "runtime", args.endpoint)
            if not args.page_url:
                parser.error("capture with --endpoint requires the exact current --page-url")
            if args.navigate:
                validate_replay_page(case, "runtime", args.navigate, args.endpoint)
            if args.page_url:
                validate_replay_page(case, "runtime", args.page_url, args.endpoint)
            allowed_origins = sorted({f"{urlsplit(value).scheme}://{urlsplit(value).netloc}"
                                      for value in (args.page_url, args.navigate) if value})
            result = run_runtime_capture(args.endpoint, args.duration, args.out, args.page_url,
                                         args.navigate, allowed_origins)
            output = add_evidence(args.case, "network", "Browser runtime capture", result, "workbench-runtime")
            print(json.dumps({"evidence": str(output), "events": result.get("summary", {}).get("eventCount", 0)}, ensure_ascii=False))
            return 0
        if not args.title or args.data is None:
            parser.error("capture without --endpoint requires --title and --data")
        try:
            data = json.loads(args.data)
        except json.JSONDecodeError as exc:
            parser.error(f"--data must be valid JSON: {exc}")
        print(add_evidence(args.case, args.kind, args.title, data, "operator"))
        return 0
    if args.command == "rebuild":
        args.output.mkdir(parents=True, exist_ok=False)
        manifest = {"schema_version": 1, "case": str(args.case.resolve()), "status": "scaffold",
                    "implementation": "independent", "next": ["implement behavior", "run verify"]}
        save_json(args.output / "rebuild.json", manifest)
        (args.output / "README.md").write_text(
            "# Independent Rebuild\n\nThis workspace is intentionally separate from the analyzed target.\n",
            encoding="utf-8")
        print(args.output)
        return 0
    if args.command == "replay":
        case = load_case(args.case)
        validate_loopback_endpoint(case, "runtime", args.reference_endpoint)
        validate_loopback_endpoint(case, "runtime", args.replica_endpoint)
        validate_replay_page(case, "runtime", args.reference_page_url, args.reference_endpoint)
        validate_replay_page(case, "runtime", args.replica_page_url, args.replica_endpoint)
        allowed_origins = sorted({f"{urlsplit(value).scheme}://{urlsplit(value).netloc}"
                                  for value in (args.reference_page_url, args.replica_page_url)})
        result = run_behavior_replay(args.reference_endpoint, args.replica_endpoint, args.scenario, args.out,
                                     args.reference_page_url, args.replica_page_url, allowed_origins)
        evidence = add_evidence(args.case, "test", "Behavior replay", result, "workbench-runtime")
        print(json.dumps({"result": result, "evidence": str(evidence)}, ensure_ascii=False))
        return 0 if result.get("pass") is True else 2
    if args.command == "verify":
        try:
            result = verify_case(args.case, args.rebuild, args.scenario)
        except (OSError, ValueError, RuntimeError, KeyError, TypeError) as exc:
            result = {"schema": "own-reverse-verification/v1", "verdict": "BLOCKED",
                      "checks": {"fresh_verification_executed": False},
                      "reason": f"{type(exc).__name__}: {exc}"}
        evidence = None
        if (args.case / "case.json").is_file():
            if "static_analysis" in result:
                add_evidence(args.case, "observation", "Fresh target static analysis",
                             result["static_analysis"], "workbench-runtime")
            if "behavior_replay_result" in result:
                add_evidence(args.case, "test", "Fresh behavior replay",
                             result["behavior_replay_result"], "workbench-runtime")
            evidence = add_evidence(args.case, "test", "Fresh workbench verification", result, "workbench")
            write_report(args.case)
        print(json.dumps({**result, "evidence": str(evidence) if evidence else None}, ensure_ascii=False))
        return 0 if result["verdict"] == "READY" else 2 if result["verdict"] == "DEGRADED" else 1
    if args.command == "report":
        print(write_report(args.case))
        return 0
    return 2


if __name__ == "__main__":
    sys.exit(main())
