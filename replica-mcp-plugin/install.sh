#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKBENCH="$ROOT/../replica-workbench"
command -v node >/dev/null || { echo 'Node.js 20+ is required for the MCP plugin' >&2; exit 1; }
node_major="$(node --version | sed -E 's/^v?([0-9]+).*/\1/')"
(( node_major >= 20 )) || { echo "Node.js 20+ is required; found $(node --version)" >&2; exit 1; }
[[ -f "$WORKBENCH/install.sh" ]] || { echo "Replica Workbench not found at $WORKBENCH" >&2; exit 1; }
bash "$WORKBENCH/install.sh"
npm --prefix "$ROOT" install --ignore-scripts
printf 'Replica MCP plugin installed. Configure mcp.json in your agent host, then run npm run doctor.\n'
