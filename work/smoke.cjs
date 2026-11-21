const {chromium}=require('playwright');
(async()=>{
const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
const context=await browser.newContext({offline:true});const page=await context.newPage();
page.on('console',m=>console.log('console',m.type(),m.text()));page.on('pageerror',e=>console.log('ERROR',e));
await page.goto('file:///F:/project/mikoto2000.github.io/jq-playground.html');
await page.waitForTimeout(2500);console.log(await page.locator('#status').textContent(),await page.locator('#error').textContent(),await page.locator('#output').inputValue());
await page.screenshot({path:'work/desktop.png',fullPage:false});await browser.close();
})();
