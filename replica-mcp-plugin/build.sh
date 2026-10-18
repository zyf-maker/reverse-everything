#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
DIST="$ROOT/dist"
mkdir -p "$DIST"
DIST="$(cd "$DIST" && pwd -P)"
VERSION="$(node --input-type=module -e "import fs from 'node:fs'; process.stdout.write(JSON.parse(fs.readFileSync(process.argv[1], 'utf8')).version)" "$ROOT/package.json")"
case "$(uname -s)" in Linux) PLATFORM=linux ;; Darwin) PLATFORM=macos ;; *) echo 'Build on macOS or Linux for native output.' >&2; exit 1 ;; esac
case "$(uname -m)" in x86_64|amd64) ARCH=x64 ;; arm64|aarch64) ARCH=arm64 ;; *) echo "Unsupported architecture: $(uname -m)" >&2; exit 1 ;; esac
DEFAULT_OUT="$DIST/replica-workbench-mcp-$PLATFORM-$ARCH-v$VERSION"
if [[ "${1:-}" == '--clean' ]]; then OUT="$DEFAULT_OUT"; CLEAN='--clean'
else OUT="${1:-$DEFAULT_OUT}"; CLEAN="${2:-}"; fi
[[ "$CLEAN" == '' || "$CLEAN" == '--clean' ]] || { echo 'Second argument must be --clean.' >&2; exit 2; }
mkdir -p "$(dirname "$OUT")"
OUT_PARENT="$(cd "$(dirname "$OUT")" && pwd -P)"
OUT="$OUT_PARENT/$(basename "$OUT")"
[[ "$OUT_PARENT" == "$DIST" && "$(basename "$OUT")" == "replica-workbench-mcp-$PLATFORM-$ARCH-v$VERSION" ]] || {
  echo "Output must be the versioned package directory directly under $DIST." >&2; exit 2;
}
[[ ! -L "$OUT" ]] || { echo 'Refusing to build through a directory symlink.' >&2; exit 2; }
ZIP="$OUT.zip"
HASH="$ZIP.sha256"
if [[ -e "$OUT" || -e "$ZIP" || -e "$HASH" ]]; then
  [[ "$CLEAN" == '--clean' ]] || { echo "Output exists; pass --clean to replace this exact package: $OUT" >&2; exit 2; }
  rm -rf -- "$OUT"
  rm -f -- "$ZIP" "$HASH"
fi

PYTHON_HOME="${PYTHON_HOME:?Set PYTHON_HOME to a portable Python runtime directory}"
NODE_BIN="${NODE_BIN:-$(command -v node)}"
CHROME_HOME="${CHROME_HOME:?Set CHROME_HOME to a Chromium/Chrome installation directory}"
BROWSER_LOCK="${BROWSER_LOCK:?Set BROWSER_LOCK to a verified browser provenance JSON with the exact platform creditsProducts count}"
if [[ -x "$PYTHON_HOME/bin/python3" ]]; then PYTHON_BIN="$PYTHON_HOME/bin/python3"
elif [[ -x "$PYTHON_HOME/bin/python" ]]; then PYTHON_BIN="$PYTHON_HOME/bin/python"
elif [[ -x "$PYTHON_HOME/python3" ]]; then PYTHON_BIN="$PYTHON_HOME/python3"
elif [[ -x "$PYTHON_HOME/python" ]]; then PYTHON_BIN="$PYTHON_HOME/python"
else echo "PythonHome must contain an executable python3: $PYTHON_HOME" >&2; exit 1; fi
NODE_VERSION="$("$NODE_BIN" --version)"
PYTHON_VERSION="$("$PYTHON_BIN" --version 2>&1)"
[[ "${NODE_VERSION#v}" =~ ^([0-9]+) ]] && (( BASH_REMATCH[1] >= 20 )) || { echo "Node.js 20+ required; found $NODE_VERSION" >&2; exit 1; }
[[ "$PYTHON_VERSION" =~ ^Python\ ([0-9]+)\.([0-9]+) ]] && { (( BASH_REMATCH[1] > 3 || (BASH_REMATCH[1] == 3 && BASH_REMATCH[2] >= 10) )) || { echo "Python 3.10+ required; found $PYTHON_VERSION" >&2; exit 1; }; } || { echo "Could not validate Python version: $PYTHON_VERSION" >&2; exit 1; }
if [[ "$PLATFORM" == linux ]]; then
  [[ -x "$CHROME_HOME/chrome" || -x "$CHROME_HOME/chromium" ]] || { echo 'CHROME_HOME must contain chrome or chromium.' >&2; exit 1; }
