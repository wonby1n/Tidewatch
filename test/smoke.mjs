// node test/smoke.mjs — 예제 세션으로 보드를 만들고 기본 동작을 확인한다
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '..');
const script = path.join(repo, 'skills/tidewatch/scripts/tidewatch.mjs');
const dir = process.env.TIDEWATCH_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'tidewatch-'));
const env = { ...process.env, TIDEWATCH_DIR: dir };
const run = (...args) => execFileSync(process.execPath, [script, ...args], { env, encoding: 'utf8' }).trim();
const data = () => JSON.parse(fs.readFileSync(path.join(dir, 'board-data.js'), 'utf8').replace(/^window\.__TIDE\(/, '').replace(/\);$/, ''));

let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('PASS', name); };

const sessions = path.join(dir, 'sessions');
fs.mkdirSync(sessions, { recursive: true });
for (const f of fs.readdirSync(path.join(repo, 'examples'))) fs.copyFileSync(path.join(repo, 'examples', f), path.join(sessions, f));

// 단계 시간이 보이도록 예전에 시작한 것처럼 기록해 둔다
const hist = path.join(dir, '.history');
fs.mkdirSync(hist, { recursive: true });
const min = 6e4, now = Date.now();
fs.writeFileSync(path.join(hist, 'pickcase-backup-zip.json'), JSON.stringify({
  'zip 라이브러리 고르기': { start: now - 41 * min, end: now - 35 * min },
  'exportBackup zip으로': { start: now - 35 * min, end: now - 12 * min },
  'restoreBackup zip 읽기': { start: now - 12 * min },
}));
fs.writeFileSync(path.join(hist, 'es-crawl.json'), JSON.stringify({
  'API 키 발급': { start: now - 70 * min, end: now - 62 * min },
  '수집 스크립트': { start: now - 62 * min },
}));
const old = new Date(now - 50 * min);
fs.utimesSync(path.join(sessions, 'es-crawl.json'), old, old);

check('build writes the page and the live data file', () => {
  const page = run('build');
  assert.ok(fs.existsSync(page));
  assert.ok(fs.readFileSync(page, 'utf8').includes('TIDEWATCH'));
  assert.equal(data().sessions.length, 4);
});

check('step timings are tracked between builds', () => {
  const s = data().sessions.find((x) => x.id === 'pickcase-backup-zip');
  assert.ok(s.timing['exportBackup zip으로'].end > s.timing['exportBackup zip으로'].start);
  assert.ok(s.timing['restoreBackup zip 읽기'].start);
});

check('a step that goes back to todo loses its timing', () => {
  const p = path.join(sessions, 'trendot-cards.json');
  const s = JSON.parse(fs.readFileSync(p, 'utf8'));
  s.steps[0].state = 'todo';
  fs.writeFileSync(p, JSON.stringify(s));
  run('build');
  const t = data().sessions.find((x) => x.id === 'trendot-cards').timing['주제 리서치'];
  assert.equal(t.start, undefined);
  s.steps[0].state = 'done';
  fs.writeFileSync(p, JSON.stringify(s));
  run('build');
});

check('broken JSON shows up as a blocked card with the file name', () => {
  fs.writeFileSync(path.join(sessions, 'broken.json'), '{oops');
  run('build');
  const s = data().sessions.find((x) => x.id === 'broken');
  assert.equal(s.status, 'blocked');
  assert.match(s.error.where, /broken\.json/);
});

check('remove deletes only the named session and its history', () => {
  run('remove', 'broken');
  assert.ok(!fs.existsSync(path.join(sessions, 'broken.json')));
  run('remove', '../board-data');
  assert.ok(fs.existsSync(path.join(dir, 'board-data.js')));
});

check('script-breaking text stays inside the data', () => {
  fs.writeFileSync(path.join(sessions, 'xss.json'), JSON.stringify({ title: '</script><b>$& $\'', status: 'working' }));
  run('build');
  const html = fs.readFileSync(path.join(dir, 'tidewatch.html'), 'utf8');
  assert.ok(!html.includes('</script><b>'));
  assert.equal(data().sessions.find((x) => x.id === 'xss').title, '</script><b>$& $\'');
  run('remove', 'xss');
});


check('finished sessions older than a day are cleaned up on build', () => {
  const p = path.join(sessions, 'old-done.json');
  fs.writeFileSync(p, JSON.stringify({ title: 'old', status: 'done' }));
  const day = new Date(Date.now() - 25 * 36e5);
  fs.utimesSync(p, day, day);
  run('build');
  assert.ok(!fs.existsSync(p));
  assert.ok(fs.existsSync(path.join(sessions, 'trendot-cards.json')));
});

