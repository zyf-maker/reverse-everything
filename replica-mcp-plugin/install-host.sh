#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET="${1:-both}"
case "$TARGET" in codex|claude|both) ;; *) echo 'Usage: ./install-host.sh [codex|claude|both]' >&2; exit 2 ;; esac
NODE="$ROOT/runtime/node/bin/node"
SERVER="$ROOT/server/index.mjs"
[[ -x "$NODE" && -f "$SERVER" ]] || { echo 'Run this from an extracted self-contained package.' >&2; exit 1; }
if [[ "$TARGET" == codex || "$TARGET" == both ]]; then command -v codex >/dev/null || { echo 'Codex CLI was not found.' >&2; exit 1; }; fi
if [[ "$TARGET" == claude || "$TARGET" == both ]]; then command -v claude >/dev/null || { echo 'Claude Code CLI was not found.' >&2; exit 1; }; fi
if [[ "$TARGET" == codex || "$TARGET" == both ]]; then codex mcp add replica-unified -- "$NODE" "$SERVER"; fi
if [[ "$TARGET" == claude || "$TARGET" == both ]]; then claude mcp add --scope user --transport stdio replica-unified -- "$NODE" "$SERVER"; fi
printf 'Registered Reverse Everything with %s. Restart the host and check its MCP server list.\n' "$TARGET"