else
  [[ -x "$CHROME_HOME/Chromium.app/Contents/MacOS/Chromium" || -x "$CHROME_HOME/Google Chrome.app/Contents/MacOS/Google Chrome" || -x "$CHROME_HOME/chrome" ]] || { echo 'CHROME_HOME must contain a Chromium or Chrome executable.' >&2; exit 1; }
fi

mkdir -p "$OUT"
copy_tree() { mkdir -p "$2"; cp -R "$1"/. "$2"/; }
copy_file() { mkdir -p "$(dirname "$2")"; cp "$1" "$2"; }
copy_tree "$ROOT/server" "$OUT/server"
copy_tree "$ROOT/node_modules" "$OUT/node_modules"
for file in README.md plugin.json; do copy_file "$ROOT/$file" "$OUT/$file"; done
copy_tree "$ROOT/.claude-plugin" "$OUT/.claude-plugin"
copy_tree "$ROOT/.codex-plugin" "$OUT/.codex-plugin"
copy_file "$ROOT/install-host.sh" "$OUT/install-host.sh"
copy_file "$ROOT/install-host.ps1" "$OUT/install-host.ps1"
mkdir -p "$OUT/workbench/work"
for name in src scenarios config docs; do copy_tree "$ROOT/../replica-workbench/$name" "$OUT/workbench/$name"; done
for name in pyproject.toml run.ps1 run.sh README.md THIRD_PARTY_NOTICES.md; do copy_file "$ROOT/../replica-workbench/$name" "$OUT/workbench/$name"; done
for name in runtime static-analyzer; do
  copy_tree "$ROOT/../own-reverse-platform/$name/src" "$OUT/own-reverse-platform/$name/src"
  if [[ -d "$ROOT/../own-reverse-platform/$name/node_modules" ]]; then copy_tree "$ROOT/../own-reverse-platform/$name/node_modules" "$OUT/own-reverse-platform/$name/node_modules"; fi
  for file in package.json package-lock.json; do [[ -f "$ROOT/../own-reverse-platform/$name/$file" ]] && copy_file "$ROOT/../own-reverse-platform/$name/$file" "$OUT/own-reverse-platform/$name/$file"; done
done

NODE_REL='runtime/node/bin/node'
mkdir -p "$OUT/runtime/node/bin"
cp "$NODE_BIN" "$OUT/$NODE_REL"
chmod +x "$OUT/$NODE_REL"
copy_tree "$CHROME_HOME" "$OUT/runtime/chrome"
mkdir -p "$OUT/runtime/python"
copy_tree "$PYTHON_HOME" "$OUT/runtime/python"
find "$OUT/runtime/python" -type d \( -name site-packages -o -name __pycache__ \) -prune -exec rm -rf {} +
if [[ -x "$OUT/runtime/python/bin/python3" ]]; then PYTHON_REL='runtime/python/bin/python3'
elif [[ -x "$OUT/runtime/python/bin/python" ]]; then PYTHON_REL='runtime/python/bin/python'
elif [[ -x "$OUT/runtime/python/python3" ]]; then PYTHON_REL='runtime/python/python3'
else PYTHON_REL='runtime/python/python'; fi
if [[ -x "$OUT/runtime/chrome/chrome" ]]; then BROWSER_REL='runtime/chrome/chrome'
elif [[ -x "$OUT/runtime/chrome/chromium" ]]; then BROWSER_REL='runtime/chrome/chromium'
elif [[ -x "$OUT/runtime/chrome/Chromium.app/Contents/MacOS/Chromium" ]]; then BROWSER_REL='runtime/chrome/Chromium.app/Contents/MacOS/Chromium'
else BROWSER_REL='runtime/chrome/Google Chrome.app/Contents/MacOS/Google Chrome'; fi

