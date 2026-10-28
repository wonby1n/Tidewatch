import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const read = (file, fallback = {}) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };
const number = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const text = value => typeof value === 'string' ? value.slice(0, 100) : null;
function save(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value)); fs.renameSync(tmp, file);
}
export function normalizeWindows(raw, claude = false) {
  const pairs = claude ? [['five_hour', 300], ['seven_day', 10080]] : [['primary', null], ['secondary', null]];
  return pairs.flatMap(([key, minutes]) => {
    const w = raw?.[key];
    const used = number(claude ? w?.used_percentage : w?.usedPercent);
    if (used === null) return [];
    return [{ usedPercent: Math.min(100, used), windowDurationMins: minutes || number(w.windowDurationMins), resetsAt: number(claude ? w.resets_at : w.resetsAt) }];
  });
}
export function captureClaude(input, root, now = Date.now()) {
  const d = {
    source: 'claude-statusline', observedAt: now,
    model: text(input.model?.display_name) || text(input.model?.id), modelObservedAt: now,
    inputTokens: number(input.context_window?.total_input_tokens),
    outputTokens: number(input.context_window?.total_output_tokens),
    contextUsedPercent: number(input.context_window?.used_percentage),
    windows: normalizeWindows(input.rate_limits, true),
  };
  const id = crypto.createHash('sha256').update(String(input.session_id || 'latest')).digest('hex').slice(0, 20);
  save(path.join(root, 'usage', 'claude-' + id + '.json'), d);
  return d;
}

// Read only selected metadata from the tail of recent local session logs.
// Prompt/message content is never copied to Tidewatch or returned to its UI.
function recentFiles(dir, depth = 0) {
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).map(e => {
      const full = path.join(dir, e.name); return { full, dir: e.isDirectory(), time: fs.statSync(full).mtimeMs };
    }).sort((a, b) => b.time - a.time);
    return entries.filter(e => !e.dir && e.full.endsWith('.jsonl')).slice(0, 6).concat(
      depth < 3 ? entries.filter(e => e.dir).slice(0, depth === 0 ? 5 : 2).flatMap(e => recentFiles(e.full, depth + 1)) : []
    ).sort((a, b) => b.time - a.time).slice(0, 6);
  } catch { return []; }
}
function tail(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size, start = Math.max(0, size - 1024 * 1024);
    const buf = Buffer.alloc(size - start); fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n'); if (start) lines.shift();
    return lines.flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  } finally { fs.closeSync(fd); }
}
export function localMetadata(home, agent) {
  const dir = path.join(home, agent === 'codex' ? '.codex/sessions' : '.claude/projects');
  for (const file of recentFiles(dir)) {
    let model = null, modelObservedAt = null, usage = null, observedAt = null;
    try {
      for (const item of tail(file.full)) {
        if (agent === 'codex' && item.type === 'turn_context' && text(item.payload?.model)) {
          model = text(item.payload.model); modelObservedAt = Date.parse(item.timestamp) || file.time;
        }
        if (agent === 'claude' && item.type === 'assistant' && text(item.message?.model) && !item.message.model.startsWith('<')) {
          model = text(item.message.model); modelObservedAt = Date.parse(item.timestamp) || file.time;
        }
        if (agent === 'codex' && item.type === 'event_msg' && item.payload?.type === 'token_count') {
          usage = item.payload; observedAt = Date.parse(item.timestamp) || file.time;
        }
      }
    } catch { continue; }
    if (model?.includes('auto-review')) continue;
    if (model || usage) return {
      source: 'local-session', model, modelObservedAt, observedAt: observedAt || modelObservedAt,
      inputTokens: number(usage?.info?.total_token_usage?.input_tokens),
      outputTokens: number(usage?.info?.total_token_usage?.output_tokens),
      contextUsedPercent: null,
      windows: normalizeWindows(usage?.rate_limits),
    };
  }
  return {};
}

export function findCodex(home = os.homedir()) {
  if (process.env.TIDEWATCH_CODEX_BIN && fs.existsSync(process.env.TIDEWATCH_CODEX_BIN)) return process.env.TIDEWATCH_CODEX_BIN;
  if (process.platform === 'win32') {
    const dir = path.join(process.env.LOCALAPPDATA || path.join(home, 'AppData/Local'), 'OpenAI/Codex/bin');
    try {
      const bins = fs.readdirSync(dir).map(n => path.join(dir, n, 'codex.exe')).filter(f => fs.existsSync(f));
      bins.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
      if (bins.length) return bins[0];
    } catch {}
  }
  return process.platform === 'win32' ? 'codex.exe' : 'codex';
}
export function readCodexLimits(binary) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, ['app-server'], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    let buffer = '', settled = false;
    const finish = (error, result) => {
      if (settled) return; settled = true; clearTimeout(timeout);
      child.stdin.end(); child.kill(); error ? reject(error) : resolve(result);
    };
    const timeout = setTimeout(() => finish(new Error('timeout')), 15000);
    child.on('error', () => finish(new Error('unavailable')));
    child.on('exit', () => { if (!settled) finish(new Error('unavailable')); });
    child.stdin.on('error', () => {});
    const send = value => child.stdin.write(JSON.stringify(value) + '\n');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 2 * 1024 * 1024) return finish(new Error('invalid-response'));
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let message; try { message = JSON.parse(line); } catch { continue; }
        if (message.id === 1) {
          if (message.error) return finish(new Error('initialization-failed'));
          send({ method: 'initialized', params: {} });
          send({ method: 'account/rateLimits/read', id: 2 });
        }
        if (message.id === 2) {
          if (message.error) return finish(new Error('account-unavailable'));
          const raw = message.result?.rateLimitsByLimitId?.codex || message.result?.rateLimits;
          return finish(null, { source: 'codex-app-server', observedAt: Date.now(), windows: normalizeWindows(raw) });
        }
      }
    });
    send({ method: 'initialize', id: 1, params: { clientInfo: { name: 'tidewatch', title: 'Tidewatch', version: '1.2.0' } } });
  });
}

