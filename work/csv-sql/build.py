"""Build one self-contained HTML; no runtime package install or network needed."""
from pathlib import Path
import base64
import hashlib
import html
import json
import re

HERE = Path(__file__).resolve().parent
DIST = HERE / 'package' / 'dist'

def js_string(text):
    return json.dumps(text, ensure_ascii=True).replace('</', '<\\/')

library = (DIST / 'duckdb-browser-blocking.mjs').read_text(encoding='utf-8')
library = library.replace('//# sourceMappingURL=duckdb-browser-blocking.mjs.map', '')
# Keep the upstream bundle intact except its export declaration. A classic
# blob Worker then also works from file:// (module imports have opaque origins).
def expose_exports(match):
    exports = []
    for declaration in match.group(1).split(','):
        source, alias = declaration.strip().split(' as ')
        exports.append(f'{json.dumps(alias)}:{source}')
    return 'const duckdb = {' + ','.join(exports) + '};'
library, count = re.subn(r'export\{([^}]+)\};', expose_exports, library)
assert count == 1, 'Upstream export format changed'
library, count = re.subn(r'import\*as (\w+) from"apache-arrow";', r'var \1 = globalThis.Arrow;', library)
assert count == 2, 'Upstream Arrow imports changed'
arrow = (HERE / 'arrow' / 'Arrow.es2015.min.js').read_text(encoding='utf-8')
arrow = re.sub(r'//# sourceMappingURL=.*', '', arrow)
yaml = (HERE / 'yaml' / 'js-yaml.min.js').read_text(encoding='utf-8')
library = arrow + '\n' + library + '\n' + yaml
licenses = '\n\n'.join(name + '\n' + (HERE / name).read_text(encoding='utf-8') for name in ['duckdb-LICENSE', 'arrow-LICENSE', 'arrow-NOTICE', 'sha256-LICENSE', 'ws-LICENSE', 'wasm-feature-detect-LICENSE', 'yaml-LICENSE', '../emscripten-LICENSE'])
licenses = '\n'.join(line.rstrip() for line in licenses.splitlines())
page = (HERE / 'page.html').read_text(encoding='utf-8')
replacements = {
    '%%LICENSES%%': html.escape(licenses),
    '%%WASM%%': base64.b64encode((DIST / 'duckdb-eh.wasm').read_bytes()).decode('ascii'),
    '%%LIBRARY%%': js_string(library),
    '%%WORKER%%': js_string((HERE / 'structured.js').read_text(encoding='utf-8') + '\n' + (HERE / 'worker.js').read_text(encoding='utf-8')),
    '%%APP%%': (HERE / 'app.js').read_text(encoding='utf-8'),
}
for key, value in replacements.items():
    page = page.replace(key, value)
target = HERE.parent.parent / 'csv-sql.html'
target.write_text(page, encoding='utf-8', newline='\n')
print(f'Built {target.name}: {target.stat().st_size:,} bytes')
print('WASM SHA256:', hashlib.sha256((DIST / 'duckdb-eh.wasm').read_bytes()).hexdigest())
