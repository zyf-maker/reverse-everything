#!/usr/bin/env python3
"""Read-only, bounded readiness probes. Never downloads, installs or edits config."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request
import urllib.parse


def run(argv, timeout=15, cwd=None):
    try:
        # Windows npm/REA launchers are .cmd/.ps1; invoke Node's installed module directly.
        result = subprocess.run(argv, cwd=cwd, capture_output=True, text=True,
                                encoding="utf-8", errors="replace", timeout=timeout)
        return result.returncode, result.stdout, result.stderr
    except (OSError, subprocess.TimeoutExpired) as exc:
        return -1, "", type(exc).__name__


def rea_command():
    executable = shutil.which("rea")
    if not executable:
        return None
    if os.name == "nt":
        entry = Path(executable).parent / "node_modules/rea-agents/scripts/rea.mjs"
        node = shutil.which("node")
        # Doctor compares the Node executable identity. Match a validated local Codex
        # registration rather than a different Node injected into the agent's PATH.
        try:
            import tomllib
            registration = tomllib.loads((Path.home()/".codex/config.toml").read_text(encoding="utf-8"))['mcp_servers']['rea']
            registered_node = registration.get('command', '')
            if (registration.get('args') == [str(entry), 'mcp'] and Path(registered_node).is_absolute()
                    and Path(registered_node).is_file() and Path(registered_node).name.lower() == 'node.exe'):
                node = registered_node
        except (OSError, ValueError, KeyError, ImportError):
            pass
        return [node, str(entry)] if node and entry.is_file() else None
    return [executable]


def parse_doctor(doctor, client):
    identity = doctor.get("identity") or {}
    skill = identity.get("skill") or {}
    registrations = identity.get("registrations") or []
    registration = next((r for r in registrations if r.get("client") == client), {})
    providers = {p["id"]: p.get("available") is True
                 for p in doctor.get("providerInspections", []) if "id" in p}
    # Hopper predates providerInspections. Only a positive named check proves availability.
    checks = doctor.get("scope_checks") or doctor.get("checks") or []
    for check in checks:
        if check.get("name") == "hopper":
            providers["hopper"] = check.get("ok") is True
    return {
        "version": identity.get("cli_package_version"),
        "skill": "ok" if skill.get("state") in ("aligned", "ok") else "unknown",
        "registration": "ok" if registration.get("state") in ("aligned", "ok")
                        else "missing" if registration.get("state") == "missing" else "unknown",
        "registration_state": registration.get("state", "unknown"),
        "active_session": "unknown",  # Doctor cannot observe the calling agent's MCP connection.
        "providers": providers,
    }


def capabilities(rea, cdp, pentagi):
    native = any(rea.get("providers", {}).get(p) is True for p in ("hopper", "ghidra", "ida"))
    return {
        "javascript": "READY" if rea.get("cli") == "ok" else "BLOCKED",
        "web": "READY" if rea.get("cli") == "ok" and cdp == "ok" else "DEGRADED"
               if rea.get("cli") == "ok" else "BLOCKED",
        "binary": "READY" if native and rea.get("cli") == "ok" else "DEGRADED"
                  if rea.get("cli") == "ok" else "BLOCKED",
        "mobile": "READY" if rea.get("providers", {}).get("jadx") is True
                  and rea.get("cli") == "ok" else "DEGRADED" if rea.get("cli") == "ok" else "BLOCKED",
        # Container health is necessary, not sufficient: model/embedding/flow/network tests are separate.
        "pentest": "DEGRADED" if pentagi.get("daemon") == "ok" else "BLOCKED",
    }


def cdp_probe(endpoint, timeout):
    if not endpoint:
        return "unknown", "CDP endpoint not supplied"
    parsed = urllib.parse.urlsplit(endpoint)
    import ipaddress
    try:
        loopback = ipaddress.ip_address(parsed.hostname).is_loopback
    except (ValueError, TypeError):
        loopback = False
    if parsed.scheme not in ("http", "https") or not loopback or parsed.username or parsed.password:
        return "blocked", "Only explicit loopback CDP endpoints are probed"
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, request, fp, code, msg, headers, newurl):
            return None
    try:
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open(endpoint.rstrip("/") + "/json/version", timeout=timeout) as response:
            data = json.load(response)
        ws = urllib.parse.urlsplit(data.get("webSocketDebuggerUrl", ""))
        try:
            ws_loopback = ipaddress.ip_address(ws.hostname).is_loopback
        except (ValueError, TypeError):
            ws_loopback = False
        expected_scheme = "wss" if parsed.scheme == "https" else "ws"
        expected_port = parsed.port or (443 if parsed.scheme == "https" else 80)
        if (ws.scheme != expected_scheme or not ws_loopback or ws.port != expected_port
                or ws.hostname != parsed.hostname):
            return "blocked", "Debugger WebSocket is not bound to the same loopback origin"
        return "ok", str(data.get("Browser", "CDP"))
    except Exception as exc:
        return "blocked", type(exc).__name__


def locate(explicit, name):
    candidates = [explicit] if explicit else []
    candidates += [str(Path.home() / name)]
    if os.name == "nt":
        candidates += [str(Path("D:/tmp") / name)]
    for candidate in candidates:
        if candidate and Path(candidate).is_dir():
            return str(Path(candidate).resolve())
    return None


def inspect(args):
    findings, plans = [], []
    def finding(identifier, status, detail):
        findings.append({"Id": identifier, "Status": status, "Detail": detail})
    command = rea_command()
    rea = {"cli": "missing", "providers": {}, "registration": "unknown", "skill": "unknown"}
    if command:
        code, output, _ = run(command + ["--help"], args.timeout)
        rea["cli"] = "ok" if code == 0 and "rea" in output.lower() else "unknown"
        if not args.skip_rea_doctor:
            _, output, _ = run(command + ["doctor", "--client", args.client, "--format", "json"], args.timeout)
            try:
                rea.update(parse_doctor(json.loads(output), args.client))
            except (ValueError, TypeError):
                finding("rea:doctor", "unknown", "Doctor failed, timed out or returned invalid JSON")
    finding("rea:cli", rea["cli"], "Existing local installation only; no npx acquisition")
    finding("rea:skill", rea.get("skill", "unknown"), "Installed skill alignment")
    finding("rea:mcp", rea.get("registration", "unknown"), f"{args.client} file registration; active connection unverified")
    if rea.get("registration") != "ok":
        plans.append({"gap": "Current client MCP registration", "command":
                      f"rea setup --client {args.client} --dry-run --json",
                      "effects": "Plan only; review exact config target, symlinks and backups before applying"})
    cdp, detail = cdp_probe(args.cdp_endpoint, args.timeout)
    finding("web:cdp", cdp, detail)
    rs = locate(args.reverse_skill, "reverse-skill")
    finding("rs:repo", "ok" if rs else "missing", rs or "Not located")
    if rs:
        index = Path(rs) / "skills/tool-index.md"
        finding("rs:index", "ok" if index.is_file() else "missing", "Inventory snapshot only, not live MCP readiness")
    pg = {"daemon": "missing", "services": "unknown", "path": locate(args.pentagi, "pentagi")}
    docker = shutil.which("docker")
    if docker:
        code, output, _ = run([docker, "info", "--format", "{{.ServerVersion}}"], args.timeout)
        pg["daemon"] = "ok" if code == 0 and output.strip() else "blocked"
        if pg["daemon"] == "ok" and pg["path"]:
            compose_file = Path(args.compose_file)
            if not compose_file.is_absolute():
                compose_file = Path(pg["path"]) / compose_file
            code, output, _ = run([docker, "compose", "-f", str(compose_file), "ps", "--all", "--format", "json"],
                                  args.timeout, cwd=pg["path"])
            try:
                text = output.strip()
                rows = json.loads(text) if text.startswith("[") else [json.loads(line) for line in text.splitlines() if line]
                required = {r.get("Service"): r for r in rows if r.get("Service") in ("pentagi", "pgvector", "scraper")}
                pg["services"] = "ok" if code == 0 and len(required) == 3 and required.get("pgvector", {}).get("Health") == "healthy" and all(
                    r.get("State") == "running" and r.get("Health") in ("healthy", "") for r in required.values()) else "degraded"
            except (ValueError, TypeError):
                pg["services"] = "unknown"
    finding("env:docker-daemon", pg["daemon"], "Bounded Docker API probe")
    finding("pg:stack", pg["services"], "Checks compose service identities, not container name substrings")
    finding("pg:execution", "unknown", "Requires live LLM tool-call, embedding, real worker isolation and completed flow tests")
    caps = capabilities(rea, cdp, pg)
    target = "web" if args.target == "auto" else args.target
    if target in ("binary", "mobile") and caps[target] != "READY":
        plans.append({"gap": target + " analysis provider", "command": "rea doctor --provider " + ("jadx" if target == "mobile" else "ghidra") + " --json",
                      "effects": "Diagnostic only; install only the provider required for the selected target"})
    if args.install:
        finding("install:mode", "blocked" if args.approve else "unknown",
                "Plans are never evaluated as shell strings. Apply reviewed commands separately, then rerun preflight")
    return {"schema_version": 2, "target_type": args.target, "verdict": "BLOCKED" if args.approve else caps[target],
            "capabilities": caps, "rea": rea, "pentagi": pg, "findings": findings,
            "consent_plan": plans, "approved": False, "executed": []}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--target", choices=("auto", "javascript", "web", "binary", "mobile", "pentest"), default="auto")
    parser.add_argument("--client", default="codex", choices=("codex", "claude_code", "cursor", "gemini_cli", "opencode"))
    parser.add_argument("--cdp-endpoint")
    parser.add_argument("--reverse-skill", default=os.environ.get("REVERSE_SKILL_PATH"))
    parser.add_argument("--pentagi", default=os.environ.get("PENTAGI_PATH"))
    parser.add_argument("--compose-file", default="docker-compose.yml")
    parser.add_argument("--timeout", type=float, default=15)
    parser.add_argument("--skip-rea-doctor", action="store_true")
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--install", action="store_true", help="Show plan only; never executes")
    parser.add_argument("--approve", action="store_true", help="Legacy auto-install is rejected")
    args = parser.parse_args()
    result = inspect(args)
    if args.json:
        print(json.dumps(result, ensure_ascii=False, indent=2))
    else:
        print("reverse-everything:", result["verdict"])
        for item in result["findings"]:
            print(f'[{item["Status"]}] {item["Id"]}: {item["Detail"]}')
        print("Capabilities:", json.dumps(result["capabilities"]))
        if result["consent_plan"]:
            print("Plan (not executed):", json.dumps(result["consent_plan"], ensure_ascii=False))
    return {"READY": 0, "DEGRADED": 2, "BLOCKED": 1}[result["verdict"]]


if __name__ == "__main__":
    sys.exit(main())
