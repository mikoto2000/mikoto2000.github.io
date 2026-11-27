const {chromium} = require('../node_modules/playwright');
const assert = require('assert/strict'), path = require('path'), fs = require('fs');

(async () => {
  const downloadsPath = path.join(__dirname, 'fixtures', 'downloads');
  fs.mkdirSync(downloadsPath, {recursive:true});
  const browser = await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true, downloadsPath});
  try {
    const context = await browser.newContext({offline:true, acceptDownloads:true});
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
    async function load(text) {
      await page.locator('#clear').click(); await idle();
      await page.locator('#files').setInputFiles({name:'late-quotes.csv', mimeType:'text/csv', buffer:Buffer.from(text)});
      await idle();
      assert.equal(await page.locator('.filecard').count(),1,await page.locator('#status').textContent());
    }
    const tail = [
      ['a,b','7'], ['a"b','8'], ['line1\nline2','9'], ['a,"b"\nnext','10']
    ];
    const cell = s => '"' + s.replaceAll('"','""') + '"';
    const suffix = tail.map(row => row.map(cell).join(',')).join('\n') + '\n';
    await load('name,amount\n' + 'plain,1\n'.repeat(30000) + suffix);
    assert.deepEqual(await query('SELECT * FROM t1 LIMIT 1'), [['plain','1']]);
    assert.deepEqual(await query('SELECT COUNT(*), SUM(amount) FROM t1'), [['30004','30034']]);
    assert.deepEqual(await query('SELECT * FROM t1 OFFSET 30000'), tail);
    assert.deepEqual(await query("SELECT name,SUM(amount) FROM t1 WHERE name LIKE '%,%' GROUP BY name ORDER BY name"), [['a,"b"\nnext','10'],['a,b','7']]);
    assert.deepEqual(await query("SELECT a.name,b.amount FROM t1 a JOIN t1 b ON a.name=b.name WHERE a.amount=7"), [['a,b','7']]);
    console.log('PASS late commas, doubled quotes, multiline, aggregation, filter, sort and JOIN');

    const downloadEvent = page.waitForEvent('download');
    await query('SELECT * FROM t1 OFFSET 30000'); await page.locator('#download').click();
    const download = await downloadEvent, parts = [];
    for await (const part of await download.createReadStream()) parts.push(part);
    const exported = Buffer.concat(parts).toString('utf8');
    assert(exported.includes('"a,""b""\nnext"'));
    await load(exported);
    assert.deepEqual(await query('SELECT * FROM t1'), tail);
    console.log('PASS CSV export/import round trip');

    // Quotes are present early, but escaped quotes only appear after the sample.
    await load('name,amount\n' + '"a,b",1\n'.repeat(30000) + '"a""b",2\n');
    assert.deepEqual(await query('SELECT * FROM t1 OFFSET 30000'), [['a"b','2']]);
    console.log('PASS late doubled quote with early quoted fields');

    // Keep existing dialect detection and settings working.
    await load("name,amount\n'one,two',1\n'other,value',2\n");
    assert.deepEqual(await query('SELECT * FROM t1'), [['one,two','1'],['other,value','2']]);
    await page.locator('#header').selectOption('no');
    await page.locator('#delimiter').selectOption('\t');
    await page.locator('#allText').check();
    await load('plain\t001\n'.repeat(30000) + '"a,b"\t002\n');
    assert.deepEqual(await query('SELECT * FROM t1 OFFSET 30000'), [['a,b','002']]);
    console.log('PASS single quote dialect, TSV, no header and all-text mode');

    await page.locator('#sql').fill('SELECT SUM(sin(i::DOUBLE)) FROM range(100000000000) r(i)');
    await page.locator('#run').click(); await page.locator('#stop').click(); await idle();
    assert.match(await page.locator('#status').textContent(), /中断.*復元/s);
    assert.deepEqual(await query('SELECT * FROM t1 OFFSET 30000'), [['a,b','002']]);
    assert.deepEqual(requests, []); assert.deepEqual(errors, []);
    console.log('PASS cancellation restores quoting; zero HTTP requests and browser errors');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
