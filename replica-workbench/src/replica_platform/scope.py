"""Authorization and target boundary checks."""

from __future__ import annotations

import datetime as dt
import ipaddress
from pathlib import Path
from urllib.parse import urlsplit


def _origin(value: str) -> str:
    parsed = urlsplit(value)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("target must be an HTTP(S) URL without credentials")
    port = parsed.port or (443 if parsed.scheme == "https" else 80)
    host = parsed.hostname.lower()
    if ":" in host:
        host = f"[{host}]"
    return f"{parsed.scheme}://{host}:{port}"


def _cdp_endpoint_key(endpoint: str) -> str:
    parsed = urlsplit(endpoint)
    try:
        port = parsed.port
        address = ipaddress.ip_address(parsed.hostname or "")
    except ValueError as exc:
        raise ValueError("CDP endpoint must use a numeric loopback address and valid port") from exc
    if (parsed.scheme not in ("http", "https") or not address.is_loopback or not port
            or parsed.username or parsed.password or parsed.path not in ("", "/")
            or parsed.query or parsed.fragment):
        raise ValueError("CDP endpoint must be a bare HTTP(S) numeric loopback origin")
    host = f"[{address.compressed}]" if address.version == 6 else str(address)
    return f"{parsed.scheme}://{host}:{port}"


def _validate_scope_action(scope: dict, action: str, now: dt.datetime) -> None:
    auth = scope.get("authorization", {})
    if auth.get("status") != "granted" or not str(auth.get("basis", "")).strip():
        raise ValueError("authorization is not granted with a recorded basis")
    expires = dt.datetime.fromisoformat(str(auth["expires_at"]).replace("Z", "+00:00"))
    if expires.tzinfo is None or expires <= now:
        raise ValueError("authorization expired or missing timezone")
    if action not in scope.get("actions", []):
        raise ValueError("action is outside the authorized scope")


def validate(scope: dict, action: str, target: str, now: dt.datetime | None = None) -> dict:
    now = now or dt.datetime.now(dt.timezone.utc)
    _validate_scope_action(scope, action, now)
    mode = scope.get("network", {}).get("mode")
    if mode not in {"offline", "loopback", "lab_only", "allowlist"}:
        raise ValueError("unknown network mode")
    targets = scope.get("targets", {})
    if target.startswith(("http://", "https://")):
        if mode == "offline":
            raise ValueError("offline scope forbids network targets")
        exact = _origin(target)
        origins = {_origin(item) for item in targets.get("origins", [])}
        if exact not in origins:
            raise ValueError("origin is outside the exact allowlist")
        if mode == "loopback":
            host = urlsplit(target).hostname
            try:
                if not ipaddress.ip_address(host).is_loopback:
                    raise ValueError("loopback scope requires a numeric loopback address")
            except ValueError as exc:
                raise ValueError("loopback scope requires a numeric loopback address") from exc
    else:
        resolved = Path(target).resolve(strict=True)
        roots = [Path(item).resolve(strict=True) for item in targets.get("paths", [])]
        if not any(resolved == root or resolved.is_relative_to(root) for root in roots):
            raise ValueError("path is outside the authorized roots")
    return {"status": "granted", "action": action, "target": target, "network_mode": mode}


def validate_loopback_endpoint(scope: dict, action: str, endpoint: str,
                               now: dt.datetime | None = None) -> dict:
    now = now or dt.datetime.now(dt.timezone.utc)
    _validate_scope_action(scope, action, now)
    if scope.get("network", {}).get("mode") != "loopback":
        raise ValueError("CDP endpoint requires loopback network mode")
    key = _cdp_endpoint_key(endpoint)
    allowed = {_cdp_endpoint_key(value) for value in scope.get("targets", {}).get("cdp_endpoints", [])}
    if key not in allowed:
        raise ValueError("CDP endpoint is outside the exact endpoint allowlist")
    return {"status": "granted", "action": action, "target": key, "network_mode": "loopback"}


def validate_managed_loopback_endpoint(scope: dict, action: str, endpoint: str,
                                       now: dt.datetime | None = None) -> dict:
    """Validate an endpoint returned by a browser process launched by this verifier."""
    now = now or dt.datetime.now(dt.timezone.utc)
    _validate_scope_action(scope, action, now)
    if scope.get("network", {}).get("mode") != "loopback":
        raise ValueError("managed browser requires loopback network mode")
    key = _cdp_endpoint_key(endpoint)
    return {"status": "granted", "action": action, "target": key, "network_mode": "loopback"}


def validate_replay_page(scope: dict, action: str, page_url: str, endpoint: str) -> dict:
    """Require the replay page's exact origin to be in the case allowlist."""
    validate_loopback_endpoint(scope, action, endpoint)
    parsed = urlsplit(page_url)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password:
        raise ValueError("replay page must be an HTTP(S) URL without credentials")
    return validate(scope, action, page_url)
