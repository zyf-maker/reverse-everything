"""Fresh, local-only verification of a target and its independent rebuild."""

from __future__ import annotations

from contextlib import contextmanager
from functools import partial
import hashlib
import json
import os
from pathlib import Path
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.request import urlopen
from urllib.parse import urlsplit
import uuid

from .adapters import run_behavior_replay, run_static
from .scope import validate, validate_managed_loopback_endpoint


class _QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, format: str, *args: object) -> None:
        pass


@contextmanager
def _serve(root: Path):
    handler = partial(_QuietHandler, directory=str(root))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    server.daemon_threads = True
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/"
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


def _browser_binary() -> str | None:
    configured = os.environ.get("CHROME_PATH")
    if configured and Path(configured).is_file():
        return configured
    for name in ("chrome", "chromium", "chromium-browser", "msedge", "google-chrome"):
        found = shutil.which(name)
        if found:
            return found
    candidates = (
        Path(os.environ.get("PROGRAMFILES", "C:/Program Files")) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("PROGRAMFILES(X86)", "C:/Program Files (x86)")) / "Google/Chrome/Application/chrome.exe",
        Path(os.environ.get("LOCALAPPDATA", "")) / "Google/Chrome/Application/chrome.exe",
        Path("/usr/bin/google-chrome"), Path("/usr/bin/chromium"),
        Path("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"),
    )
    return next((str(path) for path in candidates if path.is_file()), None)


def _free_port() -> int:
    with socket.socket() as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def _is_internal_page_url(value: str) -> bool:
    try:
        parsed = urlsplit(value)
        return (parsed.scheme == "http" and parsed.hostname == "127.0.0.1"
                and parsed.port is not None and parsed.path == "/"
                and not parsed.username and not parsed.password and not parsed.query and not parsed.fragment)
    except ValueError:
        return False


def _wait_cdp(endpoint: str, process: subprocess.Popen, timeout: float = 15) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"browser exited with code {process.returncode}")
        try:
            with urlopen(f"{endpoint}/json/version", timeout=0.5) as response:
                if response.status == 200:
                    return
        except OSError:
            time.sleep(0.1)
    raise RuntimeError("browser DevTools endpoint did not become ready")


@contextmanager
def _launch_browser(binary: str, page_url: str):
    port = _free_port()
    endpoint = f"http://127.0.0.1:{port}"
    profile = tempfile.TemporaryDirectory(prefix="replica-browser-")
    command = [binary, "--headless=new", "--disable-gpu", "--no-first-run",
               "--no-default-browser-check", "--disable-background-networking",
               "--disable-extensions", "--remote-debugging-address=127.0.0.1",
               f"--remote-debugging-port={port}", f"--user-data-dir={profile.name}", page_url]
    if os.name != "nt":
        command.insert(1, "--no-sandbox")
    process = subprocess.Popen(command, stdin=subprocess.DEVNULL,
                                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                start_new_session=(os.name != "nt"))
    try:
        _wait_cdp(endpoint, process)
        yield endpoint
    finally:
        if process.poll() is None:
            if os.name == "nt":
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
            else:
                process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait(timeout=3)
        profile.cleanup()


