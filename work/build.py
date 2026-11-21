from pathlib import Path
import base64, json, html
p=Path(__file__).parent
glue=(p/'package/dist/chunk-OUKQZV2W.mjs').read_text(encoding='utf-8')
# Use the upstream Emscripten factory directly; do not use the object API.
glue=glue[:glue.index('// src/jq-handle.ts')]
# Only the factory and bundler helpers are needed.
end=glue.index('var import_jq') if 'var import_jq' in glue else len(glue)
glue=glue[:end]
glue=glue.replace('stdoutSink.toString().trim()', 'stdoutSink.toString()').replace('stderrSink.toString().trim()', 'stderrSink.toString()')
glue=glue.replace('if (length >= bytes.length) {', 'if (length >= (Module.outputLimit || 1048576)) { if (!Module.limitHit) { Module.limitHit=true; Module.onOutputLimit(); } throw new Error("OUTPUT_LIMIT"); }\n            if (length >= bytes.length) {')
wasm=base64.b64encode((p/'package/dist/build/jq.wasm').read_bytes()).decode()
worker=glue+'\n'+(p/'worker.js').read_text(encoding='utf-8')
licenses='\n\n'.join(name+'\n'+(p/file).read_text(encoding='utf-8') for name,file in [('jq-wasm (MIT; modified output sink and whitespace handling)','package/LICENSE'),('jq 1.8.2 and bundled components','jq-COPYING'),('Oniguruma','oniguruma-COPYING'),('Emscripten runtime','emscripten-LICENSE')])
page=(p/'page.html').read_text(encoding='utf-8').replace('%%LICENSES%%',html.escape(licenses)).replace('%%WORKER%%',json.dumps(worker).replace('</','<\\/')).replace('%%WASM%%',wasm).replace('%%EXAMPLES%%',(p/'examples.json').read_text(encoding='utf-8')).replace('%%APP%%',(p/'app.js').read_text(encoding='utf-8'))
(p.parent/'jq-playground.html').write_text(page,encoding='utf-8')
print('Built',len(page.encode()),'bytes')
