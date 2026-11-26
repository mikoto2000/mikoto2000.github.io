// Invoked by memory-job.py, which constrains this process and all its children.
const {chromium}=require('../node_modules/playwright');
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const dir=__dirname,expected=require('./fixtures/expected.json'),results=[];
let browser;
const out=name=>path.join(dir,name);
const log=message=>fs.appendFileSync(out('memory-test.log'),message+'\n');
function save(){fs.writeFileSync(out('memory-results.json'),JSON.stringify(results,null,2)+'\n');}
async function test(name,fn){const started=Date.now();try{const details=await fn();results.push({name,pass:true,elapsedMs:Date.now()-started,...details});log('PASS '+name+' '+JSON.stringify(details||{}));}catch(e){results.push({name,pass:false,error:String(e)});log('FAIL '+name+' '+String(e));}save();}
async function run(label,executablePath){
  browser=await chromium.launch({executablePath,headless:true});
  const cdp=await browser.newBrowserCDPSession();
  const ctx=await browser.newContext({offline:true}),requests=[],errors=[];
  ctx.on('request',r=>{if(/^https?:/.test(r.url()))requests.push(r.url());});
  const page=await ctx.newPage();page.on('pageerror',e=>errors.push(String(e)));
  await page.goto('file:///'+path.resolve(dir,'../../csv-sql.html').replaceAll('\\','/'));
  const idle=()=>page.waitForFunction(()=>ready&&!busy,null,{timeout:180000});
  await idle();
  const processes=(await cdp.send('SystemInfo.getProcessInfo')).processInfo;
  fs.writeFileSync(out('memory-processes.json'),JSON.stringify({browser:label,processes}));
  // Do not start testing until the launcher confirms that browser, renderers,
  // GPU and utility children really belong to the constrained Windows job.
  await test(label+' job membership',async()=>{
    const deadline=Date.now()+15000;
    while(Date.now()<deadline){
      let ack;try{ack=JSON.parse(fs.readFileSync(out('memory-membership.json'),'utf8'));}catch{}
      if(ack?.browser===label){assert(ack.allInJob,JSON.stringify(ack));return {version:browser.version(),processes:ack.processes};}
      await new Promise(r=>setTimeout(r,100));
    }
    throw Error('Launcher did not verify process membership');
  });
  if (!results.at(-1).pass) { await browser.close(); browser=null; return; }
  async function query(sql){await page.locator('#sql').fill(sql);await page.locator('#run').click();await idle();return page.evaluate(()=>({output,info:document.getElementById('resultinfo').textContent,status:document.getElementById('status').textContent}));}
  await test(label+' 1 GiB file registration',async()=>{
    await page.locator('#files').setInputFiles(out('fixtures/numeric-1gib.csv'));await idle();assert.equal(await page.locator('.filecard').count(),1,await page.locator('#status').textContent());
    return {wasmHeapBytes:await page.workers()[0].evaluate(()=>db.mod.HEAPU8.buffer.byteLength)};
  });
  await test(label+' full scan COUNT / SUM / MIN / MAX',async()=>{
    const r=await query('SELECT COUNT(*) AS n,SUM(c1) AS s1,SUM(c8) AS s8,MIN(c1) AS lo,MAX(c1) AS hi FROM t1');
    assert.deepEqual(r.output?.values,[[expected.rows,expected.sum_c1,expected.sum_c8,expected.min_c1,expected.max_c1].map(String)],r.status);
    return {info:r.info,values:r.output.values,wasmHeapBytes:await page.workers()[0].evaluate(()=>db.mod.HEAPU8.buffer.byteLength)};
  });
  await test(label+' full scan filter',async()=>{const r=await query('SELECT COUNT(*) FROM t1 WHERE c2=200000000');assert.deepEqual(r.output?.values,[[String(expected.filtered_rows)]],r.status);return {info:r.info};});
  await test(label+' GROUP BY',async()=>{const r=await query('SELECT c2,COUNT(*),SUM(c1) FROM t1 GROUP BY c2 ORDER BY c2');assert.equal(r.output?.values.length,100,r.status);assert.deepEqual(r.output.values[0],['200000000',String(expected.filtered_rows),String(expected.group_zero_sum)]);return {info:r.info};});
  await test(label+' top 10 sort',async()=>{const r=await query('SELECT c1 FROM t1 ORDER BY c1 DESC LIMIT 10');assert.equal(r.output?.values.length,10,r.status);assert(r.output.values.every(row=>row[0]===String(expected.max_c1)));return {info:r.info};});
  await test(label+' small CSV JOIN',async()=>{
    await page.locator('#files').setInputFiles({name:'dimension.csv',mimeType:'text/csv',buffer:Buffer.from('code,label\n200000000,zero\n200000001,one\n')});await idle();
    const r=await query('SELECT d.label,COUNT(*) FROM t1 f JOIN t2 d ON f.c2=d.code GROUP BY d.label ORDER BY d.label');assert.deepEqual(r.output?.values,[['one',String(expected.filtered_rows)],['zero',String(expected.filtered_rows)]],r.status);return {info:r.info};
  });
  await test(label+' cancel and restore',async()=>{
    await page.locator('#sql').fill('SELECT SUM(sin(i::DOUBLE)) FROM range(100000000000) r(i)');await page.locator('#run').click();await page.waitForTimeout(500);await page.locator('#stop').click();await idle();assert.match(await page.locator('#status').textContent(),/中断.*復元/s);
    const r=await query('SELECT c1 FROM t1 LIMIT 1');assert.deepEqual(r.output?.values,[['100000000']],r.status);assert.equal(await page.locator('.filecard').count(),2);
  });
  await test(label+' offline and no browser errors',async()=>{assert.deepEqual(requests,[]);assert.deepEqual(errors,[]);return {httpRequests:0,pageErrors:0};});
  await browser.close();browser=null;
}
(async()=>{
  save();
  await run('Chrome','C:/Program Files/Google/Chrome/Application/chrome.exe');
  if (process.argv.includes('--edge')) await run('Edge','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe');
  if(results.some(r=>!r.pass))process.exitCode=1;
})().catch(async e=>{results.push({name:'fatal',pass:false,error:String(e)});save();log(String(e));await browser?.close();process.exitCode=1;});
