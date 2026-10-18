$server = Start-Process -FilePath 'python' -ArgumentList @('-m','http.server','8766','--bind','127.0.0.1') -WorkingDirectory (Resolve-Path '../../replica-2048') -PassThru
$profilePath = Join-Path $env:TEMP 'rr-runtime-profile-2048'
Remove-Item -LiteralPath $profilePath -Recurse -Force -ErrorAction SilentlyContinue
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$browser = Start-Process -FilePath $chrome -ArgumentList @('--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port=9228',("--user-data-dir={0}" -f $profilePath),'http://127.0.0.1:8766/') -PassThru
try {
  Start-Sleep -Seconds 3
  node src/cli.js capture --endpoint http://127.0.0.1:9228 --page-url http://127.0.0.1:8766/ --allow-origin http://127.0.0.1:8766 --duration-ms 1000 --out "$env:TEMP\rr-runtime-2048.json"
  Get-Content "$env:TEMP\rr-runtime-2048.json" -Raw
} finally {
  Stop-Process -Id $browser.Id -Force -ErrorAction SilentlyContinue
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
}
