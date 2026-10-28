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

console.log(`${passed} checks passed · board: ${path.join(dir, 'tidewatch.html')}`);