def _source_hashes(root: Path) -> dict[str, str]:
    extensions = {".html", ".css", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"}
    hashes: dict[str, str] = {}
    for path in root.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in extensions:
            continue
        if any(part in {"node_modules", ".git", "dist", "build"} for part in path.parts):
            continue
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        hashes[str(path.relative_to(root))] = digest
    return hashes


def _overlap(target: Path, rebuild: Path) -> dict:
    target_hashes = _source_hashes(target)
    rebuild_hashes = _source_hashes(rebuild)
    target_by_hash = {digest: path for path, digest in target_hashes.items()}
    matches = [{"target": target_by_hash[digest], "rebuild": path}
               for path, digest in rebuild_hashes.items() if digest in target_by_hash]
    return {"target_source_files": len(target_hashes), "rebuild_source_files": len(rebuild_hashes),
            "identical_source_files": matches}


def _manifest_matches(manifest_path: Path, case_dir: Path) -> bool:
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
        return (manifest.get("schema_version") == 1 and manifest.get("status") == "implemented"
                and manifest.get("implementation") == "independent"
                and Path(manifest.get("case", "")).resolve() == case_dir.resolve())
    except (OSError, ValueError, TypeError):
        return False


def _checks_verdict(checks: dict[str, bool]) -> str:
    return "READY" if checks and all(checks.values()) else "DEGRADED"


def verify_case(case_dir: Path, rebuild_dir: Path, scenario_path: Path) -> dict:
    case_dir = case_dir.resolve(strict=True)
    rebuild_dir = rebuild_dir.resolve(strict=True)
    scenario_path = scenario_path.resolve(strict=True)
    case = json.loads((case_dir / "case.json").read_text(encoding="utf-8-sig"))
    target = Path(case["target"]["value"]).resolve(strict=True)
    if not target.is_dir() or not rebuild_dir.is_dir() or not scenario_path.is_file():
        raise ValueError("target, rebuild, and scenario must be existing local directories/files")
    if target == rebuild_dir or target in rebuild_dir.parents or rebuild_dir in target.parents:
        raise ValueError("target and rebuild directories must be separate")
    validate(case, "static", str(target))
    validate(case, "runtime", str(target))

    scenario = json.loads(scenario_path.read_text(encoding="utf-8-sig"))
    if scenario.get("schema") != "own-reverse-replay/v1" or not scenario.get("steps"):
        raise ValueError("verification scenario must use own-reverse-replay/v1 and contain steps")

    run_id = str(uuid.uuid4())
    checks = {
        "case_authorized": True,
        "target_static_analysis": False,
        "manifest_matches_case": _manifest_matches(rebuild_dir / "rebuild.json", case_dir),
        "implementation_entry": (rebuild_dir / "index.html").is_file(),
        "no_identical_source_hashes": False,
        "behavior_replay": False,
        "browser_errors": False,
    }
    results: dict = {"schema": "own-reverse-verification/v1", "run_id": run_id,
                     "case": str(case_dir), "target": str(target), "rebuild": str(rebuild_dir),
                     "scenario": str(scenario_path), "checks": checks, "verdict": "DEGRADED"}
    static_result = run_static(target)
    results["static_analysis"] = static_result
    checks["target_static_analysis"] = (static_result.get("schema") == "own-reverse.static-analysis/v1"
                                         and static_result.get("summary", {}).get("files", 0) > 0)

    overlap = _overlap(target, rebuild_dir)
    results["source_overlap"] = overlap
    checks["no_identical_source_hashes"] = (overlap["target_source_files"] > 0
                                             and overlap["rebuild_source_files"] > 0
                                             and not overlap["identical_source_files"])

    browser = _browser_binary()
    if browser:
        try:
            with _serve(target) as reference_url, _serve(rebuild_dir) as replica_url:
                if not _is_internal_page_url(reference_url) or not _is_internal_page_url(replica_url):
                    raise RuntimeError("verification page server escaped the local loopback boundary")
                with _launch_browser(browser, reference_url) as reference_endpoint:
                    with _launch_browser(browser, replica_url) as replica_endpoint:
                        validate_managed_loopback_endpoint(case, "runtime", reference_endpoint)
                        validate_managed_loopback_endpoint(case, "runtime", replica_endpoint)
                        replay = run_behavior_replay(reference_endpoint, replica_endpoint, scenario_path,
                                                     reference_page_url=reference_url,
                                                     replica_page_url=replica_url,
                                                     allowed_origins=[urlsplit(reference_url).scheme + "://" + urlsplit(reference_url).netloc,
                                                                      urlsplit(replica_url).scheme + "://" + urlsplit(replica_url).netloc])
                        results["behavior_replay_result"] = replay
                        checks["behavior_replay"] = replay.get("pass") is True
                        checks["browser_errors"] = not replay.get("errors")
        except (OSError, RuntimeError, ValueError) as exc:
            results["browser_failure"] = f"{type(exc).__name__}: {exc}"
    else:
        results["browser_failure"] = "No supported local Chrome/Chromium/Edge executable found"

    results["browser"] = Path(browser).name if browser else None
    results["verdict"] = _checks_verdict(checks)
    results["claim_scope"] = "This run proves only the listed static scan and deterministic browser scenario."
    results["limitations"] = [
            "Manifest fields are self-declared; matching them does not prove authorship or implementation quality.",
            "No identical source-file hashes is a copy warning only; it does not prove independent authorship.",
        "Passing the scenario does not establish exhaustive behavior, visual, accessibility, or cross-browser parity.",
    ]
    return results