check('notifications fire once when a session becomes waiting, and can be turned off', () => {
  if (process.platform === 'win32') return;
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-bin-'));
  const out = path.join(bin, 'calls.txt');
  fs.writeFileSync(path.join(bin, 'notify-send'), `#!/bin/sh\necho "$3" >> "${out}"\n`, { mode: 0o755 });
  const envN = { ...env, PATH: `${bin}:${process.env.PATH}`, TIDEWATCH_NO_NOTIFY: '' };
  delete envN.TIDEWATCH_NO_NOTIFY;
  const runN = (...args) => execFileSync(process.execPath, [script, ...args], { env: envN, encoding: 'utf8' }).trim();
  const wait = () => { const end = Date.now() + 1500; while (Date.now() < end && !fs.existsSync(out)) {} };
  const p = path.join(sessions, 'ping.json');
  fs.writeFileSync(p, JSON.stringify({ title: '알림 테스트', status: 'working', now: 'a' }));
  runN('build');
  fs.writeFileSync(p, JSON.stringify({ title: '알림 테스트', status: 'waiting', needsYou: '골라줘' }));
  runN('build'); wait();
  runN('build');
  const calls = () => (fs.existsSync(out) ? fs.readFileSync(out, 'utf8').trim().split('\n').filter(Boolean) : []);
  const end = Date.now() + 500; while (Date.now() < end) {}
  assert.equal(calls().filter((c) => c.includes('알림 테스트')).length, 1);
  assert.match(runN('notify', 'off'), /꺼짐/);
  fs.writeFileSync(p, JSON.stringify({ title: '알림 테스트', status: 'done', now: '끝' }));
  runN('build');
  const end2 = Date.now() + 500; while (Date.now() < end2) {}
  assert.equal(calls().filter((c) => c.includes('알림 테스트')).length, 1);
  assert.match(runN('notify', 'on'), /켜짐/);
  assert.equal(data().settings.notify, true);
  run('remove', 'ping');
});

// ---- 로컬 서버 ----
{
  const { spawn } = await import('node:child_process');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-home-'));
  const port = String(47000 + Math.floor(Math.random() * 900));
  fs.mkdirSync(path.join(dir, 'skill'), { recursive: true });
  fs.copyFileSync(path.join(repo, 'skills/tidewatch/SKILL.md'), path.join(dir, 'skill', 'SKILL.md'));
  const srv = spawn(process.execPath, [script, 'serve'], { env: { ...env, HOME: home, USERPROFILE: home, TIDEWATCH_PORT: port, TIDEWATCH_NO_NOTIFY: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((resolve) => srv.stdout.once('data', resolve));
  const base = `http://127.0.0.1:${port}`;
  try {
    const page = await (await fetch(base + '/')).text();
    const token = JSON.parse(page.match(/window\.TW_TOKEN=("[0-9a-f]+")/)[1]);
    const call = (p, body, t = token) => fetch(base + p, { method: body ? 'POST' : 'GET', headers: { 'x-tidewatch-token': t, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    check('the app server hands the page a token and refuses API calls without it', () => {});
    assert.equal((await call('/api/status', null, 'nope')).status, 403);
    const { request } = await import('node:http');
    const spoof = await new Promise((resolve, reject) => {
      const req = request({ host: '127.0.0.1', port, path: '/', headers: { host: 'evil.example:' + port } }, (r) => {
        r.on('error', reject);
        r.on('end', () => resolve(r.statusCode));
        r.resume();
      });
      req.on('error', reject);
      req.end();
    });
    assert.equal(spoof, 403);
    let st = await (await call('/api/status')).json();
    check('status reports Claude Code and Codex as not connected in an empty home', () => {
      assert.equal(st.agents.claude.installed, false);
      assert.equal(st.agents.codex.installed, false);
    });
    assert.equal((await call('/api/connect', { agent: 'claude' })).status, 200);
    st = await (await call('/api/status')).json();
    check('connect installs the skill for Claude Code and the app sees it', () => {
      assert.equal(st.agents.claude.installed, true);
      assert.ok(fs.existsSync(path.join(home, '.claude/skills/tidewatch/SKILL.md')));
      assert.ok(st.agents.codex.lastSeen > 0);
    });
    await call('/api/notify', { on: false });
    st = await (await call('/api/status')).json();
    check('notifications can be switched off from the app', () => assert.equal(st.settings.notify, false));
    await call('/api/notify', { on: true });
  } finally { srv.kill(); }
}

console.log(`${passed} checks passed · board: ${path.join(dir, 'tidewatch.html')}`);
