// Runs in a dedicated worker. FileReaderSync reads slices of the selected File;
// the CSV is never converted into a single JS string or copied into the WASM FS.
let db, conn;
const qi = value => '"' + value.replaceAll('"', '""') + '"';
const qs = value => "'" + value.replaceAll("'", "''") + "'";
const rows = table => Array.from({length: table.numRows}, (_, i) => table.schema.fields.map((_, j) => table.getChildAt(j).get(i)));

self.onmessage = async ({data: {id, kind, payload}}) => {
  const started = performance.now();
  try {
    let result;
    if (kind === 'init') {
      const wasmURL = URL.createObjectURL(payload.wasm);
      // The CSP only allows blob: connections. Limit the runtime to the one
      // embedded WASM blob as well, including its synchronous HTTP code paths.
      const originalFetch = self.fetch.bind(self);
      self.fetch = (input, options) => {
        const url = typeof input === 'string' ? input : input.url;
        if (url !== wasmURL) throw new Error('外部通信は禁止されています。');
        return originalFetch(input, options);
      };
      self.XMLHttpRequest = class { constructor() { throw new Error('外部通信は禁止されています。'); } };
      const features = await duckdb.getPlatformFeatures();
      if (!features.wasmExceptions) throw new Error('WebAssembly 例外処理に対応した新しいブラウザーが必要です。');
      db = await duckdb.createDuckDB({eh: {mainModule: wasmURL}}, new duckdb.VoidLogger(), duckdb.BROWSER_RUNTIME);
      await db.instantiate(() => {});
      URL.revokeObjectURL(wasmURL);
      db.open({path: ':memory:', maximumThreads: 1, query: {castBigIntToDouble: false, castDecimalToDouble: false}});
      conn = db.connect();
      conn.query("SET autoload_known_extensions = false; SET autoinstall_known_extensions = false; SET memory_limit = '1536MB'; SET threads = 1; SET lock_configuration = true;");
      self.fetch = () => { throw new Error('初期化後の通信は禁止されています。'); };
      result = {version: db.getVersion()};
    } else if (kind === 'import') {
      const {file, name, path, header, delimiter, allText} = payload;
      if (!file.size) throw new Error('空の CSV は読み込めません。');
      db.registerFileHandle(path, file, 2 /* BROWSER_FILEREADER */, true);
      try {
        const options = ["sample_size=20480", "auto_detect=true", "parallel=false", "ignore_errors=false", `all_varchar=${!!allText}`];
        if (header !== 'auto') options.push(`header=${header === 'yes'}`);
        if (delimiter !== 'auto') options.push(`delim=${qs(delimiter)}`);
        // No quotes in the sample must not disable quoting for later rows.
        // Preserve detected nonstandard dialects; otherwise use CSV's standard
        // double quote and doubled-quote escaping, including after the sample.
        const dialect = rows(conn.query(`SELECT Quote, Escape FROM sniff_csv(${qs(path)}, ${options.join(',')})`))[0];
        const detected = value => value && value !== '(empty)' ? value : null;
        const quote = detected(dialect[0]) || '"';
        const escape = detected(dialect[1]) || quote;
        options.push(`quote=${qs(quote)}`, `escape=${qs(escape)}`);
        conn.query(`CREATE VIEW ${qi(name)} AS SELECT * FROM read_csv(${qs(path)}, ${options.join(',')})`);
        const schema = rows(conn.query(`DESCRIBE ${qi(name)}`)).map(row => ({name: row[0], type: row[1]}));
        result = {schema};
      } catch (error) {
        conn.query(`DROP VIEW IF EXISTS ${qi(name)}`);
        db.dropFile(path);
        throw error;
      }
    } else if (kind === 'query') {
      // Nesting makes this one read-only query and applies the result cap inside
      // DuckDB, before Arrow/DOM materialization. Cast there to preserve HUGEINT,
      // DECIMAL and BIGINT precision instead of converting them to JS numbers.
      const sql = payload.sql.trim().replace(/;\s*$/, '');
      if (!sql) throw new Error('SQL を入力してください。');
      const limit = Math.max(1, Math.min(1000, Number(payload.limit) || 100));
      // Preparing also rejects multiple statements, including an input that
      // attempts to close the surrounding subquery and append another command.
      const statement = conn.prepare(`SELECT COLUMNS(*)::VARCHAR FROM (${sql}\n) AS result LIMIT ${limit + 1}`);
      let table;
      try { table = statement.query(); } finally { statement.close(); }
      const values = rows(table);
      const truncated = values.length > limit;
      values.length = Math.min(values.length, limit);
      result = {columns: table.schema.fields.map(f => f.name), values, truncated, limit};
      if (new TextEncoder().encode(JSON.stringify(result)).length > 4 * 1024 * 1024) throw new Error('結果が 4 MiB を超えました。列・行を絞るか、長い文字列を短くしてください。');
    } else if (kind === 'remove') {
      conn.query(`DROP VIEW ${qi(payload.name)}`);
      db.dropFile(payload.path);
      result = {};
    } else {
      throw new Error('不明な操作です。');
    }
    self.postMessage({id, ok: true, result, ms: performance.now() - started});
  } catch (error) {
    self.postMessage({id, ok: false, error: String(error.message || error), ms: performance.now() - started});
  }
};
