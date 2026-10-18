#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v python3 >/dev/null || { echo 'Python 3.10+ is required' >&2; exit 1; }
command -v node >/dev/null || { echo 'Node.js 18+ is required' >&2; exit 1; }
command -v npm >/dev/null || { echo 'npm is required' >&2; exit 1; }

python_version="$(python3 --version 2>&1)" || { echo "Could not query Python version: $python_version" >&2; exit 1; }
if [[ ! "$python_version" =~ Python[[:space:]]+([0-9]+)\.([0-9]+) ]]; then
  echo "Could not parse Python version: $python_version" >&2
  exit 1
fi
python_major="${BASH_REMATCH[1]}"
python_minor="${BASH_REMATCH[2]}"
if (( python_major < 3 || (python_major == 3 && python_minor < 10) )); then
  echo "Python 3.10+ is required; found $python_version" >&2
  exit 1
fi

node_version="$(node --version 2>&1)" || { echo "Could not query Node.js version: $node_version" >&2; exit 1; }
if [[ ! "$node_version" =~ ^v?([0-9]+)\.([0-9]+) ]]; then
  echo "Could not parse Node.js version: $node_version" >&2
  exit 1
fi
node_major="${BASH_REMATCH[1]}"
if (( node_major < 18 )); then
  echo "Node.js 18+ is required; found $node_version" >&2
  exit 1
fi

npm --version >/dev/null 2>&1 || { echo 'npm version check failed' >&2; exit 1; }

python3 -m venv "$ROOT/.venv"
"$ROOT/.venv/bin/python3" -m pip install --upgrade pip
"$ROOT/.venv/bin/python3" -m pip install -e "$ROOT"
npm --prefix "$ROOT/../own-reverse-platform/runtime" ci --ignore-scripts
printf 'Replica Workbench installed. Run %s/run.sh doctor\n' "$ROOT"
