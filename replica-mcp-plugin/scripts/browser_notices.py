"""Export the bundled browser's actual generated notices; reject sample credits."""
import argparse
import hashlib
import html
import json
from pathlib import Path
import re
import subprocess
import tempfile


def convert_credits(document, expected_products=None):
    products = re.split(r'<div class="product">', document)[1:]
    notices = []
    for product in products:
        title = re.search(r'<span class="title">(.*?)</span>', product, re.S)
        license_text = re.search(r'<div class="license">\s*<pre>(.*?)</pre>', product, re.S)
        homepage = re.search(r'<span class="homepage"><a href="([^"]+)"', product)
        if not title or not license_text or not license_text[1].strip():
            raise ValueError("Browser credits contain a component with missing license text")
        notices.append({"name": html.unescape(title[1]),
                        "homepage": html.unescape(homepage[1]) if homepage else "",
                        "license": html.unescape(license_text[1])})
    if len(notices) < 100 or (expected_products is not None and len(notices) != expected_products):
        raise ValueError(f"Incomplete/sample browser credits: {len(notices)} products; expected {expected_products or 'at least 100'}")
    names = ' '.join(item['name'] for item in notices).lower()
    if not all(name in names for name in ('boringssl', 'zlib', 'icu', 'png')):
        raise ValueError("Browser credits are missing expected Chromium dependencies")
    offline = re.sub(r'<link\b[^>]*>', '', document)
    offline = re.sub(r'<script\b[^>]*>.*?</script>', '', offline, flags=re.S)
    offline = offline.replace('</head>', '''<style>
body{font:16px/1.5 system-ui,sans-serif;max-width:1100px;margin:40px auto;padding:0 24px}
.product{border-top:1px solid #aaa;margin:24px 0;padding-top:16px}
.title{font-size:1.2em;font-weight:600}.homepage{margin-left:16px}
.show,#print-link{display:none}.license{display:block!important}
pre{white-space:pre-wrap;overflow-wrap:anywhere;font:13px/1.5 monospace}
</style></head>''')
    if 'chrome://' in offline:
        raise ValueError("Export still references browser-only resources")
    text = '\n\n'.join(f"{item['name']}\n{item['homepage']}\n{'=' * 72}\n{item['license']}" for item in notices)
    return offline, text + '\n', notices


def export_notices(browser, destination, lock):
    destination.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='replica-credits-') as profile:
        completed = subprocess.run([
            str(browser.resolve()), '--headless=new', '--disable-gpu',
            '--disable-extensions', '--disable-background-networking', '--no-first-run',
            '--allow-chrome-scheme-url', f'--user-data-dir={profile}',
            '--dump-dom', 'chrome://credits/',
        ], capture_output=True, timeout=60,
           creationflags=getattr(subprocess, 'CREATE_NO_WINDOW', 0))
    if completed.returncode:
        raise RuntimeError(f"Browser credits export failed ({completed.returncode}): {completed.stderr[-2000:]!r}")
    document = completed.stdout.decode('utf-8')
    offline, text, notices = convert_credits(document, lock['creditsProducts'])
    (destination / 'chromium-credits.raw.html').write_bytes(completed.stdout)
    (destination / 'chromium-THIRD-PARTY-NOTICES.html').write_text(offline, encoding='utf-8', newline='\n')
    (destination / 'chromium-THIRD-PARTY-NOTICES.txt').write_text(text, encoding='utf-8', newline='\n')
    inventory = {
        'distribution': lock['distribution'], 'version': lock['version'],
        'revision': lock['revision'], 'archiveSha256': lock['sha256'],
        'browserSha256': hashlib.sha256(browser.read_bytes()).hexdigest(),
        'generatedFrom': 'chrome://credits/', 'products': len(notices),
        'components': [{'name': item['name'], 'homepage': item['homepage']} for item in notices],
        'files': {p.name: hashlib.sha256(p.read_bytes()).hexdigest()
                  for p in sorted(destination.glob('chromium-*')) if p.is_file()},
    }
    (destination / 'chromium-notice-manifest.json').write_text(json.dumps(inventory, indent=2) + '\n', encoding='utf-8')
    return inventory


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--browser', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--lock', type=Path, required=True)
    args = parser.parse_args()
    result = export_notices(args.browser, args.output, json.loads(args.lock.read_text(encoding='utf-8')))
    print(json.dumps({'products': result['products'], 'browserSha256': result['browserSha256']}))
