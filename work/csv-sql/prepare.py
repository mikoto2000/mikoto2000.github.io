"""Fetch pinned build inputs. Only this development step needs network access."""
from pathlib import Path
import hashlib
import tarfile
import urllib.request

HERE = Path(__file__).resolve().parent
PACKAGES = [
    ('https://registry.npmjs.org/js-yaml/-/js-yaml-4.1.1.tgz',
     'js-yaml-4.1.1.tgz', '948181607d4fb62dde7b9e04a62d89b20e62cd0c5659ceb711bc31768d00436f',
     {'package/dist/js-yaml.min.js': 'yaml/js-yaml.min.js',
      'package/LICENSE': 'yaml-LICENSE'}),
    ('https://registry.npmjs.org/@duckdb/duckdb-wasm/-/duckdb-wasm-1.32.0.tgz',
     'duckdb-wasm-1.32.0.tgz', '13c29d80888b795cb493b281685d3d3e1738db2fad50d419e2884c6585789722',
     {'package/dist/duckdb-browser-blocking.mjs': 'package/dist/duckdb-browser-blocking.mjs',
      'package/dist/duckdb-eh.wasm': 'package/dist/duckdb-eh.wasm'}),
    ('https://registry.npmjs.org/apache-arrow/-/apache-arrow-17.0.0.tgz',
     'apache-arrow-17.0.0.tgz', '3517f9ef256e9e5bf819f92652028545131660784c68818604e9025ec643b317',
     {'package/Arrow.es2015.min.js': 'arrow/Arrow.es2015.min.js'}),
]

for url, filename, checksum, members in PACKAGES:
    archive = HERE / filename
    if not archive.exists():
        print('Downloading', url)
        with urllib.request.urlopen(url, timeout=120) as response, archive.open('wb') as output:
            while chunk := response.read(1024 * 1024):
                output.write(chunk)
    actual = hashlib.sha256(archive.read_bytes()).hexdigest()
    if actual != checksum:
        raise RuntimeError(f'{filename}: SHA256 mismatch; remove the incomplete archive and retry')
    # Write only explicitly selected regular files. Never extract arbitrary paths.
    with tarfile.open(archive) as package:
        for source, destination in members.items():
            member = package.getmember(source)
            if not member.isfile():
                raise RuntimeError(f'Unexpected archive member: {source}')
            target = HERE / destination
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(package.extractfile(member).read())
    print('Verified and prepared', filename)
