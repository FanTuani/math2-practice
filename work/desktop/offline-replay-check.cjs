const assert = require('node:assert/strict');
const {chromium} = require('playwright-core');
const fs = require('node:fs/promises');
const path = require('node:path');
const origin = 'http://127.0.0.1:18986';
(async()=>{
 const browser=await chromium.launch({channel:'chrome'});
 try{
  const page=await browser.newPage();
  let online=true, account='first', mastery='u', favorite=false;
  const writes=[];
  await page.route(origin+'/**',async route=>{
    const url = decodeURIComponent(new URL(route.request().url()).pathname);
    if (!['/','/练习资源/reader.js','/练习资源/sync.js','/练习资源/sync.css','/练习资源/practice-math.css'].includes(url)) return route.abort();
    const body = await fs.readFile(path.join(__dirname,'../../outputs',url==='/'?'数二真题进度.html':url));
    const contentType = url.endsWith('.js')?'text/javascript':url.endsWith('.css')?'text/css':'text/html;charset=utf-8';
    return route.fulfill({body,contentType});
  });
  await page.route('**/api/**',route=>{
    if(!online)return route.abort();
    const path=new URL(route.request().url()).pathname;
    const state=()=>({matched:true,id:99,status:mastery,favorite,connectionId:account,canWrite:true,canWriteFavorite:true});
    if(path==='/api/session')return route.fulfill({json:{...state(),csrf:'mock',connected:true}});
    if(path==='/api/updates')return route.fulfill({json:{items:[],connectionId:account}});
    if(path==='/api/question')return route.fulfill({json:state()});
    const data=route.request().postDataJSON();writes.push(data);
    assert.equal(data.connectionId,account);assert.ok(data.operationId);
    if(path==='/api/mark'){assert.equal(data.expected,mastery);mastery=data.status;}
    else {assert.equal(path,'/api/favorite');assert.equal(data.expected,favorite);favorite=data.favorite;}
    return route.fulfill({json:state()});
  });
  await page.goto(origin);
  await page.getByText('大观园已连接',{exact:true}).waitFor();
  await page.locator('[data-view=matrix]').click();
  await page.locator('[data-q]').first().click();
  await page.getByText('已同步 · 大观园 #99').waitFor();
  online=false;
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.getByText('本机练习',{exact:true}).waitFor({state:'attached'});
  await page.locator('[data-mark=P]').click();
  await page.locator('[data-favorite]').first().click();
  await page.locator('[data-leave]').click();
  await page.reload();
  online=true;account='second';
  await page.evaluate(()=>window.dispatchEvent(new Event('online')));
  await page.getByText('大观园已连接',{exact:true}).waitFor();
  await page.waitForTimeout(400);assert.equal(writes.length,0);
  account='first';
  await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
  await page.waitForFunction(()=>Object.keys(localStorage).filter(k=>/practice\.(mark|favorite)\.v1\./.test(k)).every(k=>!JSON.parse(localStorage.getItem(k)).pending));
  assert.equal(mastery,'P');assert.equal(favorite,true);assert.equal(writes.length,2);
  console.log('PASS offline mastery and favorite edits survived reload, waited across account change and replayed from overview only to original account');
 } finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
