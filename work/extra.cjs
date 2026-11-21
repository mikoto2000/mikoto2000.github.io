const {chromium}=require('playwright'),assert=require('assert/strict'),fs=require('fs');
(async()=>{
const results=[];
for(const [name,exe] of [['Chrome','C:/Program Files/Google/Chrome/Application/chrome.exe'],['Edge','C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']]){
 const b=await chromium.launch({executablePath:exe,headless:true}),ctx=await b.newContext({offline:true,permissions:['clipboard-read','clipboard-write']}),p=await ctx.newPage();
 await p.goto('file:///F:/project/mikoto2000.github.io/jq-playground.html');await p.waitForFunction(()=>document.getElementById('status').textContent==='成功');
 await p.evaluate(()=>navigator.clipboard.writeText('{"pasted":123}'));await p.locator('#input').focus();await p.keyboard.press('Control+A');await p.keyboard.press('Control+V');assert.equal(await p.locator('#input').inputValue(),'{"pasted":123}');
 await p.locator('#filter').fill('.pasted');await p.keyboard.press('Control+Enter');await p.waitForFunction(()=>document.getElementById('status').textContent==='成功');assert.equal(await p.locator('#output').inputValue(),'123\n');
 await p.locator('#raw').check();await p.locator('#input').fill('"a\\rb\\r\\nc"');await p.locator('#filter').fill('.');await p.locator('#run').click();await p.waitForFunction(()=>document.getElementById('status').textContent==='成功');
 await p.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{globalThis.copiedExact=text;}}}));await p.locator('#copy').click();assert.equal(await p.evaluate(()=>copiedExact),'a\rb\r\nc\n');
 await p.evaluate(()=>{Object.defineProperty(navigator,'clipboard',{configurable:true,value:undefined});document.addEventListener('copy',e=>{const set=e.clipboardData.setData.bind(e.clipboardData);e.clipboardData.setData=(type,text)=>{globalThis.fallbackExact=text;return set(type,text);};},{capture:true});});await p.locator('#copy').click();await p.waitForTimeout(100);assert.equal(await p.evaluate(()=>fallbackExact),'a\rb\r\nc\n');
 await p.locator('#filter').fill('error("a" * 1100000)');await p.locator('#run').click();await p.waitForFunction(()=>document.getElementById('status').textContent==='エラー');assert.match(await p.locator('#error').textContent(),/サイズ上限/);assert.equal(await p.locator('#copy').isDisabled(),true);
 await p.locator('#filter').fill('"a" * 1048575');await p.locator('#run').click();await p.waitForFunction(()=>document.getElementById('status').textContent==='成功');assert.equal((await p.locator('#output').inputValue()).length,1048576);
 await p.locator('#filter').fill('"a" * 1048576');await p.locator('#run').click();await p.waitForFunction(()=>document.getElementById('status').textContent==='エラー');assert.match(await p.locator('#error').textContent(),/サイズ上限/);
 await p.locator('#input').fill('null');await p.locator('#filter').fill('.');await p.locator('#run').click();await p.waitForFunction(()=>document.getElementById('status').textContent==='成功');
 await p.setViewportSize({width:390,height:844});await p.evaluate(()=>scrollTo(0,0));assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await p.screenshot({path:`work/${name.toLowerCase()}-mobile.png`});
 results.push({browser:name,version:await b.version(),pass:true,checks:['offline file initialization','actual keyboard paste','Ctrl+Enter','exact CR/LF clipboard argument and fallback event','stderr limit','exact output boundary','recovery','mobile layout']});console.log('PASS',name);await b.close();
}
fs.writeFileSync('work/extra-results.json',JSON.stringify(results,null,2));
})();
