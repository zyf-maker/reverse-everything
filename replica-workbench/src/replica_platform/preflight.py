"""Read-only local capability checks."""

from __future__ import annotations

import shutil
import socket
from pathlib import Path
from typing import Any


def _port_open(host: str, port: int, timeout: float = 0.5) -> bool:
    try:
        with socket.create_connection((host, port), timeout=timeout):
            return True
    except OSError:
        return False


def inspect(cdp: str | None = None, require_docker: bool = False) -> dict[str, Any]:
    python_ok = True
    node = shutil.which("node")
    docker = shutil.which("docker")
    cdp_ok = False
    if cdp:
        from urllib.parse import urlsplit
        parsed = urlsplit(cdp)
        cdp_ok = parsed.hostname in {"127.0.0.1", "localhost", "::1"} and bool(parsed.port) and _port_open(parsed.hostname, parsed.port)
    findings = [
        {"id": "python", "status": "ok" if python_ok else "missing", "detail": "Python runtime"},
        {"id": "node", "status": "ok" if node else "missing", "detail": "Optional JavaScript runtime"},
        {"id": "cdp", "status": "ok" if cdp_ok else "missing", "detail": "Optional local browser endpoint"},
        {"id": "docker", "status": "ok" if docker else "missing", "detail": "Optional isolated services"},
    ]
    if require_docker and not docker:
        verdict = "BLOCKED"
    elif cdp and not cdp_ok:
        verdict = "DEGRADED"
    else:
        verdict = "READY"
    return {"schema_version": 1, "verdict": verdict, "capabilities": {
        "core": "READY", "web_runtime": "READY" if cdp_ok else "DEGRADED",
        "javascript": "READY" if node else "DEGRADED", "isolated_services": "READY" if docker else "DEGRADED",
    }, "findings": findings}
