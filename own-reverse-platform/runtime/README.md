# Own Reverse Runtime

This module collects browser behavior through the public Chrome DevTools Protocol (CDP). It has no dependency on proprietary runtime-inspection products or their source code.

## Install

```powershell
npm install
npm test
```

Start Chromium with a loopback debugging port, then open the target page:

```powershell
chrome.exe --remote-debugging-port=9227 --user-data-dir=$env:TEMP\rr-runtime-profile
```

## Capture

```powershell
npx rr-runtime capture --endpoint http://127.0.0.1:9227 --page-url http://127.0.0.1:8765/ --allow-origin http://127.0.0.1:8765 --duration-ms 5000 --out evidence.json
npx rr-runtime capture --endpoint http://127.0.0.1:9227 --page-url http://127.0.0.1:8765/ --allow-origin http://127.0.0.1:8765 --duration-ms 5000 --format jsonl --out evidence.jsonl
```

The evidence includes navigations, console output, JavaScript exceptions, logs, requests, responses, storage mutations, page metadata, and a local/session storage snapshot.

Inspect the browser version and page targets, or evaluate one of the fixed read-only expressions:

```powershell
npx rr-runtime inspect --endpoint http://127.0.0.1:9227
npx rr-runtime evaluate --endpoint http://127.0.0.1:9227 --page-url http://127.0.0.1:8765/ --allow-origin http://127.0.0.1:8765 --expression snapshot
```

The evaluator rejects expressions outside its allowlist; it is not an arbitrary code execution interface.

## Compare

```powershell
npx rr-runtime compare --reference reference.json --replica replica.json --out comparison.json
```

The comparison checks event-kind counts, local-storage key shape, and error-free execution. It is intentionally a signal for a broader behavioral test suite, not a claim of source equivalence.

Every page operation requires an exact page URL and one or more explicit HTTP(S) origin allowlist entries. The runtime rejects credential-bearing or non-bare CDP endpoints, requires the debugger WebSocket to remain on that endpoint's port, and blocks requests outside the listed origins on the selected page target. This is not browser-wide egress enforcement: worker and service-worker targets are not guarded. Capture and replay evidence mark this boundary as `selected-page-target-only`; the workbench must not treat it as containment for all browser targets. The caller remains responsible for obtaining authorization; the workbench adapter additionally checks the case authorization record before starting the runtime.
