const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn, spawnSync } = require('node:child_process');

// Literal PowerShell arguments, never executable text supplied by a renderer.
function literal(value) { return "'" + String(value).replace(/'/g, "''") + "'"; }
function commandFor(agent, mode, cwd, binary) {
  if (!['claude', 'codex'].includes(agent) || !['new', 'resume'].includes(mode)) throw new Error('지원하지 않는 실행 방식입니다.');
  if (!path.isAbsolute(cwd) || !fs.statSync(cwd).isDirectory()) throw new Error('프로젝트 폴더를 찾을 수 없습니다.');
  if (!path.isAbsolute(binary) || !fs.statSync(binary).isFile() || path.extname(binary).toLowerCase() !== '.exe') throw new Error('CLI 실행 파일을 찾을 수 없습니다.');
  const args = mode === 'resume' ? (agent === 'claude' ? ' --resume' : ' resume') : '';
  return "$ErrorActionPreference='Stop'; Set-Location -LiteralPath " + literal(cwd) + '; & ' + literal(binary) + args;
}
function findBinary(agent) {
  const found = spawnSync('where.exe', [agent + '.exe'], { encoding: 'utf8', windowsHide: true });
  const candidates = [path.join(os.homedir(), '.local', 'bin', agent + '.exe'), ...(found.stdout || '').trim().split(/\r?\n/)];
  return candidates.find(p => path.isAbsolute(p) && fs.existsSync(p)) || null;
}
async function launchTerminal({ root, dialog, smoke = false }) {
  if (process.platform !== 'win32') throw new Error('터미널 시작은 현재 Windows에서 지원합니다.');
  const choice = await dialog.showMessageBox({ type: 'question', title: '터미널 작업', message: '어떤 작업을 여시겠어요?', detail: '이어하기는 선택한 폴더의 대화 목록을 엽니다. 이미 실행 중인 대화는 기존 터미널에서 계속 사용하세요.', buttons: ['Claude 이어하기', 'Codex 이어하기', 'Claude 새 작업', 'Codex 새 작업', '취소'], cancelId: 4 });
  if (choice.response === 4) return { canceled: true };
  const agent = choice.response % 2 === 0 ? 'claude' : 'codex';
  const mode = choice.response < 2 ? 'resume' : 'new';
  const binary = findBinary(agent);
  if (!binary) throw new Error((agent === 'claude' ? 'Claude Code' : 'Codex') + ' CLI가 설치되어 있지 않거나 실행 경로를 찾지 못했습니다.');
  const file = path.join(root, 'terminal-project.json');
  let recent; try { recent = JSON.parse(fs.readFileSync(file, 'utf8')).cwd; } catch {}
  let cwd;
  if (recent && fs.existsSync(recent)) {
    const pick = await dialog.showMessageBox({ title: '프로젝트 선택', message: path.basename(recent), detail: recent, buttons: ['이 폴더에서 열기', '다른 폴더', '취소'], cancelId: 2 });
    if (pick.response === 2) return { canceled: true };
    if (pick.response === 0) cwd = recent;
  }
  if (!cwd) {
    const folder = await dialog.showOpenDialog({ title: '작업할 프로젝트 폴더', properties: ['openDirectory'], defaultPath: recent });
    if (folder.canceled || !folder.filePaths[0]) return { canceled: true };
    cwd = folder.filePaths[0];
  }
  const command = commandFor(agent, mode, cwd, binary);
  if (smoke) return { agent, mode, cwd, testOnly: true };
  const powershell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  await new Promise((resolve, reject) => {
    const child = spawn(powershell, ['-NoLogo', '-NoProfile', '-NoExit', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { cwd, detached: true, stdio: 'ignore', windowsHide: false, env: { ...process.env, ELECTRON_RUN_AS_NODE: '' } });
    child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
  });
  fs.writeFileSync(file, JSON.stringify({ cwd }));
  return { agent, mode, cwd };
}
module.exports = { literal, commandFor, launchTerminal };
