#!/usr/bin/env bash
# Shared core avoids divergent Windows/Unix readiness logic. No installation.
set -u
ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="${REVERSE_REPLICA_PYTHON:-python3}"
if ! command -v "$PYTHON" >/dev/null 2>&1; then
  printf '%s\n' '{"verdict":"BLOCKED","error":"Python 3 is required; nothing installed"}'
  exit 1
fi
exec "$PYTHON" "$ROOT/preflight.py" "$@"
