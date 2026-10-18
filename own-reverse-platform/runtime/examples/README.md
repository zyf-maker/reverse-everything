# Runtime Fixture

Serve this directory with Python and capture it through the runtime collector:

```powershell
python -m http.server 8770 --bind 127.0.0.1
chrome.exe --headless=new --remote-debugging-port=9270 --user-data-dir=$env:TEMP\rr-runtime-fixture http://127.0.0.1:8770/static-page.html
npx rr-runtime inspect --endpoint http://127.0.0.1:9270
npx rr-runtime capture --endpoint http://127.0.0.1:9270 --duration-ms 1000 --out reference.json
```

The fixture is intentionally local and deterministic. Use it to verify navigation, network, console, and storage evidence before connecting a real authorized target.
