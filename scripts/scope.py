#!/usr/bin/env python3
"""Validate a local reverse-replica authorization scope before a target action."""
import argparse
import datetime as dt
import ipaddress
import json
from pathlib import Path
import sys
from urllib.parse import urlsplit


def origin(value):
    u = urlsplit(value)
    if u.scheme not in ("http", "https") or not u.hostname or u.username or u.password:
        raise ValueError("Expected an explicit HTTP(S) origin without credentials")
    port = u.port if u.port is not None else (443 if u.scheme == "https" else 80)
    host = "[" + u.hostname + "]" if ":" in u.hostname else u.hostname
    return f"{u.scheme}://{host}:{port}"


def validate(scope, action, target, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    auth = scope.get("auth", {})
    if auth.get("status") != "granted" or not str(auth.get("basis", "")).strip():
        raise ValueError("Authorization is not granted with a recorded basis")
    expires = dt.datetime.fromisoformat(auth["expires_at"].replace("Z", "+00:00"))
    if expires.tzinfo is None or expires <= now:
        raise ValueError("Authorization expired or has no timezone")
    if action not in scope.get("actions", []):
        raise ValueError("Action is outside the authorized scope")
    mode = scope.get("network", {}).get("mode")
    if mode not in ("offline", "loopback", "lab_only", "allowlist"):
        raise ValueError("Unknown network mode")
    allowed = scope.get("targets", {})
    if target.startswith(("http://", "https://")):
        if mode == "offline":
            raise ValueError("Offline scope forbids network targets")
        value = origin(target)
        if value not in [origin(v) for v in allowed.get("origins", [])]:
            raise ValueError("Origin is outside the exact allowlist")
        if mode == "loopback":
            hostname = urlsplit(target).hostname
            # Numeric loopback prevents DNS aliases/rebinding from silently widening scope.
            try:
                if not ipaddress.ip_address(hostname).is_loopback:
                    raise ValueError("Not a numeric loopback address")
            except ValueError:
                raise ValueError("Loopback scope requires a numeric loopback address")
    else:
        resolved = Path(target).resolve(strict=True)
        roots = [Path(p).resolve(strict=True) for p in allowed.get("paths", [])]
        if not any(resolved == p or resolved.is_relative_to(p) for p in roots):
            raise ValueError("Resolved path is outside allowed roots")
    return {"status": "granted", "action": action, "target": target, "network_mode": mode}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scope", required=True)
    parser.add_argument("--action", required=True, choices=("static", "runtime", "network", "pentest"))
    parser.add_argument("--target", required=True)
    parser.add_argument("--run-rea", choices=("analyze-javascript-application",))
    parser.add_argument("--timeout", type=float, default=120)
    args = parser.parse_args()
    try:
        result = validate(json.loads(Path(args.scope).read_text(encoding="utf-8-sig")), args.action, args.target)
        if args.run_rea:
            if args.action != "static" or args.target.startswith(("http://", "https://")):
                raise ValueError("Static REA execution requires an authorized local path")
            from preflight import rea_command, run
            command = rea_command()
            if not command:
                raise ValueError("REA is not installed; no acquisition attempted")
            code, output, error = run(command + [args.run_rea, str(Path(args.target).resolve()), "--json"], args.timeout)
            if code != 0:
                raise ValueError("REA execution failed: " + error[-500:])
            print(output)
            return 0
        print(json.dumps(result, ensure_ascii=False))
        return 0
    except (ValueError, OSError, KeyError, TypeError) as exc:
        print(json.dumps({"status": "blocked", "reason": str(exc)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    sys.exit(main())
