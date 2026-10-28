// Build a standalone preview without installing skills or touching real sessions.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tidewatch-preview-'));
try {
  fs.mkdirSync(path.join(temp, 'sessions'));
  for (const name of fs.readdirSync(path.join(repo, 'examples'))) {
    if (name.endsWith('.json')) fs.copyFileSync(path.join(repo, 'examples', name), path.join(temp, 'sessions', name));
  }
  execFileSync(process.execPath, [path.join(repo, 'skills/tidewatch/scripts/tidewatch.mjs'), 'build'], {
    env: { ...process.env, TIDEWATCH_DIR: temp, TIDEWATCH_NO_NOTIFY: '1' },
  });
  let html = fs.readFileSync(path.join(temp, 'tidewatch.html'), 'utf8');
  html = html.replace('<body>', `<body><aside style="padding:12px 20px;background:#fff3d6;color:#302513;font:14px/1.6 system-ui">예제 화면 · Sample data, not live sessions. 앱 설치·연결·알림·펫 기능은 이 미리보기에서 사용할 수 없습니다. <a href="https://github.com/wonby1n/Tidewatch#quick-start">Install Tidewatch</a></aside>`);
  const out = path.join(repo, 'docs', 'demo');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'index.html'), html);
  fs.copyFileSync(path.join(temp, 'board-data.js'), path.join(out, 'board-data.js'));
  console.log(path.join(out, 'index.html'));
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
