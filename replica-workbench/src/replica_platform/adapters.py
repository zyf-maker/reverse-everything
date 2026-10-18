"""Adapters for the independent static and browser-runtime components."""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from urllib.parse import urlsplit


def _platform_root() -> Path:
    # repo/replica-workbench/src/replica_platform/adapters.py -> repo/own-reverse-platform
    return Path(__file__).resolve().parents[3] / "own-reverse-platform"


def _node_command() -> str:
    return os.environ.get("REPLICA_NODE_BIN", "node")


def _run(command: list[str], cwd: Path, timeout: float = 120) -> dict:
    try:
        result = subprocess.run(command, cwd=cwd, capture_output=True, text=True,
                                encoding="utf-8", errors="replace", timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError(f"adapter did not complete: {type(exc).__name__}") from exc
    if result.returncode != 0:
        raise RuntimeError(result.stderr[-1000:] or f"adapter exited {result.returncode}")
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError("adapter returned invalid JSON") from exc


def run_static(target: Path, timeout: float = 120) -> dict:
    root = _platform_root() / "static-analyzer"
    return _run([_node_command(), "src/cli.js", str(target.resolve())], root, timeout)


def run_runtime_capture(endpoint: str, duration_ms: int, output: Path | None = None,
                        page_url: str | None = None, navigate: str | None = None,
                        allowed_origins: list[str] | None = None,
                        timeout: float = 180) -> dict:
    parsed = urlsplit(endpoint)
    if parsed.scheme not in {"http", "https"} or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
        raise ValueError("runtime capture only accepts an explicit loopback endpoint")
    root = _platform_root() / "runtime"
    command = [_node_command(), "src/cli.js", "capture", "--endpoint", endpoint, "--duration-ms", str(duration_ms)]
    if page_url:
        command.extend(["--page-url", page_url])
    if navigate:
        command.extend(["--navigate", navigate])
    for origin in allowed_origins or []:
        command.extend(["--allow-origin", origin])
    if output:
        output = output.resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        command.extend(["--out", str(output)])
    if output:
        try:
            result = subprocess.run(command, cwd=root, capture_output=True, text=True,
                                    encoding="utf-8", errors="replace", timeout=timeout)
        except (OSError, subprocess.TimeoutExpired) as exc:
            raise RuntimeError(f"adapter did not complete: {type(exc).__name__}") from exc
        if result.returncode != 0:
            raise RuntimeError(result.stderr[-1000:] or f"adapter exited {result.returncode}")
        return json.loads(output.read_text(encoding="utf-8"))
    return _run(command, root, timeout)


def run_runtime_compare(reference: Path, replica: Path, timeout: float = 120) -> dict:
    root = _platform_root() / "runtime"
    return _run([_node_command(), "src/cli.js", "compare", "--reference", str(reference), "--replica", str(replica)], root, timeout)


def run_behavior_replay(reference_endpoint: str, replica_endpoint: str, scenario: Path,
                        output: Path | None = None, reference_page_url: str | None = None,
                        replica_page_url: str | None = None, allowed_origins: list[str] | None = None,
                        timeout: float = 180) -> dict:
    for endpoint in (reference_endpoint, replica_endpoint):
        parsed = urlsplit(endpoint)
        if parsed.scheme not in {"http", "https"} or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}:
            raise ValueError("behavior replay only accepts explicit loopback endpoints")
    root = _platform_root() / "runtime"
    command = [_node_command(), "src/cli.js", "replay", "--reference-endpoint", reference_endpoint,
               "--replica-endpoint", replica_endpoint, "--scenario", str(scenario.resolve())]
    if reference_page_url:
        command.extend(["--reference-page-url", reference_page_url])
    if replica_page_url:
        command.extend(["--replica-page-url", replica_page_url])
    for origin in allowed_origins or []:
        command.extend(["--allow-origin", origin])
    if output:
        output = output.resolve()
        output.parent.mkdir(parents=True, exist_ok=True)
        command.extend(["--out", str(output)])
    try:
        result = subprocess.run(command, cwd=root, capture_output=True, text=True,
                                encoding="utf-8", errors="replace", timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as exc:
        raise RuntimeError(f"adapter did not complete: {type(exc).__name__}") from exc
    if result.returncode not in (0, 1):
        raise RuntimeError(result.stderr[-1000:] or f"adapter exited {result.returncode}")
    if output:
        try:
            return json.loads(output.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError) as exc:
            raise RuntimeError(f"replay output is invalid: {exc}; stderr={result.stderr[-1000:]}") from exc
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"replay returned invalid JSON: {exc}; stderr={result.stderr[-1000:]}") from exc
