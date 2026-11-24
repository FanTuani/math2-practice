'use strict';

const assert = require('node:assert/strict');
const {execFileSync, spawn} = require('node:child_process');
const {once} = require('node:events');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');
const {chromium} = require('playwright-core');

const bundle = path.resolve(process.argv[2] || path.join(__dirname, '../../outputs/数二真题练习.app'));

async function unusedPort() {
  const socket = net.createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const {port} = socket.address();
  await new Promise(resolve => socket.close(resolve));
  return port;
}

async function waitFor(test, description, timeout=15000) {
  const deadline = Date.now() + timeout;
  do {
    const result = await test();
    if (result) return result;
    await delay(100);
  } while (Date.now() < deadline);
  throw new Error('Timed out waiting for ' + description);
}

async function sideButton(cdp, button) {
  for (const type of ['mousePressed', 'mouseReleased']) {
    const down = type === 'mousePressed';
    await cdp.send('Input.dispatchMouseEvent', {
      type, button, buttons:down ? (button === 'back' ? 8 : 16) : 0,
      x:280, y:130, clickCount:1
    });
  }
}

async function main() {
  const template = path.join(os.tmpdir(), 'math2-electron-');
  const root = await fs.mkdtemp(template);
  const profile = path.join(root, 'profile');
  const stateDir = path.join(root, 'bridge');
  const port = await unusedPort();
  const origin = 'http://127.0.0.1:' + port;
  const executable = execFileSync('/usr/libexec/PlistBuddy', [
    '-c', 'Print:CFBundleExecutable', path.join(bundle, 'Contents', 'Info.plist')
  ], {encoding:'utf8'}).trim();
  const env = {...process.env, MATH2_DESKTOP_PORT:String(port), DAGUAN_STATE_DIR:stateDir};
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(path.join(bundle, 'Contents', 'MacOS', executable), [
    '--user-data-dir=' + profile, '--remote-debugging-address=127.0.0.1', '--remote-debugging-port=0'
  ], {env, stdio:['ignore','ignore','pipe']});
  let browser, stderr='', stopped=false, bridgeStarted=false;
  const exited=once(child, 'exit').then(() => { stopped=true; });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', data => { stderr=(stderr+data).slice(-24000); });
  try {
    const endpoint = await waitFor(() => {
      if (stopped) throw new Error('Electron quit before creating a window');
      return stderr.match(/DevTools listening on (ws:\/\/[^\s]+)/)?.[1];
    }, 'Electron renderer debugging endpoint');
    browser = await chromium.connectOverCDP(endpoint);
    const page = await waitFor(() => browser.contexts().flatMap(ctx=>ctx.pages()).find(p => p.url().startsWith(origin+'/')), 'bundled exercise at isolated port');
    page.setDefaultTimeout(6000);
    const errors=[];
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('#view-title').waitFor();
    const session = await (await fetch(origin+'/api/session')).json();
    assert.equal(session.connected, false);
    bridgeStarted=true;
    assert.equal(await page.title(), '数二真题进度');
    assert.equal(await page.evaluate(()=>typeof window.require), 'undefined');
    await page.locator('[data-q="2026-1"]').first().click();
    const card=page.locator('[data-card="2026-1"]');
    assert.equal(await card.locator('[data-letter]').count(),4);
    await card.locator('[data-letter=B]').click();
    await card.locator('[data-reveal]').click();
    await card.locator('.pr-answer .katex').first().waitFor();
    await card.locator('[data-mark=P]').click();
    await page.reload();
    await card.locator('[data-letter=B][aria-pressed=true]').waitFor();
    await card.locator('[data-reveal][aria-expanded=true]').waitFor();
    await card.locator('[data-mark=P][aria-pressed=true]').waitFor();
    const cdp=await page.context().newCDPSession(page);
    await sideButton(cdp,'back');
    await page.locator('#detail[open]').waitFor({state:'detached'});
    await sideButton(cdp,'forward');
    await card.locator('[data-letter=B][aria-pressed=true]').waitFor();
    await page.locator('[data-leave]').click();
    await page.locator('#detail[open]').waitFor({state:'detached'});
    await page.locator('[data-view=bank]').click();
    await page.locator('[data-module="topic-4.1"]').click({force:true});
    assert.ok(await page.locator('.pr-number').count()>2);
    await page.keyboard.press('Escape');
    await page.locator('#detail[open]').waitFor({state:'detached'});
    await page.locator('[data-view=bank][aria-pressed=true]').waitFor();
    assert.deepEqual(errors,[]);
    console.log('PASS packaged Electron launch, isolated bridge, rendered math, answer and mastery, reload, mouse Back/Forward, module practice, return and Escape');
  } finally {
    if (browser) {
      const connection=await browser.newBrowserCDPSession().catch(()=>null);
      if (connection) await connection.send('Browser.close').catch(()=>{});
      await browser.close().catch(()=>{});
    }
    // Signal only the exact child created above if browser shutdown was unavailable.
    if (!stopped) {
      await Promise.race([exited,delay(800)]);
      if (!stopped) child.kill('SIGTERM');
      await Promise.race([exited,delay(2500)]);
    }
    assert.ok(stopped,'Test Electron process must exit');
    if (bridgeStarted) {
      await waitFor(async()=>{
        try {
          await fetch(origin+'/api/health',{signal:AbortSignal.timeout(400)});
          return false;
        } catch(error) { return error.cause?.code === 'ECONNREFUSED'; }
      },'owned bridge to release its port',5000);
      console.log('PASS quitting the app releases its private local service');
    }
    await fs.rm(root,{recursive:true,force:true});
  }
}

main().catch(error=>{console.error(error.message);process.exitCode=1;});
