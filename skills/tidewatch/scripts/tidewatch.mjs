#!/usr/bin/env node
// Tidewatch v7 — https://github.com/wonby1n/tidewatch
// usage: node tidewatch.mjs <build|open|app|mini|serve|pet|path|remove <id>|prune|notify>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import crypto from 'node:crypto';
import { createUsageService } from './usage.mjs';

const ROOT = process.env.TIDEWATCH_DIR || path.join(os.homedir(), '.tidewatch');
const SESS = path.join(ROOT, 'sessions');
const HIST = path.join(ROOT, '.history');
const PAGE = path.join(ROOT, 'tidewatch.html');
const DATA = path.join(ROOT, 'board-data.js');
const SETTINGS = path.join(ROOT, 'settings.json');
const NOTIFY_STATES = ['waiting', 'blocked', 'done'];
const PORT = Number(process.env.TIDEWATCH_PORT || 47777);
const PET_PID = path.join(ROOT, 'pet.pid');
const SELF = fileURLToPath(import.meta.url);

function settings() {
  const s = readJson(SETTINGS, {});
  return {
    notify: s.notify !== false,
    notifyOn: Array.isArray(s.notifyOn) ? s.notifyOn.filter((x) => NOTIFY_STATES.includes(x)) : NOTIFY_STATES,
  };
}

function ensureDirs() {
  fs.mkdirSync(SESS, { recursive: true });
  fs.mkdirSync(HIST, { recursive: true });
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function writeAtomic(file, text) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, file);
}

/** 단계마다 언제 시작했고 언제 끝났는지 기록해 둔다 (build가 돌 때마다 비교) */
function track(id, steps, now) {
  const file = path.join(HIST, `${id}.json`);
  const hist = readJson(file, {});
  const timing = {};
  for (const step of steps) {
    if (!step || typeof step.text !== 'string') continue;
    const rec = hist[step.text] ?? {};
    if ((step.state === 'doing' || step.state === 'error') && !rec.start) rec.start = now;
    if (step.state === 'done' && !rec.end) { rec.end = now; rec.start ??= now; }
    if (step.state === 'todo') { delete rec.start; delete rec.end; }
    if (step.state !== 'done') delete rec.end;
    hist[step.text] = rec;
    timing[step.text] = rec;
  }
  writeAtomic(file, JSON.stringify(hist));
  return timing;
}

function load(now) {
  const list = [];
  for (const f of fs.readdirSync(SESS)) {
    if (!f.endsWith('.json')) continue;
    const id = f.slice(0, -5);
    const p = path.join(SESS, f);
    const mtime = fs.statSync(p).mtimeMs;
    let s;
    try {
      s = JSON.parse(fs.readFileSync(p, 'utf8'));
      if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('JSON 객체가 아니에요');
    } catch (e) {
      list.push({ id, title: f, status: 'blocked', mtime, error: { where: `sessions/${f}`, message: e.message } });
      continue;
    }
    const steps = Array.isArray(s.steps) ? s.steps : [];
    list.push({ ...s, id, mtime, timing: track(id, steps, now) });
  }
  return list;
}

function build() {
  ensureDirs();
  const now = Date.now();
  autoPrune(now);
  const sessions = load(now);
  const conf = settings();
  notifyChanges(sessions, conf);
  const json = JSON.stringify({ sessions, builtAt: now, settings: conf }).replace(/</g, '\\u003c');
  writeAtomic(DATA, `window.__TIDE(${json});`);
  writeAtomic(PAGE, TEMPLATE.replace('__DATA__', () => json));
  return PAGE;
}

