const $ = id => document.getElementById(id);
const quote = s => '"' + s.replaceAll('"', '""') + '"';
let worker, ready = false, busy = false, nextId = 0, fileId = 0, pending = new Map(), datasets = [], output = null;
let timer, ticker, operationStart, operationLabel, restoring = false;
const size = n => n >= 1e9 ? `${(n / 1e9).toFixed(2)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(2)} MB` : n >= 1000 ? `${(n / 1000).toFixed(1)} KB` : `${n} B`;
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function controls() {
  const disabled = !ready || busy;
  for (const id of ['files','sample','run','clear']) $(id).disabled = disabled;
  for (const id of ['header','delimiter','allText','limit','timeout']) $(id).disabled = busy;
  $('sql').readOnly = busy;
  for (const el of document.querySelectorAll('[data-example],.fileactions button')) el.disabled = disabled;
  $('stop').disabled = !busy || restoring;
  $('download').disabled = !output || busy;
  $('resultpanel').setAttribute('aria-busy', String(busy));
}
function clearResult() {
  output = null;
  $('result').replaceChildren(Object.assign(document.createElement('div'), {className:'empty', textContent:'実行結果はまだありません。'}));
  $('resultinfo').textContent = '';
  controls();
}
function rpc(kind, payload) {
  return new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, {resolve, reject});
    worker.postMessage({id, kind, payload});
  });
}
function terminate() {
  worker?.terminate();
  for (const promise of pending.values()) promise.reject(new Error('操作を中断しました。'));
  pending.clear();
}
function stopTimers() { clearTimeout(timer); clearInterval(ticker); }
async function initEngine() {
  ready = false;
  controls();
  worker = new Worker(workerURL);
  worker.onmessage = ({data}) => {
    const promise = pending.get(data.id);
    if (!promise) return;
    pending.delete(data.id);
    if (data.ok) promise.resolve(data); else promise.reject(new Error(data.error));
  };
  worker.onerror = event => {
    for (const promise of pending.values()) promise.reject(new Error(event.message || 'Worker が停止しました。データを消去して再起動してください。'));
    pending.clear();
    ready = false;
    status('エンジンが停止しました。ページを再読み込みしてください。', true);
    controls();
  };
  let startupTimer;
  const response = await Promise.race([
    rpc('init', {wasm:wasmBlob}),
    new Promise((_, reject) => { startupTimer = setTimeout(() => reject(new Error('初期化が 45 秒以内に完了しませんでした。ページを再読み込みしてください。')), 45000); })
  ]).finally(() => clearTimeout(startupTimer));
  $('engine').textContent = `DuckDB ${response.result.version} / DuckDB-Wasm 1.32.0 / 単一 Worker / メモリ設定 1,536 MB`;
  ready = true;
  controls();
}
async function perform(label, fn) {
  if (!ready || busy) return;
  busy = true;
  clearResult();
  controls();
  const currentWorker = worker;
  operationStart = performance.now(); operationLabel = label;
  status(`${label}…`);
  ticker = setInterval(() => status(`${label}… ${((performance.now() - operationStart) / 1000).toFixed(1)} 秒`), 250);
  timer = setTimeout(() => cancel('制限時間を超えたため中断しました。'), Number($('timeout').value) * 1000);
  try {
    const message = await fn();
    if (currentWorker === worker) status(message || `${label}が完了しました。`);
  } catch (error) {
    if (currentWorker === worker) status(error.message, true);
  } finally {
    if (currentWorker === worker) { stopTimers(); busy = false; controls(); }
  }
}
async function cancel(message = '処理を中断しました。') {
  if (!busy || restoring) return;
  restoring = true;
  stopTimers();
  terminate();
  clearResult();
  status(`${message} 登録ファイルを復元しています…`);
  controls();
  try {
    await initEngine();
    for (const dataset of datasets) await rpc('import', dataset);
    status(`${message} 登録ファイルを復元しました。再実行できます。`);
  } catch (error) {
    ready = false;
    status(`${message} 復元に失敗しました。ページを再読み込みしてください。\n${error.message}`, true);
  } finally {
    restoring = false; busy = false; controls();
  }
}
function renderFiles() {
  const list = $('filelist'); list.replaceChildren();
  for (const dataset of datasets) {
    const card = document.createElement('div'); card.className = 'filecard';
    const title = document.createElement('strong'); title.textContent = dataset.name;
    const file = document.createElement('div'); file.className = 'filename'; file.textContent = `${dataset.file.name} · ${size(dataset.file.size)}`;
    const schema = document.createElement('div'); schema.className = 'schema';
    for (const column of dataset.schema) {
      const row = document.createElement('div'); row.className = 'column';
      const name = document.createElement('code'); name.textContent = column.name;
      const type = document.createElement('span'); type.textContent = column.type;
      row.append(name, type); schema.append(row);
    }
    const actions = document.createElement('div'); actions.className = 'fileactions';
    const preview = document.createElement('button'); preview.textContent = '先頭行を見る';
    preview.onclick = () => { $('sql').value = `SELECT * FROM ${quote(dataset.name)} LIMIT 100;`; run(); };
    const remove = document.createElement('button'); remove.textContent = '削除';
    remove.onclick = () => perform('ファイルを削除', async () => {
      await rpc('remove', dataset); datasets = datasets.filter(d => d !== dataset); renderFiles(); return `${dataset.name} を削除しました。`;
    });
    actions.append(preview, remove); card.append(title, file, schema, actions); list.append(card);
  }
  controls();
}
async function addFiles(files) {
  const chosen = Array.from(files);
  if (!chosen.length) return;
  await perform('CSV を登録', async () => {
    let last;
    for (const file of chosen) {
      const n = ++fileId;
      const dataset = {file, name:`t${n}`, path:`input-${n}.csv`, header:$('header').value, delimiter:$('delimiter').value, allText:$('allText').checked};
      const response = await rpc('import', dataset);
      dataset.schema = response.result.schema;
      datasets.push(dataset); last = dataset; renderFiles();
    }
    $('sql').value = `SELECT * FROM ${quote(last.name)} LIMIT 100;`;
    return `${chosen.length} ファイルを登録しました（全行の読み取りは SQL 実行時）。「SQL を実行」で確認できます。`;
  });
}
function showResult(result, ms) {
  output = result;
  $('resultinfo').textContent = `${result.values.length.toLocaleString()} 行 · ${result.columns.length} 列 · ${(ms / 1000).toFixed(2)} 秒${result.truncated ? ` · 表示上限 ${result.limit} 行に達しました。保存対象も表示中の行のみです。` : ''}`;
  const table = document.createElement('table');
  const head = document.createElement('thead'), header = document.createElement('tr');
  for (const name of result.columns) { const th = document.createElement('th'); th.scope='col'; th.textContent = name; header.append(th); }
  head.append(header); table.append(head);
  const body = document.createElement('tbody');
  for (const values of result.values) {
    const tr = document.createElement('tr');
    for (const value of values) {
      const td = document.createElement('td');
      td.textContent = value === null ? 'NULL' : value;
      if (value === null) td.className = 'null';
      td.title = td.textContent; tr.append(td);
    }
    body.append(tr);
  }
  table.append(body); $('result').replaceChildren(table);
  if (!result.values.length) $('result').append(Object.assign(document.createElement('p'), {className:'empty', textContent:'該当する行はありません。'}));
  controls();
}
function run() {
  const sql = $('sql').value;
  return perform('SQL を実行', async () => {
    const response = await rpc('query', {sql, limit:Number($('limit').value)});
    showResult(response.result, response.ms);
    return '実行が完了しました。追加の通信はありません。';
  });
}
$('files').onchange = event => { const files = Array.from(event.target.files); event.target.value = ''; addFiles(files); };
for (const name of ['dragenter','dragover']) $('drop').addEventListener(name, event => { event.preventDefault(); $('drop').classList.add('drag'); });
for (const name of ['dragleave','drop']) $('drop').addEventListener(name, event => { event.preventDefault(); $('drop').classList.remove('drag'); });
$('drop').addEventListener('drop', event => addFiles(event.dataTransfer.files));
// Prevent a drop outside the target from navigating away from in-memory work.
window.addEventListener('dragover', event => event.preventDefault());
window.addEventListener('drop', event => event.preventDefault());
$('run').onclick = run;
$('stop').onclick = () => cancel();
$('sql').addEventListener('input', clearResult);
$('sql').addEventListener('keydown', event => { if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) { event.preventDefault(); run(); } });
$('sample').onclick = () => addFiles([new File(['region,month,amount,quantity\n東京,2026-01,1200,3\n大阪,2026-01,800,2\n東京,2026-02,1500,4\n大阪,2026-02,900,3\n'], 'sample.csv', {type:'text/csv'})]);
$('clear').onclick = async () => {
  if (busy) return;
  busy = true; controls(); terminate(); datasets = []; fileId = 0; renderFiles(); clearResult();
  try { await initEngine(); status('すべてのデータを消去しました。'); }
  catch (error) { status(error.message, true); }
  finally { busy = false; controls(); }
};
for (const button of document.querySelectorAll('[data-example]')) button.onclick = () => {
  const dataset = datasets[0];
  if (!dataset) { status('先に CSV を登録してください。', true); return; }
  const name = quote(dataset.name);
  const numeric = dataset.schema.find(c => /INT|DECIMAL|DOUBLE|FLOAT|REAL/.test(c.type));
  const column = numeric ? quote(numeric.name) : null;
  const examples = {
    preview:`SELECT * FROM ${name} LIMIT 100;`,
    count:`SELECT COUNT(*) AS row_count FROM ${name};`,
    sum:column ? `SELECT\n  COUNT(*) AS row_count,\n  MIN(${column}) AS minimum,\n  MAX(${column}) AS maximum,\n  SUM(${column}) AS total,\n  AVG(${column}) AS average\nFROM ${name};` : `SELECT COUNT(*) AS row_count FROM ${name};`,
    join:datasets.length > 1 ? `SELECT a.*, b.*\nFROM ${name} AS a\nJOIN ${quote(datasets[1].name)} AS b\n  ON a.${quote(dataset.schema[0].name)} = b.${quote(datasets[1].schema[0].name)}\nLIMIT 100;` : '-- 2 つ目の CSV を登録すると JOIN の例を作れます。'
  };
  $('sql').value = examples[button.dataset.example]; clearResult();
};
$('download').onclick = () => {
  if (!output) return;
  const cell = value => value === null ? '' : '"' + String(value).replaceAll('"','""') + '"';
  const text = '\uFEFF' + [output.columns, ...output.values].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n';
  const url = URL.createObjectURL(new Blob([text], {type:'text/csv;charset=utf-8'}));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'query-result.csv'; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
// Decode in small chunks, then remove the base64 node to avoid retaining a
// second full text representation. Keep the blobs for restart without downloads.
const wasmBlob = (() => {
  const wasmNode = $('wasm'), chunks = [], encoded = wasmNode.textContent.trim();
  for (let start = 0; start < encoded.length; start += 262144) {
    const binary = atob(encoded.slice(start, start + 262144));
    chunks.push(Uint8Array.from(binary, c => c.charCodeAt(0)));
  }
  wasmNode.remove();
  return new Blob(chunks, {type:'application/wasm'});
})();
const workerURL = URL.createObjectURL(new Blob([LIBRARY_SOURCE, '\n', WORKER_SOURCE], {type:'text/javascript'}));
initEngine().then(() => status('準備完了。CSV を選択してください。通信せずに分析できます。')).catch(error => status(`初期化に失敗しました。${error.message}`, true));
