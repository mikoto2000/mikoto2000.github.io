// JSON/YAML conversion is isolated from the original CSV direct-I/O path.
function structuredInput(file, format, allText) {
  if (file.size > 20 * 1024 * 1024) throw new Error('JSON・YAML は 1 ファイル 20 MiB までです。');
  const text = new FileReaderSync().readAsText(file, 'UTF-8').replace(/^\uFEFF/, '');
  let documents;
  try {
    documents = format === 'yaml'
      ? jsyaml.loadAll(text, null, {schema: jsyaml.JSON_SCHEMA})
      : [JSON.parse(text)];
  } catch (error) {
    throw new Error(`${format.toUpperCase()} の解析に失敗しました: ${error.message}`);
  }
  const records = [];
  for (const document of documents) {
    if (Array.isArray(document)) { for (const record of document) records.push(record); }
    else records.push(document);
  }
  if (!records.length) throw new Error('読み込める行がありません。オブジェクトまたはその配列を指定してください。');
  const names = new Set(), types = new Map(), active = new WeakSet();
  let nodes = 0, characters = 0;
  function validate(value, depth = 0) {
    if (++nodes > 1000000 || depth > 50) throw new Error('JSON・YAML の要素数またはネストが上限を超えています。');
    if (typeof value === 'string') characters += value.length;
    if (characters > 32 * 1024 * 1024) throw new Error('JSON・YAML の展開後の文字列が大きすぎます。');
    if (typeof value === 'number' && (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value)))) {
      throw new Error('非有限数や安全な整数範囲を超える数値は読み込めません。大きな整数は引用符で囲んで文字列にしてください。');
    }
    if (value && typeof value === 'object') {
      if (active.has(value)) throw new Error('循環参照を含む YAML は読み込めません。');
      active.add(value);
      for (const [key, child] of Object.entries(value)) { characters += key.length; validate(child, depth + 1); }
      active.delete(value);
    }
  }
  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) throw new Error('各行はオブジェクトにしてください。スカラーや配列の行には対応していません。');
    validate(record);
    for (const [name, value] of Object.entries(record)) {
      names.add(name);
      if (value === null) continue;
      const type = typeof value === 'number' ? (Number.isInteger(value) ? 'BIGINT' : 'DOUBLE') : typeof value === 'boolean' ? 'BOOLEAN' : 'VARCHAR';
      const previous = types.get(name);
      types.set(name, !previous || previous === type ? type : [previous, type].every(t => ['BIGINT', 'DOUBLE'].includes(t)) ? 'DOUBLE' : 'VARCHAR');
    }
  }
  if (!names.size) throw new Error('列がありません。少なくとも 1 つのキーを指定してください。');
  if (records.length * names.size > 1000000) throw new Error('JSON・YAML の行数 × 列数が 1,000,000 を超えています。');
  // DuckDB identifiers are case insensitive. Reject ambiguous keys instead of
  // silently renaming columns or losing a value (including empty column names).
  const identifiers = new Set();
  for (const name of names) {
    const identifier = name.replace(/[A-Z]/g, c => c.toLowerCase());
    if (!name || identifiers.has(identifier)) throw new Error('空の列名や大文字・小文字だけが異なる列名は使えません。');
    identifiers.add(identifier);
  }
  const scalar = value => value == null ? null : typeof value === 'object' ? JSON.stringify(value) : String(value);
  let nullValue = '__workbench_null__';
  const values = records.map(record => Array.from(names, name => scalar(Object.hasOwn(record, name) ? record[name] : null)));
  const strings = new Set(values.flat());
  while (strings.has(nullValue)) nullValue += '_';
  const cell = value => value === null ? nullValue : '"' + value.replaceAll('"', '""') + '"';
  const csv = values.map(row => row.map(cell).join(',')).join('\n') + '\n';
  if (new TextEncoder().encode(csv).length > 64 * 1024 * 1024) throw new Error('JSON・YAML の展開後のデータが 64 MiB を超えています。');
  const columns = Array.from(names, name => `${qs(name)}:${qs(allText ? 'VARCHAR' : types.get(name) || 'VARCHAR')}`).join(',');
  return {
    file: new File([csv], 'normalized.csv', {type: 'text/csv'}),
    options: [`auto_detect=false`, `header=false`, `delim=','`, `quote='"'`, `escape='"'`, `parallel=false`, `ignore_errors=false`, `nullstr=${qs(nullValue)}`, `allow_quoted_nulls=false`, `columns={${columns}}`]
  };
}
