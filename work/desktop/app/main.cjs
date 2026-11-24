'use strict';

const {app, BrowserWindow, dialog, Menu, nativeTheme, shell} = require('electron');
const {spawn} = require('node:child_process');
const {readFile} = require('node:fs/promises');
const {createHash} = require('node:crypto');
const path = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');

const title = '数二真题练习';
const port = Number(process.env.MATH2_DESKTOP_PORT || 17846);
const origin = 'http://127.0.0.1:' + port;
const site = path.join(process.resourcesPath, 'site');
const pageName = '数二真题进度.html';
let ownedBridge, window, opening, quitting = false;

async function request(resource) {
  return fetch(origin + resource, {redirect:'error', signal:AbortSignal.timeout(1800)});
}

async function bridgeReady() {
  let health;
  try {
    health = await request('/api/health');
  } catch (error) {
    if (error.cause?.code === 'ECONNREFUSED') return false;
    throw new Error('本机练习服务没有响应。请稍后重新打开。');
  }
  if (health.ok) {
    const result = await health.json().catch(() => ({}));
    if (result.service === 'math2-practice' && result.protocol === 1) return true;
  } else if (health.status === 404) {
    // Older web launchers have no health endpoint. Only reuse a matching site.
    const session = await (await request('/api/session')).json().catch(() => ({}));
    if (typeof session.csrf === 'string' && typeof session.connected === 'boolean' && 'canWrite' in session) {
      const served = await request('/');
      const bundled = await readFile(path.join(site, pageName));
      const hash = data => createHash('sha256').update(data).digest('hex');
      if (served.ok && hash(Buffer.from(await served.arrayBuffer())) === hash(bundled)) return true;
    }
  }
  throw new Error('本机端口 ' + port + ' 已被其他服务或其他版本占用。请关闭占用程序后重新打开。');
}

async function startBridge() {
  if (!Number.isInteger(port) || port < 1 || port > 65535 || (port !== 17846 && !process.env.DAGUAN_STATE_DIR)) {
    throw new Error('端口配置无效。使用独立测试端口时请同时设置 DAGUAN_STATE_DIR。');
  }
  if (await bridgeReady()) return;
  if (quitting) return;
  const binary = path.join(process.resourcesPath, 'bridge', 'math2-bridge');
  const child = spawn(binary, ['--port', String(port), '--site-dir', site], {stdio:'ignore'});
  ownedBridge = child;
  let stopped = false;
  child.once('error', () => { stopped = true; });
  child.once('exit', () => {
    stopped = true;
    if (ownedBridge === child) ownedBridge = undefined;
  });
  for (let attempt = 0; attempt < 80 && !quitting; attempt++) {
    await delay(125);
    if (await bridgeReady()) return;
    if (stopped) break;
  }
  if (!quitting) throw new Error('本机练习服务启动失败。请检查应用是否完整，并确认本机端口可用。');
}

function openExternal(raw) {
  let url;
  try { url = new URL(raw); } catch { return; }
  if (url.protocol !== 'https:' || url.username || url.password) return;
  const source = url.origin === 'https://github.com' && (url.pathname === '/wangziyu1234/Mathematics-II-' || url.pathname.startsWith('/wangziyu1234/Mathematics-II-/'));
  if (source || url.origin === 'https://cxyonly.fans') {
    void shell.openExternal(url.href).catch(() => dialog.showErrorBox(title, '无法打开默认浏览器。'));
  }
}

async function createWindow() {
  await startBridge();
  if (quitting) return;
  const win = new BrowserWindow({
    title, width:1360, height:890, minWidth:640, minHeight:440, show:false,
    backgroundColor:'#151a21',
    webPreferences:{sandbox:true, contextIsolation:true, nodeIntegration:false, webviewTag:false}
  });
  window = win;
  const contents = win.webContents;
  const allowedPage = raw => {
    const url = URL.parse(raw);
    return url !== null && url.origin === origin && (url.pathname === '/' || url.pathname === '/' + encodeURIComponent(pageName));
  };
  contents.setWindowOpenHandler(({url}) => { openExternal(url); return {action:'deny'}; });
  for (const event of ['will-navigate','will-redirect']) {
    contents.on(event, (e, url) => {
      if (!allowedPage(url)) { e.preventDefault(); openExternal(url); }
    });
  }
  contents.session.setPermissionRequestHandler((webContents, permission, respond) => {
    respond(webContents === contents && allowedPage(contents.getURL()) && permission === 'clipboard-sanitized-write');
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => { if (window === win) window = undefined; });
  await win.loadURL(origin + '/');
}

function showWindow() {
  if (window) {
    if (window.isMinimized()) window.restore();
    window.show(); window.focus();
    return;
  }
  if (!opening && !quitting) {
    opening = createWindow().catch(error => {
      if (!quitting) dialog.showErrorBox(title, error.message);
      app.quit();
    }).finally(() => { opening = undefined; });
  }
}

function historyStep(forward) {
  const history = window?.webContents.navigationHistory;
  if (forward && history?.canGoForward()) history.goForward();
  if (!forward && history?.canGoBack()) history.goBack();
}

if (!app.commandLine.hasSwitch('user-data-dir')) {
  app.setPath('userData', path.join(app.getPath('appData'), 'math2-practice-desktop'));
}
if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => { if (app.isReady()) showWindow(); });
  app.on('before-quit', () => { quitting = true; });
  app.on('will-quit', () => { ownedBridge?.kill(); });
  app.on('activate', () => { if (app.isReady()) showWindow(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
  app.whenReady().then(() => {
    nativeTheme.themeSource = 'dark';
    Menu.setApplicationMenu(Menu.buildFromTemplate([
      {role:'appMenu'}, {role:'editMenu'},
      {label:'导航', submenu:[
        {label:'后退', accelerator:'CmdOrCtrl+[', click:() => historyStep(false)},
        {label:'前进', accelerator:'CmdOrCtrl+]', click:() => historyStep(true)},
        {type:'separator'}, {label:'刷新', role:'reload'}
      ]},
      {label:'显示', submenu:[{role:'resetZoom'}, {role:'zoomIn'}, {role:'zoomOut'}, {role:'togglefullscreen'}]},
      {role:'windowMenu'}
    ]));
    showWindow();
  });
} else {
  app.quit();
}