export function connectClaudeStatusline(root, home = os.homedir()) {
  const file = path.join(home, '.claude', 'settings.json');
  let settings = {};
  if (fs.existsSync(file)) {
    try { settings = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { throw new Error('Claude 설정 JSON을 읽을 수 없어 변경하지 않았습니다.'); }
  }
  if (settings.statusLine && !String(settings.statusLine.command).includes('usage.mjs')) {
    throw new Error('기존 Claude 상태줄을 보존했습니다. docs/usage.md의 수동 연결 안내를 확인하세요.');
  }
  const dest = path.join(root, 'usage.mjs');
  fs.mkdirSync(root, { recursive: true });
  if (path.resolve(SELF) !== path.resolve(dest)) fs.copyFileSync(SELF, dest);
  const backup = path.join(root, 'claude-statusline-before-usage.json');
  if (!fs.existsSync(backup)) save(backup, { statusLine: settings.statusLine || null });
  settings.statusLine = { ...settings.statusLine, type: 'command', command: 'node ' + JSON.stringify(dest.replaceAll('\\', '/')) + ' claude-statusline' };
  save(file, settings);
  return { connected: true };
}

export function createUsageService({ root, home = os.homedir(), disabled = false, codexReader = () => readCodexLimits(findCodex(home)) }) {
  let lastAttempt = 0, pending = null;
  const cachedFile = path.join(root, 'usage', 'codex-account.json');
  function snapshot() {
    const local = { claude: localMetadata(home, 'claude'), codex: localMetadata(home, 'codex') };
    const manual = read(path.join(root, 'usage-state.json'));
    let claude = local.claude;
    try {
      for (const name of fs.readdirSync(path.join(root, 'usage')).filter(n => /^claude-[a-f0-9]+\.json$/.test(n))) {
        const d = read(path.join(root, 'usage', name));
        if (d.observedAt > (claude.observedAt || 0)) claude = d;
      }
    } catch {}
    const account = read(cachedFile);
    const codex = { ...local.codex, ...account, model: local.codex.model, modelObservedAt: local.codex.modelObservedAt,
      inputTokens: local.codex.inputTokens, outputTokens: local.codex.outputTokens };
    const hook = read(path.join(home, '.claude', 'settings.json'));
    const hookConnected = String(hook.statusLine?.command).includes('usage.mjs');
    return Object.fromEntries(Object.entries({ claude, codex }).map(([agent, d]) => [agent, {
      ...d, manualLimited: manual[agent]?.limited === true, manualUpdatedAt: manual[agent]?.updatedAt || null,
      hookConnected: agent === 'claude' ? hookConnected : undefined,
    }]));
  }
  function refresh() {
    if (disabled) return Promise.resolve();
    if (pending) return pending;
    lastAttempt = Date.now();
    pending = codexReader().then(value => save(cachedFile, value)).catch(() => {
      // Keep the last successful sample with its original timestamp; never invent zero usage.
    }).finally(() => { pending = null; });
    return pending;
  }
  return {
    snapshot() { if (!disabled && Date.now() - lastAttempt > 60000) void refresh(); return snapshot(); }, refresh,
    setLimited(agent, limited) {
      if (!['claude', 'codex'].includes(agent) || typeof limited !== 'boolean') throw new Error('invalid usage state');
      const file = path.join(root, 'usage-state.json'), state = read(file);
      state[agent] = { limited, updatedAt: Date.now() }; save(file, state);
    },
    connectClaude: () => connectClaudeStatusline(root, home),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(SELF) && process.argv[2] === 'claude-statusline') {
  let input = '';
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 1024 * 1024) throw new Error('Status input too large'); }
  try {
    const root = process.env.TIDEWATCH_DIR || path.join(os.homedir(), '.tidewatch');
    const d = captureClaude(JSON.parse(input), root);
    console.log('[' + (d.model || 'Claude') + ']' + (d.contextUsedPercent === null ? '' : ' · context ' + Math.round(d.contextUsedPercent) + '%'));
  } catch { console.log('[Tidewatch: 사용량 확인 불가]'); }
}
