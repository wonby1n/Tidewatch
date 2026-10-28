const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

function repoName(value) {
  if (typeof value !== 'string' || value.length > 240 || !/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9_.-]+$/.test(value) || /\/(?:\.|\.\.)$/.test(value)) throw new Error('올바른 GitHub 저장소가 아닙니다.');
  return value;
}
function remoteName(value) {
  const match = /^(?:https:\/\/github\.com\/|git@github\.com:)([^\s?#]+?)(?:\.git)?\/?$/.exec(String(value).trim());
  return match ? repoName(match[1]).toLowerCase() : null;
}
function read(file, fallback) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function run(binary, args, { cwd, env = process.env, timeout = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    let output = '', size = 0, settled = false;
    const child = spawn(binary, args, { cwd, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const finish = (error, value) => { if (settled) return; settled = true; clearTimeout(timer); error ? reject(error) : resolve(value); };
    const timer = setTimeout(() => { child.kill(); finish(new Error('요청 시간이 초과되었습니다. 연결 상태를 확인하세요.')); }, timeout);
    child.stdout.on('data', data => { size += data.length; if (size > 4 * 1024 * 1024) { child.kill(); finish(new Error('응답이 너무 큽니다.')); } else output += data; });
    // Never send raw CLI stderr (which can contain account details) to the renderer.
    child.stderr.resume();
    child.once('error', () => finish(new Error('Git 또는 GitHub 연결 도구를 실행하지 못했습니다. Git 설치를 확인하세요.')));
    child.once('close', code => finish(code ? new Error('GitHub 요청을 완료하지 못했습니다. 로그인·저장소 접근 권한·네트워크를 확인하세요.') : null, output));
  });
}
function createProjects({ root, gh, dialog, openExternal, openTerminal, execute = run, spawnLogin = spawn }) {
  const file = path.join(root, 'projects.json');
  const connectionFile = path.join(root, 'github-connection.json');
  const env = { ...process.env, GH_PROMPT_DISABLED: '1', GH_HOST: 'github.com', GH_NO_UPDATE_NOTIFIER: '1', GH_NO_EXTENSION_UPDATE_NOTIFIER: '1', NO_COLOR: '1' };
  for (const key of ['GH_TOKEN', 'GITHUB_TOKEN', 'GH_ENTERPRISE_TOKEN', 'GITHUB_ENTERPRISE_TOKEN', 'GH_DEBUG']) delete env[key];
  let connected = read(connectionFile, {}).enabled === true;
  let account = null, login = null, child = null, known = new Map(), busy = new Set();
  const projects = () => read(file, []).filter(p => { try { return repoName(p.repository) && path.isAbsolute(p.cwd); } catch { return false; } });
  const save = list => { fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(file, JSON.stringify(list)); };
  const ghRun = args => execute(gh, args, { env });
  async function identify() {
    if (!gh || !fs.existsSync(gh)) throw new Error('GitHub 연결 도구가 없습니다. 최신 Tidewatch 설치 파일로 다시 설치하세요.');
    const user = JSON.parse(await ghRun(['api', '--hostname', 'github.com', 'user']));
    if (!/^[A-Za-z0-9-]+$/.test(user.login || '')) throw new Error('GitHub 계정 응답을 확인하지 못했습니다.');
    if (account && account !== user.login) known.clear();
    account = user.login; return account;
  }
  function snapshot() { return { connected, account, login, projects: projects().map(p => ({ ...p, available: fs.existsSync(p.cwd) })) }; }
  function setConnected(value) { connected = value; fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(connectionFile, JSON.stringify({ enabled: value })); }
  async function connect() {
    if (child) return snapshot();
    try { await identify(); setConnected(true); login = null; return snapshot(); } catch (error) { if (!gh || !fs.existsSync(gh)) throw error; }
    login = { state: 'starting', code: null, url: 'https://github.com/login/device' };
    child = spawnLogin(gh, ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web'], { env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let text = '', opened = false;
    const timer = setTimeout(() => { child?.kill(); }, 15 * 60 * 1000);
    const finish = async code => {
      clearTimeout(timer); child = null;
      if (code === 0) { try { await identify(); setConnected(true); login = null; } catch { login = { state: 'error', message: '인증 후 계정 확인에 실패했습니다. 다시 연결하세요.' }; } }
      else login = { state: 'error', message: '인증이 취소되거나 만료되었습니다. 다시 연결하세요.' };
    };
    const parse = chunk => {
      text = (text + chunk.toString().replace(/\x1b\[[0-9;]*m/g, '')).slice(-4096);
      const code = /(?:one-time code[^\n]*?)([A-Z0-9]{4}-[A-Z0-9]{4})/i.exec(text)?.[1];
      if (code) { login = { state: 'waiting', code, url: 'https://github.com/login/device' }; if (!opened) { opened = true; void openExternal(login.url).catch(() => {}); } }
    };
    child.stdout.on('data', parse); child.stderr.on('data', parse);
    child.once('error', () => { clearTimeout(timer); child = null; login = { state: 'error', message: 'GitHub 인증을 시작하지 못했습니다.' }; });
    child.once('close', code => { void finish(code); });
    return snapshot();
  }
  async function repositories(page = 1) {
    if (!connected) throw new Error('먼저 GitHub에 연결하세요.');
    if (!Number.isInteger(page) || page < 1 || page > 1000) throw new Error('잘못된 목록 요청입니다.');
    await identify();
    const data = JSON.parse(await ghRun(['api', '--hostname', 'github.com', 'user/repos?per_page=100&sort=pushed&direction=desc&page=' + page]));
    if (!Array.isArray(data)) throw new Error('저장소 목록을 읽지 못했습니다.');
    const repos = data.map(r => ({ repository: repoName(r.full_name), private: r.private === true, description: String(r.description || '').slice(0, 240), archived: r.archived === true }));
    for (const r of repos) known.set(r.repository.toLowerCase(), r);
    return { account, repos, page, hasMore: data.length === 100 };
  }
  async function add(repository, method) {
    repoName(repository);
    if (!connected || !known.has(repository.toLowerCase())) throw new Error('연결된 계정의 저장소 목록에서 선택하세요.');
    if (!['existing', 'clone'].includes(method)) throw new Error('잘못된 등록 방식입니다.');
    if (projects().some(p => p.repository.toLowerCase() === repository.toLowerCase())) throw new Error('이미 등록한 프로젝트입니다.');
    if (busy.has(repository.toLowerCase())) throw new Error('이미 등록 중입니다.');
    busy.add(repository.toLowerCase());
    try {
      let cwd;
      if (method === 'existing') {
        const folder = await dialog.showOpenDialog({ title: repository + '의 기존 프로젝트 폴더', properties: ['openDirectory'] });
        if (folder.canceled || !folder.filePaths[0]) return { canceled: true };
        cwd = folder.filePaths[0];
        const remote = await execute('git', ['-C', cwd, 'config', '--get', 'remote.origin.url']);
        if (remoteName(remote) !== repository.toLowerCase()) throw new Error('선택한 폴더의 origin이 이 저장소와 다릅니다. 올바른 폴더를 선택하세요.');
      } else {
        cwd = path.join(root, 'workspaces', ...repository.split('/'));
        if (fs.existsSync(cwd)) throw new Error('받을 위치에 폴더가 이미 있습니다. 기존 폴더 연결을 사용하세요.');
        fs.mkdirSync(path.dirname(cwd), { recursive: true });
        await execute(gh, ['repo', 'clone', repository, cwd, '--', '--no-recurse-submodules'], { env, timeout: 10 * 60 * 1000 });
        // A failed clone is preserved for inspection, never recursively deleted.
      }
      const list = projects(); list.unshift({ repository, cwd, addedAt: Date.now(), lastOpenedAt: null }); save(list);
      return snapshot();
    } finally { busy.delete(repository.toLowerCase()); }
  }
  async function launch(repository, agent, mode) {
    repoName(repository);
    if (!['claude', 'codex'].includes(agent) || !['new', 'resume'].includes(mode)) throw new Error('잘못된 실행 요청입니다.');
    const list = projects(), p = list.find(p => p.repository.toLowerCase() === repository.toLowerCase());
    if (!p || !fs.existsSync(p.cwd)) throw new Error('프로젝트 폴더를 찾을 수 없습니다. 다시 연결하세요.');
    const result = await openTerminal({ cwd: p.cwd, agent, mode });
    p.lastOpenedAt = Date.now(); p.agent = agent; save(list); return result;
  }
  return { snapshot, connect, repositories, add, launch,
    disconnect() { if (child) throw new Error('인증을 마친 후 연결을 해제하세요.'); setConnected(false); account = null; known.clear(); login = null; return snapshot(); },
    remove(repository) { repoName(repository); save(projects().filter(p => p.repository.toLowerCase() !== repository.toLowerCase())); return snapshot(); },
    stop() { child?.kill(); },
  };
}
module.exports = { createProjects, repoName, remoteName, run };
