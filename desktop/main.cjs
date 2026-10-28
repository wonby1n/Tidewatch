const { app, BrowserWindow, Menu, dialog, screen } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');

const smoke = process.argv.includes('--smoke-test');
const root = process.env.TIDEWATCH_DIR || path.join(os.homedir(), '.tidewatch');
if (smoke) app.setPath('userData', path.join(root, 'desktop-test-state'));
const source = path.join(__dirname, '..', 'skills', 'tidewatch');
let backend, origin, quitting = false;
const windows = new Map();
const stateFile = path.join(app.getPath('userData'), 'windows.json');
let state = {};
try { state = JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch {}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, args) => show(args.includes('--mini')));
  app.whenReady().then(start).catch(fail);
}

function allowed(url) {
  try { const u = new URL(url); return u.origin === origin && u.pathname === '/'; } catch { return false; }
}

function show(mini = false) {
  if (!origin || quitting) return;
  const key = mini ? 'mini' : 'board';
  const old = windows.get(key);
  if (old && !old.isDestroyed()) { if (old.isMinimized()) old.restore(); old.show(); old.focus(); return old; }
  const saved = state[key] || {};
  const display = screen.getPrimaryDisplay().workArea;
  const width = Math.max(mini ? 320 : 440, Math.min(saved.width || (mini ? 380 : 560), display.width));
  const height = Math.max(300, Math.min(saved.height || (mini ? 540 : 900), display.height));
  const bounds = { width, height };
  if (Number.isFinite(saved.x) && Number.isFinite(saved.y) && screen.getAllDisplays().some(d =>
    saved.x + width > d.workArea.x && saved.x < d.workArea.x + d.workArea.width &&
    saved.y + height > d.workArea.y && saved.y < d.workArea.y + d.workArea.height)) {
    bounds.x = saved.x; bounds.y = saved.y;
  }
  const win = new BrowserWindow({
    ...bounds, minWidth: mini ? 320 : 440, minHeight: 300,
    title: 'Tidewatch', icon: path.join(source, 'assets', 'tidewatch.ico'),
    show: false, autoHideMenuBar: true, backgroundColor: '#edf2f6',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  });
  windows.set(key, win);
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  win.webContents.on('will-navigate', (event, url) => { if (!allowed(url)) event.preventDefault(); });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (allowed(url)) show(new URL(url).searchParams.has('mini'));
    return { action: 'deny' };
  });
  win.on('close', () => {
    state[key] = win.getNormalBounds();
    try { fs.mkdirSync(path.dirname(stateFile), { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(state)); } catch {}
  });
  win.on('closed', () => windows.delete(key));
  win.once('ready-to-show', () => { if (!smoke) win.show(); });
  win.loadURL(origin + '/' + (mini ? '?mini=1' : '')).catch(fail);
  return win;
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

async function start() {
  app.setAppUserModelId('io.github.wonby1n.tidewatch');
  fs.mkdirSync(root, { recursive: true });
  if (app.isPackaged && !smoke) {
    fs.writeFileSync(path.join(root, 'desktop.json'), JSON.stringify({ executable: process.execPath }));
  }
  // The connect button needs a bundled skill, even when Node.js is not installed.
  fs.cpSync(source, path.join(root, 'skill'), { recursive: true });
  for (const folder of ['.claude/skills/tidewatch', '.agents/skills/tidewatch', '.codex/skills/tidewatch']) {
    const installed = path.join(os.homedir(), folder);
    if (!smoke && fs.existsSync(path.join(installed, 'SKILL.md'))) fs.cpSync(source, installed, { recursive: true });
  }
  for (const name of ['pet.ps1', 'tidewatch.mjs', 'usage.mjs']) fs.copyFileSync(path.join(source, 'scripts', name), path.join(root, name));
  const port = await freePort();
  origin = `http://127.0.0.1:${port}`;
  const script = path.join(source, 'scripts', 'tidewatch.mjs');
  const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', TIDEWATCH_DIR: root, TIDEWATCH_PORT: String(port) };
  // Build once; later agent reports continue to update the same local data files.
  const build = spawn(process.execPath, [script, 'build'], { env, windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
  await new Promise((resolve, reject) => { build.once('error', reject); build.once('exit', code => code === 0 ? resolve() : reject(new Error('Could not build the board'))); });
  backend = spawn(process.execPath, [script, 'serve'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Local service startup timed out')), 10000);
    backend.once('error', err => { clearTimeout(timeout); reject(err); });
    backend.once('exit', () => { clearTimeout(timeout); reject(new Error('Local service stopped during startup')); });
    backend.stdout.once('data', () => { clearTimeout(timeout); resolve(); });
  });
  backend.on('exit', () => { if (!quitting) fail(new Error('The local Tidewatch service stopped. Please restart the app.')); });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { label: 'Tidewatch', submenu: [
      { label: '현황판', click: () => show(false) }, { label: '메모장 모드', click: () => show(true) },
      { type: 'separator' }, { role: 'quit', label: '종료' },
    ] },
    { label: '보기', submenu: [{ role: 'reload' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }] },
    { label: '편집', submenu: [{ role: 'copy' }, { role: 'selectAll' }] },
  ]));
  const win = show(process.argv.includes('--mini'));
  if (smoke) {
    await new Promise((resolve, reject) => { win.webContents.once('did-finish-load', resolve); win.webContents.once('did-fail-load', (_e, _code, message) => reject(new Error(message))); });
    const result = await win.webContents.executeJavaScript(`(async()=>{
      const r=await fetch('/api/status',{headers:{'x-tidewatch-token':window.TW_TOKEN}});
      return {title:document.title, board:!!document.getElementById('board'), usage:!!document.getElementById('usageGrid'), status:r.status,
        node:typeof require, token:!!window.TW_TOKEN, cards:document.querySelectorAll('.card').length};
    })()`);
    if (!result.board || !result.usage || !result.token || result.status !== 200 || result.node !== 'undefined') throw new Error(JSON.stringify(result));
    const usageUI = await win.webContents.executeJavaScript(`(()=>{
      const original=status;
      try {
        status={...status,usage:{claude:{manualLimited:true},codex:{observedAt:Date.now(),windows:[{usedPercent:100,windowDurationMins:300,resetsAt:1}]}}};
        paintUsage();
        const cards=[...document.querySelectorAll('.usage-card')];
        return {manual:cards[0].classList.contains('limited')&&cards[0].textContent.includes('직접 표시'),
          unknown:cards[0].textContent.includes('확인 불가'),expired:!cards[1].classList.contains('limited')&&cards[1].textContent.includes('만료된 정보')};
      } finally {status=original;paintUsage()}
    })()`);
    if (!usageUI.manual || !usageUI.unknown || !usageUI.expired) throw new Error('Usage UI failed: ' + JSON.stringify(usageUI));
    if (process.env.TIDEWATCH_SCREENSHOT_DIR) {
      fs.mkdirSync(process.env.TIDEWATCH_SCREENSHOT_DIR, { recursive: true });
      win.showInactive();
      for (const theme of ['light', 'dark']) {
        await win.webContents.executeJavaScript(`document.documentElement.dataset.theme=${JSON.stringify(theme)};
          status.usage={claude:{model:'claude-opus-5-5',manualLimited:true},codex:{model:'GPT-6.1',observedAt:Date.now(),windows:[{usedPercent:38,windowDurationMins:300,resetsAt:Date.now()/1000+7200}]}};paintUsage();
          new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
        const image = await win.webContents.capturePage();
        fs.writeFileSync(path.join(process.env.TIDEWATCH_SCREENSHOT_DIR, theme + '.png'), image.toPNG());
      }
    }
    await win.webContents.executeJavaScript(`document.getElementById('miniBtn').click()`);
    const mini = windows.get('mini');
    if (!mini) throw new Error('Mini button did not open an app window');
    if (mini.webContents.isLoading()) await new Promise(resolve => mini.webContents.once('did-finish-load', resolve));
    if (!(await mini.webContents.executeJavaScript(`document.documentElement.dataset.mode==='mini'`))) throw new Error('Mini view failed');
    const memoCheck = await mini.webContents.executeJavaScript(`(()=>{
      const original=last;const now=Date.now();
      try {
        render({sessions:[
          {id:'wait',title:'Waiting task',status:'waiting',needsYou:'선택해주세요',mtime:now,steps:[]},
          {id:'error',title:'Blocked task',status:'blocked',mtime:now,error:{where:'restore.js:12',message:'파일 없음'},steps:[{text:'복원',state:'error'}]},
          {id:'work',title:'Working task',status:'working',mtime:now,steps:[{text:'준비',state:'done'},{text:'검사',state:'doing'}]},
          {id:'done',title:'Finished task',status:'done',now:'검사 통과',mtime:now,steps:[{text:'검사',state:'done'}]}
        ]});
        const row=s=>document.querySelector('.m-row.'+s).textContent;
        return {waiting:row('waiting').includes('너 차례')&&row('waiting').includes('선택해주세요')&&row('waiting').includes('진행률 미확인'),
          blocked:row('blocked').includes('막힘')&&row('blocked').includes('막힌 단계 · 복원')&&row('blocked').includes('파일 없음')&&row('blocked').includes('restore.js:12'),
          working:row('working').includes('50%')&&row('working').includes('1 / 2 단계 완료'),
          done:row('done').includes('완료')&&row('done').includes('100%')&&row('done').includes('검사 통과'),
          overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth};
      } finally {render(original)}
    })()`);
    if (!memoCheck.waiting || !memoCheck.blocked || !memoCheck.working || !memoCheck.done || memoCheck.overflow) throw new Error('Memo check failed: '+JSON.stringify(memoCheck));
    if (process.env.TIDEWATCH_SCREENSHOT_DIR) {
      mini.showInactive();
      for (const theme of ['light','dark']) {
        await mini.webContents.executeJavaScript(`document.documentElement.dataset.theme=${JSON.stringify(theme)};new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
        const shot = await mini.webContents.capturePage();
        fs.writeFileSync(path.join(process.env.TIDEWATCH_SCREENSHOT_DIR,'memo-'+theme+'.png'),shot.toPNG());
      }
    }
    if (allowed('https://example.com/') || allowed(origin + '/api/status')) throw new Error('Navigation guard failed');
    console.log('DESKTOP_SMOKE_OK ' + JSON.stringify(result));
    app.quit();
  }
}

function fail(error) {
  console.error(error);
  if (!smoke) dialog.showErrorBox('Tidewatch', error.message);
  quitting = true;
  if (backend && !backend.killed) backend.kill();
  app.exit(1);
}

app.on('before-quit', () => {
  quitting = true;
  if (backend && !backend.killed) backend.kill();
  try {
    const pidFile = path.join(root, 'server.pid');
    if (Number(fs.readFileSync(pidFile, 'utf8')) === backend?.pid) fs.unlinkSync(pidFile);
  } catch {}
});
app.on('window-all-closed', () => app.quit());
app.on('activate', () => show(false));
