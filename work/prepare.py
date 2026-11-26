"""Fetch pinned build inputs. Only this development step needs network access."""
from pathlib import Path
import hashlib
import sys
import tarfile
import urllib.request

HERE = Path(__file__).resolve().parent
PACKAGES = [
    ('https://registry.npmjs.org/jq-wasm/-/jq-wasm-3.0.0-jq-1.8.2.tgz',
     'jq-wasm-3.0.0-jq-1.8.2.tgz', 'ef502068f5cb0ca5fd557550cc94a1aedf39143da89aea4182bcdf4640de9bd0',
     {'package/dist/chunk-OUKQZV2W.mjs': 'package/dist/chunk-OUKQZV2W.mjs',
      'package/dist/build/jq.wasm': 'package/dist/build/jq.wasm'}),
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

# Optional Windows native jq for comparison tests; not needed to build the HTML.
if '--with-jq' in sys.argv:
    url = 'https://github.com/jqlang/jq/releases/download/jq-1.8.2/jq-windows-amd64.exe'
    target = HERE / 'jq.exe'
    if not target.exists():
        print('Downloading', url)
        with urllib.request.urlopen(url, timeout=120) as response:
            target.write_bytes(response.read())
    if hashlib.sha256(target.read_bytes()).hexdigest() != 'a6fc67fedaf9128a3309a1e2ebb8b986aeccf70122ee46d2cb4849e423f0c627':
        raise RuntimeError('jq.exe: SHA256 mismatch; remove it and retry')
    print('Verified jq.exe')
