const {chromium} = require('../node_modules/playwright');
const assert = require('assert/strict'), path = require('path');

(async () => {
  const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true});
  try {
    const context = await browser.newContext({offline:true, viewport:{width:1200,height:900}});
    const requests = [], errors = [];
    context.on('request', r => { if (/^https?:/.test(r.url())) requests.push(r.url()); });
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(String(e)));
    const idle = () => page.waitForFunction(() => ready && !busy, null, {timeout:90000});
    await page.goto('file:///' + path.resolve(__dirname,'../../csv-sql.html').replaceAll('\\','/'));
    await idle();
    async function query(sql) {
      await page.locator('#sql').fill(sql); await page.locator('#run').click(); await idle();
      const result = await page.evaluate(() => ({output, status:document.getElementById('status').textContent}));
      assert(result.output, result.status);
      return result.output.values;
    }
    async function load(name, text, success = true) {
      const previous = await page.locator('.filecard').count();
      await page.locator('#files').setInputFiles({name, mimeType:'application/octet-stream', buffer:Buffer.from(text)});
      await idle();
      const status = await page.locator('#status').textContent();
      assert.equal(await page.locator('#status').evaluate(el => el.classList.contains('error')), !success, status);
      assert.equal(await page.locator('.filecard').count(), previous + Number(success), status);
      return page.evaluate(() => datasets.at(-1)?.name);
    }
    await page.locator('#header').selectOption('no');
    await page.locator('#delimiter').selectOption(';');
    const json = await load('records.JSON', '\ufeff' + JSON.stringify([
      {id:1, amount:1.5, enabled:true, code:'001', empty:'', missing:null, nested:{text:'a,b"\n日本語'}, list:[1,'a,b'], mixed:1},
      {id:2, amount:2, enabled:false, code:'002', empty:null, missing:'__workbench_null__', extra:'<img src=x onerror=alert(1)>', mixed:'002'}
    ]));
    assert.deepEqual(await query(`SELECT id,amount,enabled,code,empty,missing,nested,list,mixed FROM ${json} ORDER BY id`), [
      ['1','1.5','true','001','',null,'{"text":"a,b\\\"\\n日本語"}','[1,"a,b"]','1'],
      ['2','2.0','false','002',null,'__workbench_null__',null,null,'002']
    ]);
    assert.deepEqual(await query(`SELECT SUM(amount), COUNT(*) FROM ${json}`), [['3.5','2']]);
    assert.equal(await page.locator('#result img').count(), 0);
    console.log('PASS JSON types, missing keys, NULL vs empty, nested values, mixed types and CSV settings isolation');

    const yaml = await load('records.yml', '- id: 1\n  label: "a,b"\n  note: |\n    line1\n    line2\n  date: 2026-11-27\n---\nid: 2\nlabel: \'a"b\'\n');
    assert.deepEqual(await query(`SELECT id,label,note,date FROM ${yaml} ORDER BY id`), [['1','a,b','line1\nline2\n','2026-11-27'],['2','a"b',null,null]]);
    assert.deepEqual(await query(`SELECT a.code,b.label FROM ${json} a JOIN ${yaml} b USING (id) ORDER BY id`), [['001','a,b'],['002','a"b']]);
    console.log('PASS YAML sequences, multiple documents, multiline text, date strings and JSON/YAML JOIN');

    await page.locator('#allText').check();
    const text = await load('single.yaml', 'id: 3\nflag: true\namount: 2.5\ncode: "003"\n');
    assert.deepEqual(await query(`SELECT * FROM ${text}`), [['3','true','2.5','003']]);
    assert((await page.evaluate(() => datasets.at(-1).schema)).every(c => c.type === 'VARCHAR'));
    await page.locator('#allText').uncheck();
    const big = await load('big.json', '{"id":"9007199254740993"}');
    assert.deepEqual(await query(`SELECT CAST(id AS BIGINT) + 1 FROM ${big}`), [['9007199254740994']]);
    const keys = await load('keys.json', '{"__proto__":"safe","a\'b":"value","a\\\"b":2}');
    assert.deepEqual(await query(`SELECT * FROM ${keys}`), [['safe','value','2']]);
    console.log('PASS single object, all-text mode, exact quoted big integer and SQL-safe keys');

    for (const [name, contents] of [
      ['bad.json','{'], ['empty.json',''], ['array.json','[]'], ['scalar.json','1'], ['rows.json','[{},2]'],
      ['columns.json','[{}]'], ['case.json','{"a":1,"A":2}'], ['empty-key.json','{"":1}'],
      ['big.json','{"x":9007199254740993}'], ['infinite.json','{"x":1e999}'],
      ['duplicate.yaml','a: 1\na: 2\n'], ['tag.yaml','a: !!js/function "function() {}"'],
      ['cyclic.yaml','a: &a [*a]'], ['bad.yaml','a: ['], ['huge.json', ' '.repeat(20 * 1024 * 1024 + 1)]
    ]) await load(name, contents, false);
    assert.deepEqual(await query(`SELECT SUM(amount) FROM ${json}`), [['3.5']]);
    console.log('PASS malformed, unsupported and oversized files fail without damaging registered data');
    await load('sparse.json', JSON.stringify(Array.from({length:1001}, (_, i) => ({['column'+i]:i}))), false);

    await page.locator('#header').selectOption('yes'); await page.locator('#delimiter').selectOption('auto');
    const csv = await load('dimension.csv', 'id,name\n1,one\n2,two\n');
    assert.deepEqual(await query(`SELECT c.name,j.amount,y.label FROM ${csv} c JOIN ${json} j USING(id) JOIN ${yaml} y USING(id) ORDER BY id`), [['one','1.5','a,b'],['two','2.0','a"b']]);
    await page.locator('#sql').fill('SELECT SUM(sin(i::DOUBLE)) FROM range(100000000000) r(i)');
    await page.locator('#run').click(); await page.locator('#stop').click(); await idle();
    assert.match(await page.locator('#status').textContent(), /中断.*復元/s);
    assert.deepEqual(await query(`SELECT SUM(amount) FROM ${json}`), [['3.5']]);
    assert.deepEqual(await query(`SELECT label FROM ${yaml} ORDER BY id`), [['a,b'],['a"b']]);
    await page.locator('.filecard').last().locator('button').last().click(); await idle();
    await page.locator('#sample-json').click(); await idle();
    await page.locator('#sample-yaml').click(); await idle();
    assert.equal(await page.evaluate(() => datasets.at(-1).schema.find(c => c.name === 'amount').type), 'BIGINT');
    console.log('PASS CSV/JSON/YAML JOIN, cancellation restoration, removal and samples');

    await page.setViewportSize({width:390,height:844});
    await page.locator('summary').filter({hasText:'JSON・YAML の入力形式'}).click();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(requests, []); assert.deepEqual(errors, []);
    await page.locator('#clear').click(); await idle();
    assert.equal(await page.locator('.filecard').count(), 0);
    console.log('PASS mobile layout, zero HTTP requests/errors and cleanup');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
