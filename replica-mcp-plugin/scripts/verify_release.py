"""Check the release ZIP, exact browser notices, and corresponding source assets."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

from browser_notices import convert_credits


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def verify(archive, sources):
    actual_hash = sha256(archive)
    expected_hash = Path(str(archive) + '.sha256').read_text().split()[0]
    assert actual_hash == expected_hash, 'Release ZIP checksum mismatch'
    with zipfile.ZipFile(archive) as package:
        assert package.testzip() is None, 'Corrupt release ZIP member'
        prefix = archive.stem + '/'
        read = lambda path: package.read(prefix + path)
        lock = json.loads(read('browser-lock.json'))
        manifest = json.loads(read('manifest.json'))
        inventory = json.loads(read('licenses/chromium-notice-manifest.json'))
        assert manifest['runtimes']['chromium'] == lock['version']
        assert inventory['archiveSha256'] == lock['sha256']
        browser_hash = hashlib.sha256(read('runtime/chrome/chrome.exe')).hexdigest()
        assert browser_hash == inventory['browserSha256'], 'Notices belong to a different browser'
        raw = read('licenses/chromium-credits.raw.html').decode('utf-8')
        offline, text, products = convert_credits(raw, lock['creditsProducts'])
        assert read('licenses/chromium-THIRD-PARTY-NOTICES.html').decode('utf-8') == offline
        assert read('licenses/chromium-THIRD-PARTY-NOTICES.txt').decode('utf-8') == text
        assert inventory['products'] == len(products) == manifest['notices']['chromiumProducts']
        for name, digest in inventory['files'].items():
            assert hashlib.sha256(read('licenses/' + name)).hexdigest() == digest, name
        for name in ('chromium-LICENSE', 'ungoogled-chromium-LICENSE',
                     'ungoogled-chromium-windows-LICENSE', 'node-LICENSE',
                     'python-LICENSE.txt', 'SOURCE_CODE.md'):
            assert len(read('licenses/' + name)) > 100, f'Missing redistribution material: {name}'
        assert 'chromium-155.0.8059.79-lite.tar.xz' in read('licenses/SOURCE_CODE.md').decode('utf-8')
    source_lock = json.loads((Path(__file__).resolve().parents[1] / 'source-lock.json').read_text())
    source_hashes = {}
    for asset in source_lock['assets']:
        filename = sources / asset['name']
        digest = sha256(filename)
        assert digest == asset['sha256'], f'Source asset checksum mismatch: {filename.name}'
        source_hashes[filename.name] = digest
    return {'passed': True, 'archive': archive.name, 'archiveSha256': actual_hash,
            'browserProducts': len(products), 'sourceAssets': source_hashes}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', type=Path, required=True)
    parser.add_argument('--sources', type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(verify(args.archive, args.sources), indent=2))
