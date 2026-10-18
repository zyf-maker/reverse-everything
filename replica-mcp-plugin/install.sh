#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null || { echo 'Node.js 20+ is required for the MCP plugin' >&2; exit 1; }
node_major="$(node --version | sed -E 's/^v?([0-9]+).*/\1/')"
(( node_major >= 20 )) || { echo "Node.js 20+ is required; found $(node --version)" >&2; exit 1; }
npm --prefix "$ROOT" ci --ignore-scripts
printf 'Reverse Everything MCP dependencies installed. Register replica-unified with your MCP host.\n'
