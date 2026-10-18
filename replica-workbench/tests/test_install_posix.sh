#!/usr/bin/env bash
set -euo pipefail

workbench="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
temp_root="$(mktemp -d "${TMPDIR:-/tmp}/replica-install-posix.XXXXXX")"
bin="$temp_root/bin"
mkdir -p "$bin"
trap 'rm -rf "$temp_root"' EXIT

make_mock() {
  local name="$1"
  local body="$2"
  printf '%s\n' '#!/usr/bin/env bash' "$body" > "$bin/$name"
  chmod +x "$bin/$name"
}

make_mock python3 'if [[ "$1" == "--version" ]]; then printf "Python 3.9.18\\n"; exit 0; fi; exit 0'
make_mock node 'if [[ "$1" == "--version" ]]; then printf "v12.22.9\\n"; exit 0; fi; exit 0'
make_mock npm 'if [[ "$1" == "--version" ]]; then printf "8.5.1\\n"; exit 0; fi; exit 0'

output=""
status=0
output="$(PATH="$bin:/usr/bin" bash "$workbench/install.sh" 2>&1)" || status=$?
if (( status == 0 )); then
  printf 'FAIL POSIX installer accepted old Python\n%s\n' "$output" >&2
  exit 1
fi
if [[ "$output" != *'Python 3.10+ is required; found Python 3.9.18'* ]]; then
  printf 'FAIL POSIX installer reported the wrong Python error\n%s\n' "$output" >&2
  exit 1
fi
printf 'PASS python-too-old\n'

make_mock python3 'if [[ "$1" == "--version" ]]; then printf "Python 3.10.12\\n"; exit 0; fi; exit 0'
output=""
status=0
output="$(PATH="$bin:/usr/bin" bash "$workbench/install.sh" 2>&1)" || status=$?
if (( status == 0 )); then
  printf 'FAIL POSIX installer accepted old Node.js\n%s\n' "$output" >&2
  exit 1
fi
if [[ "$output" != *'Node.js 18+ is required; found v12.22.9'* ]]; then
  printf 'FAIL POSIX installer reported the wrong Node.js error\n%s\n' "$output" >&2
  exit 1
fi
printf 'PASS node-too-old\n'