function open() {
  const file = build();
  const [bin, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', file]]
    : process.platform === 'darwin' ? ['open', [file]] : ['xdg-open', [file]];
  execFile(bin, args, () => {});
  return file;
}

/** 주소창·탭 없는 앱 창으로 연다 (Edge/Chrome --app). 브라우저를 못 찾으면 기본 브라우저로 */
function findBrowser() {
  const env = process.env;
  const candidates = process.platform === 'win32' ? [
    `${env['ProgramFiles(x86)']}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${env.ProgramFiles}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${env.ProgramFiles}\\Google\\Chrome\\Application\\chrome.exe`,
    `${env['ProgramFiles(x86)']}\\Google\\Chrome\\Application\\chrome.exe`,
    `${env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  ] : process.platform === 'darwin' ? [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ] : ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'];
  return candidates.find((p) => p && !p.startsWith('undefined') && fs.existsSync(p));
}

/** 로컬 서버가 떠 있는지 */
function ping() {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port: PORT, path: '/api/ping', timeout: 400 }, (res) => { res.resume(); resolve(res.statusCode === 200); });
    req.on('error', () => resolve(false));
    req.on('timeout', () => { req.destroy(); resolve(false); });
  });
}

async function ensureServer() {
  if (await ping()) return true;
  spawn(process.execPath, [SELF, 'serve'], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env }).on('error', () => {}).unref();
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 100));
    if (await ping()) return true;
  }
  return false;
}

/** 현황판을 앱 창으로 연다. 로컬 서버로 열면 펫·알림·연결 관리까지 된다 */
async function app(mini = false) {
  const desktop = readJson(path.join(ROOT, 'desktop.json'), {});
  if (typeof desktop.executable === 'string' && path.isAbsolute(desktop.executable) && fs.existsSync(desktop.executable)) {
    const desktopEnv = { ...process.env };
    delete desktopEnv.ELECTRON_RUN_AS_NODE;
    spawn(desktop.executable, mini ? ['--mini'] : [], { env: desktopEnv, detached: true, stdio: 'ignore', windowsHide: false }).on('error', (err) => console.error(`Tidewatch 앱을 열지 못했어요: ${err.message}`)).unref();
    return desktop.executable;
  }
  const file = build();
  const base = (await ensureServer()) ? `http://127.0.0.1:${PORT}/` : pathToFileURL(file).href;
  const url = mini ? `${base}?mini=1` : base;
  const browser = findBrowser();
  if (!browser) {
    const [bin, args] = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
      : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    execFile(bin, args, () => {});
    return url;
  }
  const size = mini ? '360,520' : '480,960';
  spawn(browser, [`--app=${url}`, `--window-size=${size}`], { detached: true, stdio: 'ignore' }).on('error', () => open()).unref();
  return url;
}

// ---------- 펫 ----------
function petRunning() {
  try {
    const pid = Number(fs.readFileSync(PET_PID, 'utf8').trim());
    if (!pid) return false;
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}

function petStop() {
  try { process.kill(Number(fs.readFileSync(PET_PID, 'utf8').trim())); } catch {}
  fs.rmSync(PET_PID, { force: true });
}

// ---------- Claude Code · Codex 연결 ----------
const AGENT_DIRS = {
  claude: [path.join(os.homedir(), '.claude', 'skills', 'tidewatch')],
  codex: [path.join(os.homedir(), '.agents', 'skills', 'tidewatch'), path.join(os.homedir(), '.codex', 'skills', 'tidewatch')],
};

function agents() {
  const now = Date.now();
  const sessions = load(now);
  const out = {};
  for (const [name, dirs] of Object.entries(AGENT_DIRS)) {
    const mine = sessions.filter((s) => String(s.agent ?? '').toLowerCase() === name);
    out[name] = {
      installed: dirs.some((d) => fs.existsSync(path.join(d, 'SKILL.md'))),
      sessions: mine.length,
      lastSeen: mine.length ? Math.max(...mine.map((s) => s.mtime)) : null,
    };
  }
  return out;
}

function connect(name) {
  const src = path.join(ROOT, 'skill');
  if (!fs.existsSync(path.join(src, 'SKILL.md'))) throw new Error('스킬 원본이 없어요. 설치 명령을 다시 실행해 주세요.');
  const dest = AGENT_DIRS[name]?.[0];
  if (!dest) throw new Error('모르는 에이전트예요.');
  fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
}

// ---------- 로컬 서버 (127.0.0.1 전용) ----------
function serve() {
  ensureDirs();
  const usage = createUsageService({ root: ROOT, disabled: process.env.TIDEWATCH_NO_USAGE === '1' });
  const token = crypto.randomBytes(16).toString('hex');
  const hosts = new Set([`127.0.0.1:${PORT}`, `localhost:${PORT}`]);
  const server = http.createServer((req, res) => {
    const send = (code, type, body) => { res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(body); };
    const json = (code, obj) => send(code, 'application/json; charset=utf-8', JSON.stringify(obj));
    // 다른 사이트가 이름을 바꿔 들어오거나(DNS rebinding) 몰래 요청하지 못하게
    if (!hosts.has(req.headers.host ?? '')) return send(403, 'text/plain', 'forbidden');
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    try {
      if (req.method === 'GET' && url.pathname === '/api/ping') return json(200, { ok: true });
      if (req.method === 'GET' && url.pathname === '/') {
        if (!fs.existsSync(PAGE)) build();
        const html = fs.readFileSync(PAGE, 'utf8').replace('</head>', `<script>window.TW_TOKEN=${JSON.stringify(token)}</script></head>`);
        return send(200, 'text/html; charset=utf-8', html);
      }
      if (req.method === 'GET' && url.pathname === '/board-data.js') {
        return send(200, 'text/javascript; charset=utf-8', fs.existsSync(DATA) ? fs.readFileSync(DATA, 'utf8') : 'window.__TIDE({"sessions":[]});');
      }
      if (url.pathname.startsWith('/api/') && req.headers['x-tidewatch-token'] !== token) return json(403, { error: 'token' });
      if (req.method === 'GET' && url.pathname === '/api/status') {
        return json(200, { platform: process.platform, pet: petRunning(), settings: settings(), agents: agents(), usage: usage.snapshot() });
      }
      if (req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; if (body.length > 1e4) req.destroy(); });
        req.on('end', async () => {
          try {
            const input = body ? JSON.parse(body) : {};
            if (url.pathname === '/api/usage/refresh') { await usage.refresh(); return json(200, { usage: usage.snapshot() }); }
            if (url.pathname === '/api/usage/limited') { usage.setLimited(String(input.agent), input.limited); return json(200, { usage: usage.snapshot() }); }
            if (url.pathname === '/api/usage/claude-connect') return json(200, usage.connectClaude());
            if (url.pathname === '/api/pet') {
              if (input.on) { const msg = pet(); return json(200, { ok: true, message: msg }); }
              petStop(); return json(200, { ok: true });
            }
            if (url.pathname === '/api/notify') {
              const cur = readJson(SETTINGS, {}); cur.notify = !!input.on;
              writeAtomic(SETTINGS, JSON.stringify(cur, null, 2)); build();
              return json(200, { ok: true, settings: settings() });
            }
            if (url.pathname === '/api/connect') { connect(String(input.agent)); return json(200, { ok: true }); }
            json(404, { error: 'not found' });
          } catch (e) { json(400, { error: e.message }); }
        });
        return;
      }
      json(404, { error: 'not found' });
    } catch (e) { json(500, { error: e.message }); }
  });
  server.on('error', (e) => { console.error(`서버를 못 열었어요: ${e.message}`); process.exit(1); });
  server.listen(PORT, '127.0.0.1', () => {
    try { fs.writeFileSync(path.join(ROOT, 'server.pid'), String(process.pid)); } catch {}
    console.log(`http://127.0.0.1:${PORT}/`);
  });
}

/** 끝난 지 하루 넘은 세션, 소식 없이 3일 지난 세션은 build할 때 알아서 지운다 */
function autoPrune(now) {
  for (const f of fs.readdirSync(SESS)) {
    if (!f.endsWith('.json')) continue;
    const p = path.join(SESS, f);
    const age = now - fs.statSync(p).mtimeMs;
    const s = readJson(p, null);
    if ((s?.status === 'done' && age > 864e5) || age > 3 * 864e5) remove(f.slice(0, -5));
  }
}

/** 상태가 '너 차례·막힘·끝'으로 바뀐 순간에만 OS 알림을 한 번 띄운다 */
function notifyChanges(sessions, conf) {
  for (const s of sessions) {
    const file = path.join(HIST, `${s.id}.status`);
    let prev = null;
    try { prev = fs.readFileSync(file, 'utf8'); } catch {}
    const status = String(s.status ?? 'working');
    if (prev === status) continue;
    fs.writeFileSync(file, status);
    if (!conf.notify || !conf.notifyOn.includes(status) || process.env.TIDEWATCH_NO_NOTIFY) continue;
    const head = { waiting: '🟠 너 차례', blocked: '🔴 막힘', done: '🟢 끝' }[status];
    const title = `${head} · ${s.title || s.id}`;
    const body = status === 'waiting' ? (s.needsYou || s.now) : status === 'blocked' ? (s.needsYou || s.error?.where || s.now) : s.now;
    toast(title, String(body ?? '').slice(0, 200));
  }
}

function toast(title, body) {
  const done = () => {};
  try {
    if (process.platform === 'win32') {
      const xml = (t) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]);
      const ps = (t) => `'${t.replace(/'/g, "''")}'`;
      const icon = path.join(ROOT, 'tidewatch.png');
      const logo = fs.existsSync(icon) ? `<image placement="appLogoOverride" src="${xml(pathToFileURL(icon).href)}"/>` : '';
      const doc = `<toast activationType="protocol" launch="${xml(pathToFileURL(PAGE).href)}"><visual><binding template="ToastGeneric"><text>${xml(title)}</text><text>${xml(body)}</text>${logo}</binding></visual></toast>`;
      const script = [
        '[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime] | Out-Null',
        '[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType = WindowsRuntime] | Out-Null',
        '$x = New-Object Windows.Data.Xml.Dom.XmlDocument',
        `$x.LoadXml(${ps(doc)})`,
        "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('{1AC14E77-02E7-4E5D-B744-2EB1AE5198B7}\\WindowsPowerShell\\v1.0\\powershell.exe').Show([Windows.UI.Notifications.ToastNotification]::new($x))",
      ].join('\n');
      const encoded = Buffer.from(script, 'utf16le').toString('base64');
      spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', encoded], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', done).unref();
    } else if (process.platform === 'darwin') {
      const q = (t) => `"${t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
      spawn('osascript', ['-e', `display notification ${q(body)} with title ${q(title)}`], { detached: true, stdio: 'ignore' }).on('error', done).unref();
    } else {
      spawn('notify-send', ['-a', 'Tidewatch', title, body], { detached: true, stdio: 'ignore' }).on('error', done).unref();
    }
  } catch {}
}

/** 작업표시줄 위를 걸어다니는 펫 (Windows 전용, pet.ps1) */
function pet() {
  const file = path.join(ROOT, 'pet.ps1');
  if (process.platform !== 'win32') return '펫은 아직 Windows에서만 돼요.';
  if (!fs.existsSync(file)) return `${file}이 없어요. 설치 명령을 다시 실행해 주세요.`;
  build();
  if (petRunning()) return '펫이 이미 떠 있어요.';
  spawn('powershell.exe', ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', file], { detached: true, stdio: 'ignore', windowsHide: true }).on('error', () => {}).unref();
  return '펫을 띄웠어요. 작업표시줄 위를 보세요.';
}

function remove(id) {
  const safe = path.basename(id);
  fs.rmSync(path.join(SESS, `${safe}.json`), { force: true });
  fs.rmSync(path.join(HIST, `${safe}.json`), { force: true });
  fs.rmSync(path.join(HIST, `${safe}.status`), { force: true });
}

function main() {
  const [cmd, arg] = process.argv.slice(2);
  ensureDirs();
  switch (cmd ?? 'build') {
    case 'build': return console.log(build());
    case 'open': return console.log(open());
    case 'app': return app().then(console.log);
    case 'mini': return app(true).then(console.log);
    case 'serve': return serve();
    case 'pet': return console.log(pet());
    case 'path': return console.log(SESS);
    case 'notify': {
      // notify on | off | status | only waiting,blocked
      const cur = readJson(SETTINGS, {});
      if (arg === 'on' || arg === 'off') cur.notify = arg === 'on';
      else if (arg === 'only') cur.notifyOn = String(process.argv[4] ?? '').split(',').filter((x) => NOTIFY_STATES.includes(x));
      else if (arg && arg !== 'status') break;
      if (arg && arg !== 'status') { writeAtomic(SETTINGS, JSON.stringify(cur, null, 2)); build(); }
      const conf = settings();
      return console.log(`알림 ${conf.notify ? '켜짐' : '꺼짐'} · ${conf.notifyOn.join(', ') || '없음'}`);
    }
    case 'remove':
      if (!arg) break;
      remove(arg);
      return console.log(build());
    case 'prune': return console.log(build());
  }
  console.error('usage: tidewatch.mjs build | open | app | mini | serve | pet | path | remove <id> | prune | notify on|off|status|only <waiting,blocked,done>');
  process.exit(1);
}

var TEMPLATE = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tidewatch</title>
<link rel="icon" href="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAQ1klEQVR42t2be5RdVX3HP7+995l779x5TzKTByRggqilgWgiiGgEFGuxRdFREVSK2mrRWl3VVvsALS4FrGLVupba1lrFtYir1Nq1dLlQSqurLRAlNIoSAhkhmWSSzPs+z9n71z/OuXfuZCYkM0kgeGadNTPn3Ht++/f6/l77CAsfAkMGtnqArnVb1osxrwlwmShngy5HyIMIp8ShilIFOSDCL4Hvq3Ln1CN370rvD1nYGgBdgNF5hwECQNfZL9+kIbxf4NVibBeq6TNUOSUPkZQlETT4KYXviDe3TT161/2H83YEAdxg4KOBtVvyXXn3CVF5rxhrNXhQ9QgZBeTUlACphhRFxIqxaPBeRT83VU0+zPA91SaP8wWQ3ug765LV3titYtyL1McKGkDMPKblFJPBHKuU7EK6drGRqE/+26ofGtv5wz2tQpBW00iZj+4Wa8/SJI4RolNX2YswCiUWG0Ua/E4b4otTIaQ8SwPw1q4djSYK+f8S4zapj2NEIn6dDtVMCPH9PZXaS4aHB2LYGgxDKdpPFPK3GJvbpD6JxZhIRBAEkWf42eDBmEhDEhuX3zRRyN8CWz1DQ0ZStH/VJmPNvWgImWkIv56HAgExJvjwwqlffvd+B2CMfESsE03qIEZOLv1jicQnL1CiAbFOjNY/Alwpnc+9/CwrbEckjyrISYJ3TXk1YjACqoLXkIK1PKVYoIiAajVgNjgj5kqxrqAh9oixJ2stKoIhUK8colKv4WxEsdBFsHlEw1PHv4iAerFRQULyWicilyIgiJyU2N7QPEptei9ntVd5+bocuyZq/GBkEltcCa4zC9lPhQ8AmrGLeYVDeE66SCNpGnmCkxMBMZa4cpAz8hW+96p+BrstKHzox5N89qGDdPV14oM8NQmWAqKS8fwcI9j+jLA0c+kTdUp6GhHKtSovX51jsNsyM+NJvHLNugJt4tGQgFhOOP0jr6kh5T6HUBCR1CpOuLAFUQUxtLmIX0yUwUNHu4GcYftYQqxC3kQZbfMUxUJpuEPBNcKenISI1CATVGkv9vGj0XHe858TvOmsAttHa9z8fxXy7YME4yD42QU0FaTzI6ecMBwAI0b6zn19Fof0BElAj3DNIL7M9OQeOiIodnYwXTGY4qqskJFmMYeG9D+RWavQcNgaj2e9s2t0s353MpKSFr8DTFs/WlHeMnQB7337G7ngiutRX8VqDQkxGurga/ikTggeYxy2rR11HXjbCcaB+hNQkc8qXPrOe6Met/6lAa6KikmrZ1VEPaJJdsaIxiT1Cv0dls5inp27dpMkMUkS473HiOCiiI5ikVwuR7VWY2pykiiK6OheRpIbRKNuRBNUZNaUlx6dGxZwgvzKOCTUsfEYxNP4epl6vUpcr+F9jPcBaw0zY45CPs/qVStYOTjA6tWrOHPt6aw9/TTOPGMNKwYH6Ci2Mz09w/0/fZCvfO12/vfe++juKhOKp0FuGdKwhONcvvQ//ypdGsK0+K0CxkLtELYywvTkGN4Hent7WL58OatWDHLa6lWcecaalMm1p7N65QqWLeuns6N4VEpxkvDJT3+eT/zN39LRnid0roO2nhQ4ZSn224oBTX9a7ENavmMdUhmFmd3MVGpccvHLuPoNV7Jp4wZWrRyk2N7+pE/yIaBZR0eylCTL1wmqOGv5yw/9Mc5Zbvz4rfRGIyRRJxiTAahZOgb0v+AaPS7ENxapTWCmHmGqVOFTH/8rrn/ntfPqjxA0ZTJNu5v5yLHUXkEVDQFrLRdf/nruu/9+iivOweeWQUiOCxANjUUsqeFgIARsZYTxqSn+4oPv4/p3Xov3nsR7QqZZEcFag3MWZy3WGowx85hX1fS7SUIIswWSEWm2/K5761XU6jGSTJOJckmNkga/TmazosW1nzWAibC1A8xMjnLB5s382Qfek6L5EZg7mrZTQdkFv2OyNsWm8zbQ3d2Nr5WQYkixZwlt+kbi15IHLAYDNGsUg8RT1Ooxb3/bVVhrSbyfw2gIYY6pB1XMEYQTxzF3/Mu/8fCux7jkpS9my0Uvat5rfH/likH6ens5cGiCSAMqEUhYghuk/BrEZAWCaRYvRz+zWI/i6yW6u7rYvPE8VJnDnKo2rWFsfALvQ2bOOuczAJVKlTe//XquefN1TExOMrJ/lG9+618RkdQdsud2dXYwOLCcuF5D8CkQHvO6D+dBMA0/avrTMfzQ8Dsg+IR8Pk9HsT1bY6bpkGpu+46f86rXXMVvv+5qPnbzp3l09zDSIoSGhXzvrru58zvfpTiwnJe86HwufOEmbrntC5RKZUyG9iEEjDGsXrWSJK4jIU5xaBFrl8P4dQ3TWmwAzBwTYyOq1WmmZ0pN00o7a7B/9ABvuvZd/GLbT/iHf/4Kv3fNm7j6Hdfz5c99ikI+38j8ATh46BDGGLo6O/nDD3wYY0xaRlcqFIvts+4DnLHmdLyPkVAHaeCNLKFQy6LAXDc4lrNhRhYT5SmVS+wZ2dcS8lKt3veTB9g9/Dh9a9fyzW99m7+66RZ+8B8/4rHhx1MrCKHpMlsuupDurk7GJybw3rP/8Sd42UsvZFl/X/N5DWmdseb09M9QzVxjseuf/byZ7YKbJTQXDCZqJ4ljdv/q8dkJVcbUsv5+VJVcW8S2n27npls/ixGhr7enifrGGEJQnr3+WXzj77/Axg3nMLB8Gdde91Zu++TH5gBgA17WrFmNcw5Nai3F1mLPVAiOzJd1Ud0oydDZgC2gwO7hx5u2ZY1BVdn8/HN58xuu5B+/dju5Qh5jDH/07newcnAAHwLWmGaIU1Uuu2QLl12yhZlSiY5icU54bDXc3u5unHVoSFrK5kW0NLWlGFoKBszxJJfHWde0gNYoYK3ly5+7lVdeuoVdjw3zgo0beOWlL2tGh8NzgAbIdRSL88LnLL4oM6UyPnjEOFQMgi6uKGypoVzThBrIlUlSD0supJmNNXL2rI9ic7iojT17R+Yw1li4tZY3vu6KY0qIjDEETdUjWZ7RuoygYEW4d9tPSeoxEhVRsdCY3C+mss34da2pcAgBDUk6Xm99oGrzmhiLMRaVdGVqckS5Anv2jjA+PklfX88cJhugOJsS2yNOtkUyC5KF7TZyhqmpKW6/406KnZ1ori9zabNI5mdTQSdiCD5BVWkrFMl39lLo6KUtX8Q4l0o+SahXS1RmxqlOj1OvlEAEax3YPG2Fbkb27eWhh3dy4fmbCFnhslB6u4ASmmuvxnCorIyVlJk61JNUMs4oHTlhdZ/l4zd/nl8+tIP+1c+GXB9CSJswi8ljM+ZFBBc00NG7gp4VZ1DsWU6UK8yaX9PcG9oMxLUKpYlRxvcPUxrbD0aw7cvxo8N89Rt38OILNjd9+Uimfjjj+6YCuw4q+6aUcpx2bY0RjFiMAWshnlS+9O17+Z/hHBtecR3jJaVUqqAhwbo2pIkEelQAMJmLB58gm/7gdu3oHcRYi0+StEevfl59kcKDRYzDOkfwnpnx/Rza+ygzB4YJIz+iXC7ztS99gde/5nJ8SBfTFII2Kjttcr5vCh4+CPtm0jlFm812LXhPnMTUajXK5TKjBw7y4I6HeGLvfvLFTkzHaoJpY+bQHg7t2cXM+CiqHmMdZs5mFj0s7VGCBkKSINbS0TOAXPyRu9XHNTR4jIswUTs2KiJRHjEua8gmaFzFxyVCXCb4GBGLjfKggZnJQ4w/8mMmH/kBtUqJW//6z/n9696WDjsWOPaXYeco/GpMqdZq1MuTzExPMVWqM12DmbqlXIdyzVOpVqmUpiEp4bRGIm2o2NS1ogKgzIztTy1y4gBJvbIg0DauubYCxZ7l9K5YS0fPIPLSD35PXaGXqDiAa+/HREXEmrlzgixuqg+EuERcPkhSOkBSGQcUG+URE1Ef3830nu0c3PsYl160iauufDVrT19FkIjxmTrDozPsGplm74FppqYnqc5MUC5XiaNeaF+FKa7G5LsxLo+xBmPSWsdkQSr4QKiXicsHWuiT0hehXilRnhqjWpogrlXwSZzedxFRrkC+o4f2zj7aCkVUAz6uIb/16QPqCssajVyaW+EWsiAajYRUokn5EPHUE8TlgxBixOWwGmPiSSbHDxGCks8SoDhOiOM6RhOMeIzLE3WtIT9wDm3dazGuZSygmkWew0LEk9JPEOcwtm1OsTU3jAeCj9EkRkyEbV+GXP53qqohGzwcQyxtebCY1MR9bZKktB9fHSMkVdRXMEkJkjIhiVEUYyzGFZBcF7YwgOs+E9ve37SsWfpPhudzJ0Xz6NfGCHE5xbEFRkpiXOriuT5ccQUm14XzSdKy/W9xjfaUEIjrpq2nGw2ekFTQpII2Bh2qiLGIzWOiDsQVEJMmVb6etOTgcpTp0jHS91U0LqO+imp2X1xGvx2xecRYVBVNElwINAPI0luLSUuHuB1jOxZ8mGpAvYdE52r6uHeettA3BUy+eATjDek2qBA3N8M49ZoWE5r9PnLatPBMoHUEhgI+Ow/XpMwfJc0HmSXO+I5GXxYYZSkq4GaBb2FNiMw2OVpL0rkgo0drnRxlgHq8FrBE+qq44BfepCRZ8VFP0jDkspCe+PR6m8vCE8/swwXVw/ZPp1que8hHcO4aw9plhs5Cem+6AsMHAw+PBKoxRPbU3Tx+TAJQr/OZj2F1v+Hy5zv6OoRqrExX0vvLO+F5pznOX6/8+7aYvWNK5J65QnDea8t8MU0yvFc0KJWa8sPHEh7ZF5oC6MzD+pWGs1elG528V6yRkyKAwzH5xNFoyWVefOOMNoYcrf7vs1Z87NNBhjWNQaYSFCKbMm3NiccBIyn9xKe0GtecTdcRThRBDbjg/YRY10NImhWEtuyjabNzo4AzLcUFEMKJ3/ZfSZRiThjsEzoLkmGPcnBKKVWVnDvOLY2qiokk+HjcqQ87xEUXeR+n7bWFQv+Tbc3RE7ezRjWNNuevd5z3LMtAt2mxPBidDDzwqOfB4XSb3VKFoEHV2kjw5R0u+OQeUXORBtWnE8iMQK0O69dafueFEfsnlG07E0YnUxMb6DasW5XemyoHfjYcyLct0R1UVVUIIblHNv3pExtFuu8FLKrydL4Ko6rkIuGMQcsTBz3jM3MTsN4O4bRllt37PbVYWdK+7nTfooJ6ksnNAvCCPzl4ly30X5JUJ4M0Sqyn8dWfeqJEVprJVzPj9ykotx0HBqgG7/LdJqmM3fWTT/VflrV84ptCEl+qKqqNMdTT9DaDADmX1ft+PvQ07oUl7LJPp1ZGQxKLau0mABkaUrt1q/jz3rf/67Y4cHVSmYhFTDRnfMIz/B0RaUyzQuwKPZEvH/j6A7cNvGVoSK1www0GbuTciQe6kLX3ieta7+uTiYh1x1+tnQrcN5j3iW3rdiGZ2hnlxjdvyz9rmhtRw0fT9+e2f3bjhKkd+N0Ql0aM63LB+7jRKNKgz9AzXXvwPjauy4W4NGJrB67YdvO6yQxZdVa1Q3dYtr7B/+a7Hjpbo5V3mrbu5yaVsYCoCk8vMC5d/8GjIq7QZ0I8+XNT3vvaB7/yvIcbvM637SG1bBV/7tvu7km6zv0M5K/FRIT6NBB89qbFqf3qbJqiKhhr2rog1CFUvupmfvX+7f+0caLB45E7Bjeo4aMSAH7j3SMXB8m/H6+XSVTMafBpny/rxZ1yh3GIaUOMJcQzNbF832j9Mz/74sq7D+ftKC0TFYYwDUmd8+7HNyRauEI1bEHlHJSBtBSQU0bx2Tsfo4juEDH3OJn89o4vrntw1rIJIPPyxv8Hcx3oGIlflNUAAAAASUVORK5CYII=">
<style>
:root{--bg:#e9f0f5;--card:#fff;--ink:#14202b;--sub:#5d6b78;--line:#d6e0e8;--bot:#fff;--you:#ff7a3d;--youbg:#fff1e8;--err:#dc2626;--errbg:#fdecec;--chip:#eef2f6}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#08111d;--card:#0f1b2b;--ink:#e8f0f7;--sub:#8a9bab;--line:#1d2c3f;--bot:#dfe9f2;--youbg:#3a2213;--err:#f87171;--errbg:#3a1414;--chip:#1a2738}}
:root[data-theme=dark]{--bg:#08111d;--card:#0f1b2b;--ink:#e8f0f7;--sub:#8a9bab;--line:#1d2c3f;--bot:#dfe9f2;--youbg:#3a2213;--err:#f87171;--errbg:#3a1414;--chip:#1a2738}
*{box-sizing:border-box}
[hidden]{display:none!important}
html[data-mode=mini] body>*:not(#mini):not(script){display:none!important}
html[data-mode=mini]{--youtx:#c2410c;--errtx:#b91c1c}
@media (prefers-color-scheme:dark){html[data-mode=mini]:not([data-theme=light]){--youtx:#fdba74;--errtx:#fca5a5}}
html[data-mode=mini][data-theme=dark]{--youtx:#fdba74;--errtx:#fca5a5}
#mini{padding:12px 12px 16px;font-size:13px}
.m-top{display:flex;align-items:center;gap:8px;margin-bottom:10px}
.m-top b{font-size:13px;letter-spacing:.12em}
.m-pills{display:flex;gap:8px;font-size:12px;font-weight:800;flex:1}
.m-pills span{display:inline-flex;align-items:center;gap:4px}
.m-pills i{width:8px;height:8px;border-radius:50%;background:var(--c)}
.m-top button{border:1px solid var(--line);background:var(--card);color:var(--ink);font-family:inherit;font-size:11px;font-weight:800;padding:4px 10px;border-radius:99px;cursor:pointer}
.m-row{position:relative;padding:9px 11px 10px 14px;margin-bottom:6px;border-radius:10px;background:var(--card);border:1px solid var(--line);cursor:pointer;overflow:hidden}
.m-row:before{content:"";position:absolute;left:0;top:0;bottom:0;width:4px;background:var(--c)}
.m-row:hover{border-color:var(--c)}
.m-h{display:flex;align-items:center;gap:6px;min-width:0}
.m-h b{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px;color:var(--ink)}
.m-badge{flex:none;font-size:10px;font-weight:900;color:#fff;background:var(--c);padding:1px 7px;border-radius:99px}
.m-ago{flex:none;font-size:11px;color:var(--sub)}
.m-now,.m-you{margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:12px}
.m-now{color:var(--sub);font-weight:600}
.m-you{font-weight:800;color:var(--youtx)}
.m-row.blocked .m-now{color:var(--errtx);font-weight:700}
.track.m{margin-top:7px;gap:3px}.track.m i{height:4px}
.m-empty{padding:24px 4px;color:var(--sub);text-align:center}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif}
header{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;padding:22px 24px 10px}
.brand{display:flex;align-items:center;gap:10px}
.brand svg{width:34px;height:34px}
h1{margin:0;font-size:24px;font-weight:900;letter-spacing:.14em}
.tag{color:var(--sub);font-size:13px;margin:0}
.meta{color:var(--sub);font-size:12px}
.ctrl{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.seg{display:inline-flex;background:var(--card);border:1px solid var(--line);border-radius:10px;padding:2px}
.seg button{border:0;background:none;color:var(--sub);font-family:inherit;font-size:12px;font-weight:700;padding:6px 9px;border-radius:8px;cursor:pointer}
.seg button[aria-pressed=true]{background:var(--ink);color:var(--card)}
.hint{color:var(--sub);font-size:12px;align-self:center}
html[data-size=s] .grid{zoom:.82}
html[data-size=l] .grid{zoom:1.18}
.sum{display:flex;gap:8px;flex-wrap:wrap;padding:0 24px 16px}
.pill{display:flex;align-items:center;gap:6px;padding:4px 12px;border-radius:99px;background:var(--card);border:1px solid var(--line);font-size:13px;font-weight:700}
.pill i{width:8px;height:8px;border-radius:50%;background:var(--c)}
.group{padding:0 24px 18px}
.group h2{display:flex;align-items:center;gap:8px;margin:4px 0 10px;font-size:14px;font-weight:800}
.group h2 small{font-size:12px;color:var(--sub);font-weight:700}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:16px}
@media (max-width:520px){.grid{grid-template-columns:1fr}.group,header,.sum{padding-left:16px;padding-right:16px}}
.empty{padding:40px 24px;color:var(--sub)}
.empty code{background:var(--chip);padding:2px 6px;border-radius:6px}

.card{position:relative;overflow:hidden;min-height:250px;background:var(--card);border:1px solid var(--line);border-radius:18px;--lv:0%;transition:box-shadow .3s}
.card.waiting,.card.blocked{box-shadow:0 0 0 2px var(--c),0 8px 24px -10px var(--c)}
.sea{position:absolute;inset:0;pointer-events:none}
.water{position:absolute;left:0;right:0;bottom:0;height:var(--lv);transition:height 1.8s cubic-bezier(.25,.8,.25,1);
  background:linear-gradient(to bottom,color-mix(in srgb,var(--c) 24%,transparent),color-mix(in srgb,var(--c) 42%,transparent))}
.wave{position:absolute;bottom:100%;left:0;width:200%;height:16px;animation:drift 7s linear infinite}
.wave path{fill:color-mix(in srgb,var(--c) 24%,transparent)}
.wave.b{animation-duration:11s;animation-direction:reverse;opacity:.6;height:12px}
@keyframes drift{to{transform:translateX(-50%)}}
.bot{position:absolute;right:14px;bottom:calc(var(--lv) - 20px);width:48px;height:48px;color:#14202b;transition:bottom 1.8s cubic-bezier(.25,.8,.25,1)}
.bot svg{width:100%;height:100%;animation:bob 2.6s ease-in-out infinite;overflow:visible}
@keyframes bob{0%,100%{transform:translateY(0) rotate(-5deg)}50%{transform:translateY(-5px) rotate(5deg)}}
.bot{z-index:2;cursor:pointer}
.bot .body{fill:var(--botc,var(--bot));transition:fill .3s}
.bot .ant{fill:var(--c);animation:glow 1.4s ease-in-out infinite}
@keyframes glow{50%{opacity:.35}}
.bot .eyes{transform-origin:24px 23px;animation:blink 4s infinite}
@keyframes blink{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.1)}}
.bot .e2,.bot .e3,.bot .e4{display:none}
.card.blocked .bot .eyes{display:none}.card.blocked .bot .e2{display:inline}
.card.done .bot .eyes{display:none}.card.done .bot .e3{display:inline}
.card.sleep .bot .eyes{display:none}.card.sleep .bot .e4{display:inline}
.card.waiting .bot svg{animation:hop .9s ease-in-out infinite}
@keyframes hop{0%,100%{transform:translateY(0) rotate(-8deg)}50%{transform:translateY(-10px) rotate(8deg)}}
.card.blocked .bot svg{animation:shiver .25s linear infinite}
@keyframes shiver{0%,100%{transform:translateX(0) rotate(-12deg)}50%{transform:translateX(2px) rotate(-10deg)}}
.card.sleep .bot svg{animation:bob 6s ease-in-out infinite}
.bubble{position:absolute;right:38px;bottom:42px;min-width:24px;height:24px;padding:0 7px;border-radius:12px;background:var(--c);color:#fff;font-weight:900;font-size:14px;line-height:24px;text-align:center;display:none;animation:pop 1.2s ease-in-out infinite}
.card.waiting .bubble,.card.blocked .bubble,.card.sleep .bubble,.card.done .bubble{display:block}
.card.sleep .bubble{background:var(--sub)}
@keyframes pop{50%{transform:translateY(-3px) scale(1.08)}}

.content{position:relative;padding:16px 18px 18px}
.content>:not(.top){margin-right:54px}
.top{display:flex;justify-content:space-between;gap:8px;align-items:flex-start}
.proj{display:flex;gap:6px;align-items:center;font-size:12px;color:var(--sub);font-weight:700;flex-wrap:wrap}
.agent{font-size:11px;font-weight:800;padding:1px 7px;border-radius:6px;background:var(--chip);color:var(--ink)}
.x{flex:none;width:24px;height:24px;border:0;border-radius:8px;background:none;color:var(--sub);font-size:15px;line-height:24px;cursor:pointer;opacity:.45}
.x:hover{opacity:1;background:var(--chip)}
.right{display:flex;gap:4px;align-items:center}
.btn{border:1px solid var(--line);background:var(--card);color:var(--ink);font-family:inherit;font-size:12px;font-weight:700;padding:6px 10px;border-radius:10px;cursor:pointer}
.btn:hover{background:var(--chip)}
.panel{display:flex;gap:8px;flex-wrap:wrap;align-items:center;padding:0 24px 16px}
.tg{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);background:var(--card);color:var(--ink);font-family:inherit;font-size:13px;font-weight:700;padding:6px 12px;border-radius:99px;cursor:pointer}
.tg i{width:28px;height:16px;border-radius:99px;background:var(--line);position:relative;transition:background .2s}
.tg i:after{content:"";position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:#fff;transition:left .2s}
.tg.on i{background:#22c55e}.tg.on i:after{left:14px}
.tg:disabled{opacity:.6;cursor:wait}
.conn{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--card);font-size:12px;font-weight:700;padding:5px 6px 5px 12px;border-radius:99px;min-height:32px}
.conn .d{width:8px;height:8px;border-radius:50%;background:var(--sub)}
.conn.ok .d{background:#22c55e}
.conn small{color:var(--sub);font-weight:600;font-size:12px;padding-right:6px}
.conn button{border:0;background:var(--ink);color:var(--card);font-family:inherit;font-size:11px;font-weight:800;padding:4px 9px;border-radius:99px;cursor:pointer}
.hint2{padding:0 24px 14px;color:var(--sub);font-size:12px}
.usage{padding:0 24px 18px}.usage-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;gap:8px}
.usage-top h2{font-size:13px;margin:0;color:var(--sub)}.usage-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.usage-card{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:12px;min-width:0}
.usage-card.limited{border-color:#ef4444}.usage-head{display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:13px}
.usage-state{font-size:11px;color:var(--sub)}.usage-card.limited .usage-state{color:#dc2626;font-weight:800}
.usage-model{font-size:13px;font-weight:800;margin:7px 0;overflow-wrap:anywhere}.usage-card small{display:block;color:var(--sub);font-size:11px;line-height:1.5}
.usage-window{margin:7px 0;font-size:12px}.usage-window label{display:flex;justify-content:space-between;gap:4px}
.usage-window progress{width:100%;height:5px;accent-color:#3b82f6}.usage-card.limited progress{accent-color:#ef4444}
.usage-actions{display:flex;gap:5px;flex-wrap:wrap;margin-top:8px}.usage-actions button{font:inherit;font-size:11px;border:1px solid var(--line);border-radius:7px;background:var(--chip);color:var(--ink);padding:4px 6px;cursor:pointer}
.usage-note{margin:7px 0 0;font-size:11px;color:var(--sub);line-height:1.5}.usage-error{color:#dc2626}
html[data-mode="mini"] .usage{display:none}
@media(max-width:520px){.usage{padding-left:16px;padding-right:16px}.usage-grid{grid-template-columns:1fr}}
@media (max-width:520px){.panel,.hint2{padding-left:16px;padding-right:16px}}
.bell{font-size:12px;font-weight:700;color:var(--sub);padding:6px 4px;cursor:help}
.badge{flex:none;font-size:12px;font-weight:800;color:#fff;background:var(--c);padding:3px 10px;border-radius:99px}
.lbl{display:block;font-size:11px;font-weight:800;letter-spacing:.06em;color:var(--sub)}
.you{margin-top:12px;background:var(--youbg);border-left:4px solid var(--you);padding:10px 12px;border-radius:10px;font-weight:700}
.you .lbl{color:var(--you)}
.err{margin-top:10px;background:var(--errbg);border-left:4px solid var(--err);padding:10px 12px;border-radius:10px}
.err .lbl{color:var(--err)}
.err code{display:inline-block;font:700 12px/1.4 ui-monospace,Consolas,monospace;margin:2px 0 4px;word-break:break-all}
.err pre{margin:0;white-space:pre-wrap;word-break:break-word;font:12px/1.45 ui-monospace,Consolas,monospace;max-height:7.5em;overflow:auto}
.title{font-size:18px;font-weight:900;margin-top:4px;line-height:1.3}
.task{margin-top:2px;font-size:13px;color:var(--sub);font-weight:600}
.task b{color:var(--ink);font-weight:700}
.now{margin-top:12px;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--c) 11%,var(--card));border:1px solid color-mix(in srgb,var(--c) 35%,transparent)}
.now .lbl{display:flex;align-items:center;gap:6px;color:var(--c)}
.now .dot{width:8px;height:8px;border-radius:50%;background:var(--c);box-shadow:0 0 0 0 var(--c);animation:ping 1.6s ease-out infinite}
.card.done .now .dot,.card.sleep .now .dot{animation:none}
@keyframes ping{0%{box-shadow:0 0 0 0 color-mix(in srgb,var(--c) 60%,transparent)}100%{box-shadow:0 0 0 8px transparent}}
.now p{margin:3px 0 0;font-size:16px;font-weight:800;line-height:1.4}
.track{display:flex;gap:4px;margin-top:14px}
.track i{flex:1;height:7px;border-radius:4px;background:var(--line)}
.track i.done{background:var(--c)}
.track i.skipped{background:color-mix(in srgb,var(--c) 40%,var(--line))}
.track i.doing{background:linear-gradient(90deg,var(--c) 0 50%,var(--line) 50%) 0/200% 100%;animation:fillbar 1.6s linear infinite}
.track i.error{background:var(--err)}
@keyframes fillbar{to{background-position:-100% 0}}
.track-txt{margin-top:6px;font-size:12px;color:var(--sub);font-weight:700}
.track-txt b{color:var(--ink)}
.road{list-style:none;margin:12px 0 0;padding:0}
.road li{position:relative;padding:0 0 12px 28px;font-size:14px}
.road li:not(:last-child):after{content:"";position:absolute;left:9px;top:20px;bottom:0;width:2px;background:var(--line)}
.road li.done:not(:last-child):after,.road li.skipped:not(:last-child):after{background:var(--c)}
.road .n{position:absolute;left:0;top:1px;width:20px;height:20px;border-radius:50%;border:2px solid var(--line);background:var(--card);display:grid;place-items:center;font-size:11px;font-weight:900;color:#fff;box-sizing:border-box}
.road li.done .n{background:var(--c);border-color:var(--c)}
.road li.done .n:before{content:"✓"}
.road li.skipped .n{border-style:dashed;border-color:var(--c)}
.road li.doing .n{border-color:var(--c);box-shadow:0 0 0 4px color-mix(in srgb,var(--c) 22%,transparent)}
.road li.doing .n:before{content:"";width:8px;height:8px;border-radius:50%;background:var(--c)}
.road li.error .n{background:var(--err);border-color:var(--err)}
.road li.error .n:before{content:"✕"}
.road .tx{font-weight:600}
.road li.done .tx,.road li.skipped .tx{color:var(--sub)}
.road li.skipped .tx{text-decoration:line-through}
.road li.doing .tx{font-weight:900}
.road li.error .tx{font-weight:900;color:var(--err)}
.road li.todo .tx{color:var(--sub);font-weight:500}
.here{display:inline-block;margin-left:6px;padding:1px 7px;border-radius:99px;background:var(--c);color:#fff;font-size:10px;font-weight:900;vertical-align:2px}
.road li.error .here{background:var(--err)}
.road .t{margin-left:6px;font-size:11px;color:var(--sub);font-weight:600}
.road small{display:block;color:var(--sub);font-size:12px;font-weight:500;line-height:1.4;margin-top:1px}
.road li.error small{color:var(--err)}
.log{list-style:disc;margin:6px 0 0;padding-left:18px}
.log li{padding:1px 0}
.foot{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:12px;font-size:12px;color:var(--sub)}
.card.sleep .ago{color:#b07a00;font-weight:800}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
/* Quiet surfaces, compact telemetry, and a clear task-first hierarchy. */
:root{--bg:#f6f7f9;--ink:#202632;--sub:#737c8a;--line:#e4e7ed;--chip:#f1f3f6;--youbg:#fff6ed;--errbg:#fff1f0}
@media(prefers-color-scheme:dark){:root:not([data-theme=light]){--bg:#14171d;--card:#1c2028;--ink:#e8ebf1;--sub:#969ead;--line:#303640;--chip:#262c35;--youbg:#342820;--errbg:#352426}}
:root[data-theme=dark]{--bg:#14171d;--card:#1c2028;--ink:#e8ebf1;--sub:#969ead;--line:#303640;--chip:#262c35;--youbg:#342820;--errbg:#352426}
body{font-size:14px;line-height:1.55;letter-spacing:-.02em}button,summary{-webkit-tap-highlight-color:transparent}
button:focus-visible,summary:focus-visible{outline:2px solid #4b8db7;outline-offset:3px}
header{align-items:center;flex-wrap:nowrap;padding:24px 24px 20px;gap:16px}
.brand{gap:9px}.brand svg{width:30px;height:30px}h1{font-size:22px;font-weight:750;letter-spacing:-.055em}.tag{font-size:11px;margin-top:1px}
.ctrl{gap:6px;flex-wrap:nowrap}.meta{display:none}.btn{border-color:var(--line);font-weight:600;font-size:11px;border-radius:8px;padding:6px 9px;white-space:nowrap}
.settings{position:relative;z-index:20}.settings>summary{list-style:none;cursor:pointer;user-select:none}.settings>summary::-webkit-details-marker{display:none}
.settings-menu{position:absolute;right:0;top:calc(100% + 8px);width:270px;max-width:calc(100vw - 32px);padding:14px;display:flex;gap:12px;flex-direction:column;background:var(--card);border:1px solid var(--line);border-radius:14px;box-shadow:0 14px 45px #00000015}
.settings-menu>label{font-size:11px;color:var(--sub);display:flex;align-items:center;justify-content:space-between;gap:10px}.settings-menu .panel{padding:0;gap:7px}.settings-menu .conn{border-radius:8px;width:100%;font-size:11px;padding:5px 8px}.settings-menu .conn small{font-size:10px}
.settings-menu .tg{font-size:11px;padding:5px 8px;border-radius:8px}.settings-menu .seg button{font-size:11px;padding:4px 7px}.settings-menu #clear{width:100%;text-align:center}
.usage{padding:0 24px 20px}.usage-top{margin-bottom:8px}.usage-top h2{font-size:10px;font-weight:650;letter-spacing:.04em}.usage-top .btn{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--line);background:var(--card);color:var(--ink);padding:5px 9px;font-size:11px;border-radius:8px}.usage-top .btn:hover{border-color:#91adbe;background:var(--chip)}.usage-top .btn:disabled{opacity:.65;cursor:wait}.usage-top .refreshing .refresh-icon{display:inline-block;animation:refresh-spin 1s linear infinite}@keyframes refresh-spin{to{transform:rotate(360deg)}}
.usage-grid{gap:8px;grid-template-columns:repeat(2,minmax(0,1fr))}.usage-card{padding:0;border-radius:12px;overflow:hidden;box-shadow:0 2px 3px #00000002}.usage-card.limited{border-color:color-mix(in srgb,#dd7957 40%,var(--line))}
.usage-card>summary{padding:11px 12px;list-style:none;cursor:pointer}.usage-card>summary::-webkit-details-marker{display:none}.usage-head{font-size:11px;gap:4px}.usage-head b{font-weight:700}.usage-state{font-size:9px;white-space:nowrap}.usage-card.limited .usage-state{color:#c46d4c;font-weight:600}
.usage-model{font-size:12px;font-weight:650;margin:4px 0 7px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.usage-preview{display:flex;align-items:center;justify-content:space-between;gap:6px;font-size:10px;color:var(--sub)}.usage-preview b{font-weight:600;color:var(--ink)}.usage-chevron{font-size:10px;opacity:.65}.usage-card[open] .usage-chevron{transform:rotate(180deg)}
.usage-meter{height:3px;border-radius:9px;background:var(--chip);overflow:hidden;flex:1;max-width:60px}.usage-meter i{display:block;height:100%;border-radius:inherit;background:#6496b0}.usage-card.limited .usage-meter i{background:#ca8a6f}
.usage-detail{padding:0 12px 12px;border-top:1px solid var(--line)}.usage-detail>small:first-child{margin-top:9px}.usage-card small{font-size:10px}.usage-window{font-size:11px}.usage-actions button{font-size:10px;padding:4px 7px}.usage-note{font-size:10px;line-height:1.55;color:var(--sub)}.usage-note:empty{display:none}.usage-disclaimer{display:none}.usage:has(.usage-card[open]) .usage-disclaimer{display:block}
.sum{gap:14px;padding-bottom:18px;align-items:center}.pill{background:none;border:0;padding:0;font-size:11px;font-weight:550;gap:5px}.pill i{width:6px;height:6px}.sum .hint{display:none}
.group h2{font-size:12px;font-weight:650;margin:0 0 10px}.group h2 small{font-size:10px;font-weight:450}.grid{gap:12px;grid-template-columns:repeat(auto-fill,minmax(310px,1fr))}
.card{border-radius:15px;min-height:200px;box-shadow:0 2px 5px #18203503}.card.waiting,.card.blocked{box-shadow:0 2px 6px #18203505;border-color:color-mix(in srgb,var(--c) 45%,var(--line))}
.content{padding:16px 17px}.content>:not(.top){margin-right:44px}.title{font-size:16px;font-weight:700;letter-spacing:-.035em;margin-top:7px}.agent{font-size:9px;font-weight:650;padding:2px 6px;border-radius:4px;color:var(--sub)}
.badge{font-size:10px;font-weight:650;padding:3px 8px;background:color-mix(in srgb,var(--c) 12%,var(--card));color:color-mix(in srgb,var(--c) 82%,var(--ink))}.task{font-size:11px;margin-top:4px;font-weight:400}.task b{font-weight:500}
.now{border:0;border-radius:9px;padding:10px 11px;background:color-mix(in srgb,var(--c) 5%,var(--card));margin-top:14px}.now .lbl{font-size:9px;letter-spacing:0;font-weight:600}.now .dot{width:5px;height:5px;animation:none}.now p{font-size:14px;font-weight:650;line-height:1.6;margin-top:4px}
.you,.err{border-left-width:2px;padding:10px 11px;font-size:12px;font-weight:550;border-radius:8px}.lbl{font-size:9px;font-weight:600;letter-spacing:0}.err code,.err pre{font-size:10px}.track{gap:3px;margin-top:15px}.track i{height:4px}.track-txt{font-size:10px;font-weight:450}.road{margin-top:14px}.road li{font-size:12px;padding-left:23px;padding-bottom:10px}.road .n{width:16px;height:16px;top:2px;font-size:9px}.road li:not(:last-child):after{left:7px;top:18px}.road .tx,.road li.doing .tx,.road li.error .tx{font-weight:550}.road small{font-size:10px;line-height:1.55}.here{font-size:8px;font-weight:550;padding:1px 5px}.road .t,.foot{font-size:10px}.foot{opacity:.8}
.water{background:linear-gradient(to bottom,color-mix(in srgb,var(--c) 5%,transparent),color-mix(in srgb,var(--c) 14%,transparent))}.wave path{fill:color-mix(in srgb,var(--c) 7%,transparent)}.wave{height:10px}.bot{width:37px;height:37px;right:13px}.bubble{right:29px;bottom:32px;min-width:18px;height:18px;line-height:18px;font-size:10px;padding:0 5px}.x{font-size:12px;width:20px;height:20px;line-height:20px}
.m-top b{letter-spacing:-.04em;font-size:15px}.m-row{border-radius:11px;padding-top:12px;padding-bottom:12px}.m-row:before{width:2px}.m-badge{font-weight:600;background:color-mix(in srgb,var(--c) 12%,var(--card));color:var(--c)}
@media(max-width:520px){header{padding:20px 16px 18px}.usage{padding:0 16px 18px}.usage-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.usage-head{align-items:flex-start;flex-direction:column;gap:1px}.usage-model{font-size:11px}.usage-card>summary{padding:10px}.usage-preview{font-size:9px}.usage-meter{max-width:35px}.grid{grid-template-columns:1fr}.group,.sum{padding-left:16px;padding-right:16px}}
/* Memo mode prioritizes the state, the next action, and explicit progress. */
#mini{padding:14px 12px 20px}.m-top{margin-bottom:10px}.m-top b{flex:1}.m-stats{display:flex;flex-wrap:wrap;gap:7px;margin-bottom:13px;font-size:10px;color:var(--sub)}.m-stats span{display:flex;align-items:center;gap:4px}.m-stats i{width:5px;height:5px;border-radius:50%;background:var(--c)}.m-stats b{font-weight:750;color:var(--ink)}
.m-row{padding:11px 12px 12px 15px;margin-bottom:9px;border-radius:12px;outline:none}.m-row:before{width:3px}.m-row:focus-visible{outline:2px solid #4b8db7;outline-offset:2px}.m-row.waiting{border-color:color-mix(in srgb,#bd6c36 48%,var(--line))}.m-row.blocked{border-color:color-mix(in srgb,#c74f55 48%,var(--line))}
.m-h{justify-content:space-between;gap:7px}.m-badge{font-size:11px;line-height:1.4;font-weight:750;padding:3px 8px;border-radius:6px;color:#fff;background:#235f9e}.m-row.waiting .m-badge{background:#96511e}.m-row.blocked .m-badge{background:#b43d47}.m-row.done .m-badge{background:#24724a}
.m-origin{font-size:10px;color:var(--sub);flex:1}.m-title{margin-top:8px;font-size:14px;font-weight:750;line-height:1.45;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.m-ago{font-size:10px}
.m-callout{margin-top:8px;border-radius:7px;background:var(--chip);padding:7px 9px;font-size:12px;line-height:1.55;overflow-wrap:anywhere}.m-callout strong{display:block;font-size:9px;margin-bottom:2px;color:var(--sub);font-weight:650}.m-callout p{margin:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.m-row.waiting .m-callout{background:var(--youbg)}.m-row.waiting .m-callout strong{color:var(--youtx)}.m-row.blocked .m-callout{background:var(--errbg)}.m-row.blocked .m-callout strong{color:var(--errtx)}
.m-location{margin-top:5px;color:var(--sub);font:10px/1.5 ui-monospace,Consolas,monospace;overflow-wrap:anywhere;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.m-progress{display:flex;justify-content:space-between;gap:8px;margin-top:10px;font-size:10px;color:var(--sub)}.m-progress b{font-weight:750;color:var(--ink)}.m-progress em{font-style:normal;font-weight:700;color:var(--c)}.m-row .track.m{margin-top:5px;gap:3px}.m-row .track.m i{height:6px}.m-step{margin-top:5px;font-size:10px;line-height:1.5;color:var(--sub);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.m-row.blocked .m-step{color:var(--errtx);font-weight:650}.m-stale{font-size:10px;color:var(--sub);margin-top:5px}
</style></head><body>
<header>
  <div class="brand">
    <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22" fill="#3b82f6" opacity=".15"/><path d="M6 28q4.5-5 9 0t9 0 9 0 9 0v8a14 14 0 0 1-36 0z" fill="#3b82f6"/><circle cx="24" cy="24" r="21" fill="none" stroke="#3b82f6" stroke-width="2.5"/></svg>
    <div><h1>Tidewatch</h1><p class="tag">AI 작업을 한눈에</p></div>
  </div>
  <div class="ctrl">
    <button class="btn" id="miniBtn" title="작은 메모 창으로 보기">메모로 보기</button>
    <details class="settings"><summary class="btn">설정</summary><div class="settings-menu">
    <label>카드 크기<div class="seg" id="size" role="group" aria-label="크기"><button data-v="s">작게</button><button data-v="m">보통</button><button data-v="l">크게</button></div></label>
    <div class="seg" id="theme" role="group" aria-label="테마"><button data-v="auto">자동</button><button data-v="light">라이트</button><button data-v="dark">다크</button></div>
    <span class="bell" id="bell"></span>
    <button class="btn" id="clear">끝난 카드 정리</button>
    <div class="panel" id="panel" hidden>
      <button class="tg" id="petBtn" type="button"><i></i><span></span></button>
      <button class="tg" id="notifyBtn" type="button"><i></i><span></span></button>
      <span class="conn" id="conn-claude"></span><span class="conn" id="conn-codex"></span>
    </div>
    </div></details>
    <span class="meta" id="meta"></span>
  </div>
</header>
<section class="usage" id="usage" hidden aria-label="AI 모델과 사용 한도">
  <div class="usage-top"><h2>AI 사용 상태</h2><button class="btn" id="usageRefresh" type="button" title="Codex 한도와 수신된 Claude 상태를 다시 확인" aria-label="모델과 사용량 새로고침"><span class="refresh-icon" aria-hidden="true">↻</span><span>새로고침</span></button></div>
  <div class="usage-grid" id="usageGrid"></div>
  <p class="usage-note usage-disclaimer">구독 한도와 대화 토큰은 별개입니다. 모델·대화 토큰은 최근 세션 기준이며, 오래된 정보는 현재 상태와 다를 수 있습니다.</p>
  <p class="usage-note" id="usageMessage" role="status"></p>
</section>
<div class="sum" id="sum"></div>
<div class="hint2" id="hint" hidden>펫·알림·연결 관리는 바탕화면의 Tidewatch 아이콘으로 열면 쓸 수 있어요</div>
<div id="board"></div>
<div id="mini" hidden></div>
<div class="empty" id="empty" hidden>아직 바다에 나간 세션이 없어요. Claude Code나 Codex에서 <code>$tidewatch</code> 또는 "타이드워치 켜줘"라고 해 보세요.</div>
<script>
const ST={waiting:['너 차례','#ff7a3d',0,'?'],blocked:['막힘','#ef4444',1,'!'],working:['작업 중','#3b82f6',2,''],done:['끝','#22c55e',3,'✓']};
const AGENT={claude:'Claude',codex:'Codex'};
const BOTC=['#ffffff','#ffd6a5','#caffbf','#a0e7ff','#cdb4ff','#ffc6e5','#fff3a0','#ffb3b3'];
const store={get(k,d){try{const v=localStorage.getItem('tw.'+k);return v===null?d:v}catch(e){return d}},set(k,v){try{localStorage.setItem('tw.'+k,v)}catch(e){}}};
const hash=s=>{let h=7;for(const c of s)h=(h*31+c.charCodeAt(0))|0;return Math.abs(h)};
const botColor=id=>{const v=store.get('bot.'+id,null);return v===null?hash(id)%BOTC.length:(+v||0)%BOTC.length};
const BOT='<svg viewBox="0 0 48 48"><line x1="24" y1="5" x2="24" y2="12" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/><circle class="ant" cx="24" cy="5" r="3.2"/>'
 +'<rect class="body" x="8" y="12" width="32" height="23" rx="9" stroke="currentColor" stroke-width="2.5"/>'
 +'<g class="eyes" fill="currentColor"><circle cx="18" cy="23" r="3.2"/><circle cx="30" cy="23" r="3.2"/></g>'
 +'<g class="e2" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M15 20l6 6M21 20l-6 6M27 20l6 6M33 20l-6 6"/></g>'
 +'<g class="e3" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M15 25q3-5 6 0M27 25q3-5 6 0"/></g>'
 +'<g class="e4" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M15 24h6M27 24h6"/></g>'
 +'<rect class="body" x="14" y="35" width="20" height="9" rx="4.5" stroke="currentColor" stroke-width="2.5"/></svg>';
const WAVE='<svg class="wave" viewBox="0 0 200 16" preserveAspectRatio="none"><path d="M0 8Q25 0 50 8T100 8T150 8T200 8V16H0Z"/></svg>'
 +'<svg class="wave b" viewBox="0 0 200 16" preserveAspectRatio="none"><path d="M0 8Q25 16 50 8T100 8T150 8T200 8V16H0Z"/></svg>';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const ago=t=>{const m=Math.round((Date.now()-t)/6e4);return m<1?'방금':m<60?m+'분 전':m<1440?Math.floor(m/60)+'시간 전':Math.floor(m/1440)+'일 전'};
const dur=ms=>{const m=Math.round(ms/6e4);return m<1?'1분 안':m<60?m+'분':Math.floor(m/60)+'시간 '+(m%60)+'분'};
const $=id=>document.getElementById(id);
function stepTime(x,t){
  if(!t)return '';
  if(x.state==='done'&&t.start&&t.end&&t.end>t.start)return dur(t.end-t.start);
  if((x.state==='doing'||x.state==='error')&&t.start)return Date.now()-t.start<6e4?'방금 시작':dur(Date.now()-t.start)+'째';
  return '';
}
function card(id){
  const el=document.createElement('section');el.dataset.id=id;el.className='card';
  el.innerHTML='<div class="sea"><div class="water">'+WAVE+'</div></div><div class="bot" title="눌러서 봇 색 바꾸기">'+BOT+'<div class="bubble"></div></div><div class="content"></div>';
  el.style.setProperty('--botc',BOTC[botColor(id)]);
  el.querySelector('.bot').addEventListener('click',()=>{const n=(botColor(id)+1)%BOTC.length;store.set('bot.'+id,n);el.style.setProperty('--botc',BOTC[n])});
  return el;
}
function fill(el,s){
  const [label,color,,mark]=ST[s.st];
  const steps=(Array.isArray(s.steps)?s.steps:[]).filter(x=>x&&typeof x.text==='string');
  const log=Array.isArray(s.log)?s.log:[];const timing=s.timing||{};
  const done=steps.filter(x=>x.state==='done'||x.state==='skipped').length;
  const pct=s.st==='done'?100:steps.length?Math.round(done/steps.length*100):0; // 물 높이에만 씀
  const sleep=s.st==='working'&&Date.now()-s.mtime>30*6e4;
  el.className='card '+s.st+(sleep?' sleep':'');
  el.style.setProperty('--c',color);
  const lv=(10+pct*0.6)+'%';
  if(el._new){requestAnimationFrame(()=>requestAnimationFrame(()=>el.style.setProperty('--lv',lv)));el._new=false}else el.style.setProperty('--lv',lv);
  el.querySelector('.bubble').textContent=sleep?'z':mark;
  const agent=s.agent?'<span class="agent">'+esc(AGENT[String(s.agent).toLowerCase()]||s.agent)+'</span>':'';
  const err=s.error&&(s.error.message||s.error.where);
  const cur=steps.findIndex(x=>x.state==='doing'||x.state==='error');
  const next=steps.find((x,i)=>x.state==='todo'&&i>cur);
  const html='<div class="top"><div class="proj">'+agent+'</div><span class="right"><span class="badge">'+label+'</span><button class="x" title="이 카드 지우기" aria-label="이 카드 지우기">✕</button></span></div>'
   +'<div class="title">'+esc(s.title||s.id)+'</div>'
   +(s.task?'<div class="task">이번 일 · <b>'+esc(s.task)+'</b></div>':'')
   +(s.now?'<div class="now"><span class="lbl"><i class="dot"></i>'+(s.st==='done'?'결과':'지금')+'</span><p>'+esc(s.now)+'</p></div>':'')
   +(s.needsYou?'<div class="you"><span class="lbl">네가 할 일</span>'+esc(s.needsYou)+'</div>':'')
   +(err?'<div class="err"><span class="lbl">어디서 터졌나</span>'+(s.error.where?'<code>'+esc(s.error.where)+'</code>':'')+(s.error.message?'<pre>'+esc(s.error.message)+'</pre>':'')+'</div>':'')
   +(steps.length?'<div class="track">'+steps.map(x=>'<i class="'+esc(x.state||'todo')+'"></i>').join('')+'</div>'
     +'<div class="track-txt"><b>'+done+' / '+steps.length+'</b> 단계'+(s.st==='done'?' · 모두 끝':next?' · 다음: '+esc(next.text):'')+'</div>'
     +'<ol class="road">'+steps.map(x=>{const st=x.state||'todo';const t=stepTime(x,timing[x.text]);return '<li class="'+esc(st)+'"><span class="n"></span><span class="tx">'+esc(x.text)+'</span>'+(st==='doing'?'<span class="here">지금 여기</span>':st==='error'?'<span class="here">여기서 막힘</span>':'')+(t?'<span class="t">'+t+'</span>':'')+(x.detail?'<small>'+esc(x.detail)+'</small>':'')+'</li>'}).join('')+'</ol>':'')
   +(log.length?'<details><summary>기록 '+log.length+'개</summary><ul class="log">'+log.map(l=>'<li>'+esc(l)+'</li>').join('')+'</ul></details>':'')
   +'<div class="foot"><span>'+esc(s.goal||'')+'</span><span class="ago">'+(sleep?'30분째 조용함 · ':'')+ago(s.mtime)+'</span></div>';
  if(el._html!==html){
    const c=el.querySelector('.content');const open=c.querySelector('details')?.open;
    c.innerHTML=html;el._html=html;
    if(open){const d=c.querySelector('details');if(d)d.open=true}
  }
}
function render(D){
  last=D;
  const ss=D.sessions.filter(s=>!(+store.get('hide.'+s.id,0)>=s.mtime)).map(s=>({...s,st:ST[s.status]?s.status:'working'})).sort((a,b)=>ST[a.st][2]-ST[b.st][2]||b.mtime-a.mtime);
  if(MINI){
    $('mini').hidden=false;renderMini(ss);
    const need=ss.filter(s=>s.st==='waiting'||s.st==='blocked').length;
    document.title=(need?'('+need+') ':'')+'Tidewatch';return;
  }
  // 같은 프로젝트의 세션은 한 묶음으로. 묶음 순서는 그 안에서 가장 급한 카드 기준
  const groups=new Map();
  for(const s of ss){const k=String(s.project||'기타');if(!groups.has(k))groups.set(k,[]);groups.get(k).push(s)}
  const board=$('board');const cards=new Map([...board.querySelectorAll('.card')].map(c=>[c.dataset.id,c]));
  const seenG=new Set();let gi=0;
  for(const [name,list] of groups){
    let g=[...board.children].find(x=>x.dataset.project===name);
    if(!g){g=document.createElement('section');g.className='group';g.dataset.project=name;g.innerHTML='<h2><span></span><small></small></h2><div class="grid"></div>'}
    if(board.children[gi]!==g)board.insertBefore(g,board.children[gi]||null);
    g.querySelector('h2 span').textContent=name;
    g.querySelector('h2 small').textContent=list.length>1?'세션 '+list.length+'개':'';
    const grid=g.querySelector('.grid');
    list.forEach((s,i)=>{
      let el=cards.get(s.id);
      if(!el){el=card(s.id);el._new=true}
      if(grid.children[i]!==el)grid.insertBefore(el,grid.children[i]||null);
      fill(el,s);cards.delete(s.id);
    });
    [...grid.children].slice(list.length).forEach(c=>c.remove());
    seenG.add(name);gi++;
  }
  cards.forEach(c=>c.remove());
  [...board.children].forEach(g=>{if(!seenG.has(g.dataset.project))g.remove()});
  $('empty').hidden=ss.length>0;
  const n=k=>ss.filter(s=>s.st===k).length;
  $('sum').innerHTML=Object.entries(ST).map(([k,v])=>'<span class="pill" style="--c:'+v[1]+'"><i></i>'+v[0]+' '+n(k)+'</span>').join('')+(ss.length?'<span class="hint">봇을 누르면 색이 바뀌어요</span>':'');
  const need=n('waiting')+n('blocked');
  document.title=(need?'('+need+') ':'')+'Tidewatch';
  const conf=D.settings||{};const b=$('bell');
  b.textContent=conf.notify===false?'🔕 알림 꺼짐':'🔔 알림 켜짐';
  b.title=conf.notify===false?'세션에 "알림 켜줘"라고 하면 켜져요':'너 차례·막힘·끝이 되면 알림이 와요. 세션에 "알림 꺼줘"라고 하면 꺼져요';
  $('meta').textContent='실시간 · '+new Date().toLocaleTimeString('ko-KR');
}
function seg(id,key,def,apply){const g=$(id);const set=v=>{store.set(key,v);apply(v);g.querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.v===v)))};g.addEventListener('click',e=>{const b=e.target.closest('button');if(b)set(b.dataset.v)});set(store.get(key,def))}
seg('size','size','m',v=>{document.documentElement.dataset.size=v});
seg('theme','theme','auto',v=>{if(v==='auto')delete document.documentElement.dataset.theme;else document.documentElement.dataset.theme=v});
let last={sessions:[]};
const hide=id=>{const s=last.sessions.find(x=>x.id===id);if(s)store.set('hide.'+id,s.mtime);render(last)};
$('board').addEventListener('click',e=>{const x=e.target.closest('.x');if(x)hide(x.closest('.card').dataset.id)});
$('clear').addEventListener('click',()=>{last.sessions.filter(s=>s.status==='done').forEach(s=>store.set('hide.'+s.id,s.mtime));render(last)});
// ---- 앱 기능 (로컬 서버로 열었을 때만) ----
const API=location.protocol.startsWith('http')&&window.TW_TOKEN;
let status=null;
async function api(p,body){const r=await fetch(p,{method:body?'POST':'GET',headers:{'x-tidewatch-token':window.TW_TOKEN,'content-type':'application/json'},body:body?JSON.stringify(body):undefined});const j=await r.json();if(!r.ok)throw new Error(j.error||r.status);return j}
const NAMES={claude:'Claude Code',codex:'Codex'};
const MINI=new URLSearchParams(location.search).has('mini');
if(MINI)document.documentElement.dataset.mode='mini';
const bigUrl=()=>location.href.split('?')[0];
function renderMini(ss){
  const n=k=>ss.filter(s=>s.st===k).length;
  const names={waiting:'너 차례',blocked:'막힘',working:'진행 중',done:'완료'};
  const pills=Object.entries(ST).map(([k,v])=>'<span><i style="--c:'+v[1]+'"></i>'+names[k]+' <b>'+n(k)+'</b></span>').join('');
  const rows=ss.map(s=>{
    const color=ST[s.st][1];const steps=(Array.isArray(s.steps)?s.steps:[]).filter(x=>x&&typeof x.text==='string');
    const finished=steps.filter(x=>x.state==='done'||x.state==='skipped').length;
    const percent=s.st==='done'?100:steps.length?Math.round(finished/steps.length*100):null;
    const current=steps.find(x=>x.state==='error')||steps.find(x=>x.state==='doing');
    const next=steps.find(x=>x.state==='todo');
    const heading=s.st==='waiting'?'내가 할 일':s.st==='blocked'?'막힌 이유':s.st==='done'?'완료 결과':'지금 하는 일';
    const message=s.st==='waiting'?(s.needsYou||s.now||'확인이나 답변이 필요합니다'):s.st==='blocked'?(s.error?.message||current?.detail||s.now||'오류 내용을 확인하세요'):(s.now||s.task||'');
    const line=message?'<div class="m-callout"><strong>'+heading+'</strong><p>'+esc(String(message).split(String.fromCharCode(10))[0])+'</p></div>':'';
    const step=s.st==='blocked'&&current?'막힌 단계 · '+current.text:current?'현재 단계 · '+current.text:next?'다음 단계 · '+next.text:'';
    const icon={waiting:'? ',blocked:'! ',working:'● ',done:'✓ '}[s.st];
    return '<article class="m-row '+s.st+'" role="button" tabindex="0" style="--c:'+color+'" title="'+esc((s.task?s.task+' — ':'')+(s.now||''))+'"><div class="m-h"><span class="m-badge">'+icon+names[s.st]+'</span><span class="m-origin">'+esc(AGENT[s.agent]||s.agent||'')+'</span><span class="m-ago">'+ago(s.mtime)+'</span></div><div class="m-title">'+esc(s.title||s.id)+'</div>'+line
      +(s.st==='blocked'&&s.error?.where?'<div class="m-location">'+esc(s.error.where)+'</div>':'')
      +'<div class="m-progress"><b>'+(steps.length?finished+' / '+steps.length+' 단계 완료':s.st==='done'?'작업 완료':'단계 정보 없음')+'</b><em>'+(percent===null?'진행률 미확인':percent+'%')+'</em></div>'
      +(steps.length?'<div class="track m" role="progressbar" aria-label="완료한 단계 비율" aria-valuemin="0" aria-valuemax="100" aria-valuenow="'+percent+'">'+steps.map(x=>'<i class="'+esc(x.state||'todo')+'"></i>').join('')+'</div>':'')
      +(step?'<div class="m-step">'+esc(step)+'</div>':'')
      +(s.st==='working'&&Date.now()-s.mtime>30*60000?'<div class="m-stale">30분 이상 갱신되지 않은 상태입니다</div>':'')+'</article>';
  }).join('');
  $('mini').innerHTML='<div class="m-top"><b>Tidewatch</b><button type="button" id="bigBtn">크게 보기</button></div><div class="m-stats">'+pills+'</div>'+(rows||'<div class="m-empty">진행 중인 세션이 없어요 🌊</div>');
}
$('mini').addEventListener('click',e=>{if(e.target.closest('#bigBtn')||e.target.closest('.m-row'))window.open(bigUrl(),'tidewatch-big')});
$('mini').addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches('.m-row')){e.preventDefault();e.target.click()}});
$('miniBtn').addEventListener('click',()=>window.open(bigUrl()+'?mini=1','tidewatch-mini','popup,width=360,height=520'));
function paintPanel(){
  if(!status)return;
  paintUsage();
  const pb=$('petBtn');pb.hidden=status.platform!=='win32';pb.classList.toggle('on',!!status.pet);pb.querySelector('span').textContent=status.pet?'펫 켜짐':'펫 꺼짐';
  const nb=$('notifyBtn');const on=status.settings&&status.settings.notify!==false;nb.classList.toggle('on',on);nb.querySelector('span').textContent=on?'알림 켜짐':'알림 꺼짐';
  for(const k of Object.keys(NAMES)){
    const a=(status.agents||{})[k]||{};const el=$('conn-'+k);el.classList.toggle('ok',!!a.installed);
    el.innerHTML='<i class="d"></i>'+NAMES[k]+' <small>'+(a.installed?(a.lastSeen?'연결됨 · '+ago(a.lastSeen)+' 활동':'연결됨 · 아직 카드 없음'):'연결 안 됨')+'</small>'+(a.installed?'':'<button data-agent="'+k+'">연결하기</button>');
  }
}
function paintUsage(){
  const all=status.usage||{};const now=Date.now();
  $('usageGrid').innerHTML=Object.entries(NAMES).map(([agent,name])=>{
    const u=all[agent]||{};
    const windows=(Array.isArray(u.windows)?u.windows:[]).filter(w=>typeof w.usedPercent==='number');
    const active=windows.filter(w=>!w.resetsAt||w.resetsAt*1000>now);
    const stale=!u.observedAt||now-u.observedAt>5*60000;
    const limited=!!u.manualLimited||(!stale&&active.some(w=>w.usedPercent>=100));
    const state=u.manualLimited?'한도 도달 · 직접 표시':limited?'사용 한도 도달':stale?'최신 확인 필요':active.length?'한도 확인됨':'한도 확인 불가';
    const bars=windows.map(w=>{
      const expired=w.resetsAt&&w.resetsAt*1000<=now;
      const label=w.windowDurationMins===300?'5시간':w.windowDurationMins===10080?'주간':w.windowDurationMins?w.windowDurationMins+'분':'사용 한도';
      const reset=w.resetsAt?new Date(w.resetsAt*1000).toLocaleString('ko-KR',{month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit'}):'확인 불가';
      return '<div class="usage-window"><label><span>'+esc(label)+(expired?' · 만료된 정보':'')+'</span><b>'+Math.round(w.usedPercent)+'% 사용</b></label><progress max="100" value="'+Math.max(0,Math.min(100,w.usedPercent))+'"></progress><small>초기화 '+esc(reset)+'</small></div>';
    }).join('');
    const tokens=typeof u.inputTokens==='number'||typeof u.outputTokens==='number'?'<small>최근 대화 누적 토큰 · 입력 '+(typeof u.inputTokens==='number'?u.inputTokens.toLocaleString():'확인 불가')+' / 출력 '+(typeof u.outputTokens==='number'?u.outputTokens.toLocaleString():'확인 불가')+'</small>':'';
    const source=u.source==='codex-app-server'?'Codex 계정 조회':u.source==='claude-statusline'?'Claude 상태줄':u.source==='local-session'?'로컬 세션 기록':'미연결';
    const preview=active.length?(active[0].windowDurationMins===300?'5시간 · ':'')+Math.round(active[0].usedPercent)+'% 사용':'사용량 확인 불가';
    const model=String(u.model||'모델 미확인').replace('claude-opus-5-5','Opus 5.5').replace('claude-sonnet-5-5','Sonnet 5.5');
    return '<details data-usage-agent="'+agent+'" class="usage-card '+(limited?'limited':'')+'" '+(store.get('usage.open.'+agent,'0')==='1'?'open':'')+'><summary><div class="usage-head"><b>'+name+'</b><span class="usage-state">'+(u.manualLimited?'한도 소진 · 직접 표시':limited?'한도 소진':stale?'갱신 필요':'')+'</span></div><div class="usage-model" title="최근 모델 · '+esc(u.model||'확인 불가')+'">'+'<span style="font-size:9px;color:var(--sub);font-weight:450;margin-right:5px">최근</span>'+esc(model)+'</div><div class="usage-preview"><span>'+preview+'</span>'+(active.length?'<span class="usage-meter"><i style="width:'+Math.max(0,Math.min(100,active[0].usedPercent))+'%"></i></span>':'')+'<span class="usage-chevron">⌄</span></div></summary><div class="usage-detail"><small>'+state+'</small>'
      +(u.modelObservedAt?'<small>모델 기록 '+esc(ago(u.modelObservedAt))+'</small>':'')+bars+(!windows.length?'<small>구독 한도 수치 확인 불가</small>':'')+tokens
      +(typeof u.contextUsedPercent==='number'?'<small>최근 대화 컨텍스트 '+Math.round(u.contextUsedPercent)+'% 사용</small>':'')
      +'<small>'+source+(u.observedAt?' · '+esc(ago(u.observedAt)):'')+(stale?' · 오래되었거나 미수집':'')+'</small>'
      +'<div class="usage-actions">'+(agent==='claude'&&!u.hookConnected?'<button data-usage="connect" type="button">사용량 연결</button>':'')
      +'<button data-usage="limited" data-agent="'+agent+'" data-limited="'+(!u.manualLimited)+'" type="button">'+(u.manualLimited?'직접 표시 해제':'한도 도달 직접 표시')+'</button></div></div></details>';
  }).join('');
}
async function refreshStatus(){try{status=await api('/api/status');paintPanel()}catch(e){}}
if(API){
  $('usageGrid').addEventListener('toggle',e=>{if(e.target.matches('details[data-usage-agent]'))store.set('usage.open.'+e.target.dataset.usageAgent,e.target.open?'1':'0')},true);
  $('usage').hidden=false;
  $('usageRefresh').addEventListener('click',async()=>{const b=$('usageRefresh');b.disabled=true;b.classList.add('refreshing');b.lastElementChild.textContent='확인 중';$('usageMessage').textContent='사용량을 확인하고 있습니다…';try{await api('/api/usage/refresh',{});await refreshStatus();$('usageMessage').textContent=new Date().toLocaleTimeString('ko-KR',{hour:'2-digit',minute:'2-digit'})+' 확인 완료 · Claude는 마지막 수신 정보입니다. 새 값이 없으면 기존 시각을 유지합니다.'}catch(e){$('usageMessage').textContent='새로고침하지 못했습니다. '+e.message}finally{b.disabled=false;b.classList.remove('refreshing');b.lastElementChild.textContent='새로고침'}});
  $('usageGrid').addEventListener('click',async e=>{const b=e.target.closest('button[data-usage]');if(!b)return;b.disabled=true;try{
    if(b.dataset.usage==='connect'){await api('/api/usage/claude-connect',{});$('usageMessage').textContent='Claude Code 상태줄을 연결했습니다. 새 상태 보고가 도착하면 모델과 한도가 표시됩니다. Claude 데스크톱에는 적용되지 않습니다.'}
    else await api('/api/usage/limited',{agent:b.dataset.agent,limited:b.dataset.limited==='true'});
    await refreshStatus();
  }catch(err){$('usageMessage').textContent=err.message}finally{b.disabled=false}});
  $('panel').hidden=false;$('bell').hidden=true;refreshStatus();setInterval(refreshStatus,5000);
  $('petBtn').addEventListener('click',async e=>{const b=e.currentTarget;b.disabled=true;try{await api('/api/pet',{on:!status.pet})}catch(err){b.title=err.message}setTimeout(async()=>{await refreshStatus();b.disabled=false},1500)});
  $('notifyBtn').addEventListener('click',async()=>{try{await api('/api/notify',{on:!(status.settings&&status.settings.notify!==false)})}catch(err){}refreshStatus()});
  $('panel').addEventListener('click',async e=>{const b=e.target.closest('button[data-agent]');if(!b)return;b.disabled=true;b.textContent='연결 중…';try{await api('/api/connect',{agent:b.dataset.agent})}catch(err){b.textContent='실패';b.title=err.message}refreshStatus()});
}else{$('hint').hidden=false}
window.__TIDE=render;
render(__DATA__);
setInterval(()=>{const s=document.createElement('script');s.src='board-data.js?t='+Date.now();s.onload=s.onerror=()=>s.remove();document.head.appendChild(s)},3000);
</script></body></html>`;

main();