node --input-type=module - "$OUT" "$VERSION" "$PLATFORM-$ARCH" "$NODE_VERSION" "$PYTHON_VERSION" "$NODE_REL" "$PYTHON_REL" "$BROWSER_REL" <<'NODE'
import fs from 'node:fs';
import path from 'node:path';
const [root, version, platform, nodeVersion, pythonVersion, nodePath, pythonPath, browserPath] = process.argv.slice(2);
const writeJson = (name, value) => fs.writeFileSync(path.join(root, name), `${JSON.stringify(value, null, 2)}\n`);
writeJson('manifest.json', {
  name: 'replica-workbench-mcp', version, platform, selfContained: true,
  entry: 'server/index.mjs', browser: browserPath, node: nodePath, python: pythonPath,
  runtimes: { node: nodeVersion, python: pythonVersion },
  hosts: ['codex', 'claude-code', 'mcp-compatible']
});
writeJson('mcp.json', { mcpServers: {
  'replica-workbench': { type: 'stdio', command: '\${PLUGIN_ROOT}/' + nodePath, args: ['\${PLUGIN_ROOT}/server/index.mjs'], cwd: '\${PLUGIN_ROOT}' }
} });
writeJson('.mcp.json', { mcpServers: {
  'replica-workbench': { command: '\${CLAUDE_PLUGIN_ROOT}/' + nodePath, args: ['\${CLAUDE_PLUGIN_ROOT}/server/index.mjs'], cwd: '\${CLAUDE_PLUGIN_ROOT}' }
} });
NODE

mkdir -p "$OUT/licenses"
for spec in "$(dirname "$NODE_BIN")/LICENSE:node-LICENSE" "$(dirname "$NODE_BIN")/node_modules/npm/LICENSE:npm-LICENSE" "$PYTHON_HOME/LICENSE.txt:python-LICENSE.txt" "$CHROME_HOME/LICENSE:chromium-LICENSE" "$CHROME_HOME/LICENSES.chromium.html:chromium-LICENSES.html" "$CHROME_HOME/ABOUT:chromium-ABOUT"; do
  source="${spec%:*}"; name="${spec##*:}"
  [[ -f "$source" ]] && copy_file "$source" "$OUT/licenses/$name"
done
for license in node-LICENSE python-LICENSE.txt chromium-LICENSE; do
  [[ -s "$OUT/licenses/$license" ]] || { echo "Required runtime license missing: $license" >&2; exit 1; }
done
"$PYTHON_BIN" "$ROOT/scripts/browser_notices.py" --browser "$OUT/$BROWSER_REL" --output "$OUT/licenses" --lock "$BROWSER_LOCK"
copy_file "$BROWSER_LOCK" "$OUT/browser-lock.json"
printf '%s\n' 'Runtime licenses and generated browser third-party notices are included in this directory.' 'Node module licenses are retained under node_modules.' 'See workbench/THIRD_PARTY_NOTICES.md for project dependency notices.' > "$OUT/licenses/README.txt"

"$PYTHON_BIN" - "$OUT" "$ZIP" <<'PY'
import os, sys, zipfile
source, archive = sys.argv[1:]
parent = os.path.dirname(source)
with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as zf:
    for current, directories, files in os.walk(source):
        directories.sort()
        for name in sorted(files):
            filename = os.path.join(current, name)
            zf.write(filename, os.path.relpath(filename, parent))
PY
if command -v sha256sum >/dev/null; then sha256sum "$ZIP" > "$HASH"; else shasum -a 256 "$ZIP" > "$HASH"; fi
printf 'Built self-contained MCP plugin: %s\nArchive: %s\n' "$OUT" "$ZIP"
