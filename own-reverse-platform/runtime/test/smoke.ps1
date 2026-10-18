$fixture = Resolve-Path (Join-Path $PSScriptRoot '..\examples')
$server = Start-Process -FilePath 'python' -ArgumentList @('-m','http.server','8769','--bind','127.0.0.1') -WorkingDirectory $fixture -PassThru
$profilePath = Join-Path $env:TEMP 'rr-runtime-profile'
Remove-Item -LiteralPath $profilePath -Recurse -Force -ErrorAction SilentlyContinue
$chrome = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
$pageUrl = 'http://127.0.0.1:8769/static-page.html'
$process = Start-Process -FilePath $chrome -ArgumentList @('--headless=new','--disable-gpu','--no-sandbox','--remote-debugging-port=9227',("--user-data-dir={0}" -f $profilePath),$pageUrl) -PassThru
try {
  Start-Sleep -Seconds 2
  Invoke-WebRequest -UseBasicParsing 'http://127.0.0.1:9227/json/version' | Select-Object -ExpandProperty Content
  node src/cli.js capture --endpoint http://127.0.0.1:9227 --page-url $pageUrl --allow-origin http://127.0.0.1:8769 --duration-ms 250 --out "$env:TEMP\rr-runtime-smoke.json"
  Get-Content "$env:TEMP\rr-runtime-smoke.json" -Raw
} finally {
  Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
  Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
}
