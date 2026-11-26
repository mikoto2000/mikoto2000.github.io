const {chromium}=require('../node_modules/playwright');
const http=require('http'),fs=require('fs'),path=require('path'),assert=require('assert/strict');
const expected=require('./fixtures/expected.json'),dir=__dirname,results=[];
let server,browser;
const save=()=>fs.writeFileSync(path.join(dir,'http-results.json'),JSON.stringify(results,null,2)+'\n');
async function check(name,fn){try{const data=await fn();results.push({name,pass:true,...data});console.log('PASS',name,JSON.stringify(data||{}));}catch(e){results.push({name,pass:false,error:String(e)});console.log('FAIL',name,String(e));}save();}
async function session(executablePath,url){
  browser=await chromium.launch({executablePath,headless:true});
  const ctx=await browser.newContext({viewport:{width:1200,height:900}}),requests=[],errors=[];
  ctx.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  const p=await ctx.newPage();p.on('pageerror',e=>errors.push(String(e)));
  const idle=()=>p.waitForFunction(()=>ready&&!busy,null,{timeout:660000});
  await p.goto(url);await idle();
  async function query(sql){await p.locator('#sql').fill(sql);await p.locator('#run').click();await idle();return p.evaluate(()=>({output,status:document.getElementById('status').textContent,info:document.getElementById('resultinfo').textContent}));}
  return {ctx,p,requests,errors,idle,query};
}
(async()=>{
  let serverRequests=0;
  server=http.createServer((req,res)=>{serverRequests++;res.setHeader('Content-Type','text/html; charset=utf-8');fs.createReadStream(path.resolve(dir,'../../csv-sql.html')).pipe(res);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/csv-sql.html`;
  let s=await session('C:/Program Files/Google/Chrome/Application/chrome.exe',url);
  await check('HTTP startup requires only HTML; live network SQL blocked',async()=>{
    assert.deepEqual(s.requests,[url]);assert.equal(serverRequests,1);
    for(const sql of ["SELECT * FROM read_csv('https://example.com/private.csv')","SELECT * FROM read_parquet('https://example.com/private.parquet')"]){const r=await s.query(sql);assert.equal(r.output,null,r.status);}
    assert.deepEqual(s.requests,[url]);return {requests:s.requests,serverRequests};
  });
  await s.ctx.setOffline(true);
  await check('HTTP page + offline 1 GiB full scan',async()=>{
    await s.p.locator('#files').setInputFiles(path.join(dir,'fixtures/numeric-1gib.csv'));await s.idle();
    const r=await s.query('SELECT COUNT(*) AS n, SUM(c1) AS s1, SUM(c8) AS s8 FROM t1');assert.deepEqual(r.output?.values,[[expected.rows,expected.sum_c1,expected.sum_c8].map(String)],r.status);
    assert.equal(serverRequests,1);assert.deepEqual(s.requests,[url]);return {browser:browser.version(),result:r.output.values,info:r.info,httpRequestsAfterStartup:s.requests.length-1,wasmHeapBytes:await s.p.workers()[0].evaluate(()=>db.mod.HEAPU8.buffer.byteLength)};
  });
  await check('automatic timeout restores registered files',async()=>{
    await s.p.locator('#timeout').evaluate(el=>{el.add(new Option('test 0.3 seconds','0.3'));el.value='0.3';});
    const r=await s.query('SELECT SUM(sin(i::DOUBLE)) FROM range(100000000000) AS r(i)');assert.equal(r.output,null);assert.match(r.status,/制限時間.*復元/s);
    await s.p.locator('#timeout').selectOption('120');const next=await s.query('SELECT c1 FROM t1 LIMIT 1');assert.deepEqual(next.output.values,[['100000000']]);
  });
  await check('settings: TSV, no header and all-text preserve zeros',async()=>{
    await s.p.locator('#clear').click();await s.idle();await s.p.locator('#header').selectOption('no');await s.p.locator('#delimiter').selectOption('\t');await s.p.locator('#allText').check();
    await s.p.locator('#files').setInputFiles({name:'no-header.tsv',mimeType:'text/tab-separated-values',buffer:Buffer.from('001\t42\n002\t43\n')});await s.idle();
    const r=await s.query('WITH source AS (SELECT * FROM t1) SELECT * FROM source');assert.deepEqual(r.output?.values,[['001','42'],['002','43']],r.status);
  });
  await check('empty inputs fail and recover',async()=>{
    await s.p.locator('#files').setInputFiles({name:'empty.csv',mimeType:'text/csv',buffer:Buffer.alloc(0)});await s.idle();assert.match(await s.p.locator('#status').textContent(),/空の CSV/);
    const r=await s.query('SELECT COUNT(*) FROM t1');assert.deepEqual(r.output.values,[['2']]);
  });
  await check('keyboard shortcut and cleanup',async()=>{
    await s.p.locator('#sql').fill('SELECT 42 AS answer');await s.p.locator('#sql').press('Control+Enter');await s.idle();assert.deepEqual(await s.p.evaluate(()=>output.values),[['42']]);
    await s.p.locator('.fileactions button').last().click();await s.idle();assert.equal(await s.p.locator('.filecard').count(),0);assert.deepEqual(s.errors,[]);
  });
  await browser.close();
  const edge='C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
  if(fs.existsSync(edge)){
    s=await session(edge,'file:///'+path.resolve(dir,'../../csv-sql.html').replaceAll('\\','/'));await s.ctx.setOffline(true);
    await check('Edge offline 1 GiB full scan + exact sums',async()=>{
      await s.p.locator('#files').setInputFiles(path.join(dir,'fixtures/numeric-1gib.csv'));await s.idle();const r=await s.query('SELECT COUNT(*) AS n, SUM(c1) AS s1, SUM(c8) AS s8 FROM t1');
      assert.deepEqual(r.output?.values,[[expected.rows,expected.sum_c1,expected.sum_c8].map(String)],r.status);assert.deepEqual(s.requests,[]);assert.deepEqual(s.errors,[]);
      return {browser:browser.version(),info:r.info,httpRequests:0,wasmHeapBytes:await s.p.workers()[0].evaluate(()=>db.mod.HEAPU8.buffer.byteLength)};
    });
    await browser.close();
  }
  await new Promise(resolve=>server.close(resolve));save();if(results.some(r=>!r.pass))process.exitCode=1;
})().catch(async e=>{console.error(e);results.push({name:'fatal',pass:false,error:String(e)});save();await browser?.close();server?.close();process.exitCode=1;});
