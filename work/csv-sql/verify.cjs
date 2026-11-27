const {chromium}=require('../node_modules/playwright');
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),os=require('os');
const dir=__dirname,expected=require('./fixtures/expected.json');
const results=[],requests=[],errors=[];
let browser,context,page;
const save=()=>fs.writeFileSync(path.join(dir,'verification-results.json'),JSON.stringify({
  date:'2026-11-27',environment:{platform:os.platform(),release:os.release(),cpu:os.cpus()[0].model,ramBytes:os.totalmem(),browser:browser?.version()},
  fixture:expected,requests,errors,results
},null,2)+'\n');
async function test(name,fn){const start=Date.now();try{const details=await fn();results.push({name,pass:true,elapsedMs:Date.now()-start,details});console.log('PASS',name,JSON.stringify(details??{}));}catch(e){results.push({name,pass:false,elapsedMs:Date.now()-start,error:String(e)});console.error('FAIL',name,String(e));}save();}
const idle=()=>page.waitForFunction(()=>ready&&!busy,null,{timeout:660000});
async function query(sql,limit='100'){
  await page.locator('#sql').fill(sql);await page.locator('#limit').selectOption(limit);await page.locator('#run').click();await idle();
  return page.evaluate(()=>({status:document.getElementById('status').textContent,output,info:document.getElementById('resultinfo').textContent}));
}
async function importText(name,text){await page.locator('#files').setInputFiles({name,mimeType:'text/csv',buffer:Buffer.from(text)});await idle();assert(!await page.locator('#status').evaluate(e=>e.classList.contains('error')),await page.locator('#status').textContent());}
(async()=>{
  const downloadsPath=path.join(dir,'fixtures','downloads');fs.mkdirSync(downloadsPath,{recursive:true});
  browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,downloadsPath});
  context=await browser.newContext({offline:true,viewport:{width:1440,height:1050},acceptDownloads:true});
  await context.addInitScript(()=>{File.prototype.text=File.prototype.arrayBuffer=function(){throw Error('Whole-file reads are forbidden by this test');};});
  context.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  page=await context.newPage();page.on('pageerror',e=>errors.push(String(e)));
  await test('standalone offline initialization',async()=>{
    await page.goto('file:///'+path.resolve(dir,'../../csv-sql.html').replaceAll('\\','/'));await idle();
    return {engine:await page.locator('#engine').textContent(),htmlBytes:fs.statSync(path.resolve(dir,'../../csv-sql.html')).size};
  });
  await page.locator('#timeout').selectOption('600');
  await test('1 GiB local File registration (no text/arrayBuffer)',async()=>{
    await page.locator('#files').setInputFiles(path.join(dir,'fixtures/numeric-1gib.csv'));await idle();
    assert.equal(await page.locator('.filecard').count(),1,await page.locator('#status').textContent());
    const schema=await page.evaluate(()=>datasets[0].schema);assert.equal(schema.length,8);assert(schema.every(c=>/BIGINT/.test(c.type)));
    return {schema,wasmHeapBytes:await page.workers()[0].evaluate(()=>db.mod.HEAPU8.buffer.byteLength)};
  });
  await test('1 GiB full scan count + exact sums + min/max',async()=>{
    const r=await query('SELECT COUNT(*) AS n, SUM(c1) AS s1, SUM(c8) AS s8, MIN(c1) AS lo, MAX(c1) AS hi FROM t1');
    assert(r.output,r.status);assert.deepEqual(r.output.values,[[expected.rows,expected.sum_c1,expected.sum_c8,expected.min_c1,expected.max_c1].map(String)]);
    return {result:r.output,info:r.info,wasmHeapBytes:await page.workers()[0].evaluate(()=>db.mod.HEAPU8.buffer.byteLength)};
  });
  await test('1 GiB filter full scan',async()=>{
    const r=await query('SELECT COUNT(*) AS n FROM t1 WHERE c2 = 200000000');assert.deepEqual(r.output?.values,[[String(expected.filtered_rows)]],r.status);return {info:r.info};
  });
  await test('1 GiB GROUP BY full scan',async()=>{
    const r=await query('SELECT c2, COUNT(*) AS n, SUM(c1) AS total FROM t1 GROUP BY c2 ORDER BY c2');assert.equal(r.output?.values.length,100,r.status);assert.deepEqual(r.output.values[0],['200000000',String(expected.filtered_rows),String(expected.group_zero_sum)]);return {info:r.info};
  });
  await test('1 GiB ORDER BY top 10 full scan',async()=>{
    const r=await query('SELECT c1 FROM t1 ORDER BY c1 DESC LIMIT 10');assert.equal(r.output?.values.length,10,r.status);assert(r.output.values.every(row=>row[0]===String(expected.max_c1)));return {info:r.info};
  });
  await test('1 GiB JOIN small dimension CSV',async()=>{
    await importText('dimension.csv','code,label\n200000000,zero\n200000001,one\n');
    const r=await query("SELECT d.label, COUNT(*) AS n FROM t1 AS f JOIN t2 AS d ON f.c2=d.code GROUP BY d.label ORDER BY d.label");
    assert.deepEqual(r.output?.values,[['one',String(expected.filtered_rows)],['zero',String(expected.filtered_rows)]],r.status);return {info:r.info};
  });
  await test('bounded result and exact large integer/decimal display',async()=>{
    let r=await query('SELECT * FROM range(10000)');assert.equal(r.output.values.length,100);assert.equal(r.output.truncated,true);
    r=await query("SELECT 9007199254740993::BIGINT AS big, 12345678901234567890.12::DECIMAL(24,2) AS amount, NULL AS empty");
    assert.deepEqual(r.output.values,[['9007199254740993','12345678901234567890.12',null]]);return r.output;
  });
  await test('quoted CSV, BOM, multiline, Unicode and safe HTML display',async()=>{
    await importText('quoted.csv','\ufeffname,value,note\r\n"日本語",42,"a,b"\r\n"<img src=x onerror=alert(1)>",43,"line1\nline2"\r\n"a""b",44,""\r\n');
    const r=await query('SELECT * FROM t3');assert.equal(r.output.values[1][2],'line1\nline2');assert.equal(r.output.values[2][0],'a"b');assert.equal(await page.locator('#result img').count(),0);return {rows:r.output.values};
  });
  await test('syntax/multiple statements/modification rejected without stale result',async()=>{
    for(const sql of ['SELECT FROM','SELECT 1; SELECT 2','DROP VIEW t1','SELECT * FROM missing_table','SELECT 1) AS result; DROP VIEW t1; SELECT * FROM (SELECT 1']){const r=await query(sql);assert.equal(r.output,null);assert(await page.locator('#download').isDisabled());}
    const r=await query('SELECT c1 FROM t1 LIMIT 1');assert.deepEqual(r.output.values,[['100000000']]);
  });
  await test('external SQL access blocked without network requests',async()=>{
    const n=requests.length;const r=await query("SELECT * FROM read_csv('https://example.com/forbidden.csv')");assert.equal(r.output,null);assert.equal(requests.length,n);return {error:r.status};
  });
  await test('cancel a heavy query and recover all files',async()=>{
    await page.locator('#sql').fill('SELECT SUM(sin(i::DOUBLE)) FROM range(100000000000) AS r(i)');await page.locator('#run').click();
    await page.waitForTimeout(500);await page.locator('#stop').click();await idle();
    assert.match(await page.locator('#status').textContent(),/中断.*復元/s);assert.equal(await page.locator('.filecard').count(),3);
    const r=await query('SELECT c1 FROM t1 LIMIT 1');assert.deepEqual(r.output.values,[['100000000']]);
  });
  await test('CSV export of displayed rows',async()=>{
    const r=await query('SELECT * FROM t3');const event=page.waitForEvent('download');await page.locator('#download').click();const download=await event;
    const stream=await download.createReadStream(),parts=[];for await(const part of stream)parts.push(part);const text=Buffer.concat(parts).toString('utf8');assert(text.startsWith('\ufeff"name"'));assert(text.includes('"a""b"'));assert(text.includes('"line1\nline2"'));assert.equal(r.output.values.length,3);
  });
  await test('desktop and mobile layouts',async()=>{
    await page.screenshot({path:path.join(dir,'desktop.png'),fullPage:true});await page.setViewportSize({width:390,height:844});
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.screenshot({path:path.join(dir,'mobile.png'),fullPage:true});
  });
  await test('zero HTTP/HTTPS requests and no browser errors',async()=>{assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);return {httpRequests:requests.length,pageErrors:errors.length};});
  await test('clear all data',async()=>{await page.locator('#clear').click();await idle();assert.equal(await page.locator('.filecard').count(),0);const r=await query('SELECT * FROM t1');assert.equal(r.output,null);});
  save();await browser.close();if(results.some(r=>!r.pass))process.exitCode=1;
})().catch(async e=>{console.error(e);results.push({name:'fatal',pass:false,error:String(e)});save();await browser?.close();process.exitCode=1;});
