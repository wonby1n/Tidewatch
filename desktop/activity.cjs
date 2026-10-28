const fs = require('node:fs');
const path = require('node:path');

function read(file, fallback = {}) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } }
function write(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temp = file + '.' + process.pid + '.tmp';
  fs.writeFileSync(temp, JSON.stringify(value)); fs.renameSync(temp, file);
}
function validId(id) { return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,180}$/.test(id); }
function readSession(root, id) {
  if (!validId(id)) throw new Error('잘못된 카드 ID입니다.');
  const s = read(path.join(root, 'sessions', id + '.json'), null);
  if (!s || typeof s !== 'object') throw new Error('카드를 찾을 수 없습니다.');
  return { ...s, id };
}
function normalizeClaudeLink(value) {
  if (typeof value !== 'string' || value.length > 1000) throw new Error('Claude 대화 링크를 입력하세요.');
  let u; try { u = new URL(value); } catch { throw new Error('올바른 Claude 대화 링크가 아닙니다.'); }
  if (u.username || u.password || u.search || u.hash) throw new Error('추가 명령이나 매개변수가 없는 대화 링크만 사용할 수 있습니다.');
  const uuid = '[a-fA-F0-9]{8}(?:-[a-fA-F0-9]{4}){3}-[a-fA-F0-9]{12}';
  const session = '(?:session_[A-Za-z0-9]+|' + uuid + ')';
  if (u.protocol === 'https:' && u.hostname === 'claude.ai' && !u.port) {
    if (new RegExp('^/chat/(' + uuid + ')/?$').test(u.pathname)) return 'claude://claude.ai' + u.pathname.replace(/\/$/, '');
    if (new RegExp('^/code/(' + session + ')/?$').test(u.pathname)) return 'claude://code/' + u.pathname.split('/')[2];
  }
  if (u.protocol === 'claude:' && !u.port) {
    if (u.hostname === 'claude.ai' && new RegExp('^/chat/(' + uuid + ')/?$').test(u.pathname)) return 'claude://claude.ai' + u.pathname.replace(/\/$/, '');
    if (u.hostname === 'code' && new RegExp('^/(' + session + ')/?$').test(u.pathname)) return 'claude://code/' + u.pathname.split('/')[1];
  }
  throw new Error('Claude의 기존 chat 또는 code 세션 링크만 연결할 수 있습니다.');
}
function saveLink(root, id, link) {
  const s = readSession(root, id);
  if (s.agent !== 'claude') throw new Error('현재 대화 링크 연결은 Claude를 지원합니다.');
  const normalized = normalizeClaudeLink(link);
  const file = path.join(root, 'session-links.json'), links = read(file);
  links[id] = normalized; write(file, links); return normalized;
}
function targetFor(root, id) {
  const s = readSession(root, id);
  if (s.agent !== 'claude' || s.origin === 'terminal') return { id, kind: 'board', exact: false };
  const link = read(path.join(root, 'session-links.json'))[id] || s.sessionUrl;
  if (link) {
    try { return { id, kind: 'claude', url: normalizeClaudeLink(link), exact: true }; } catch {}
  }
  return { id, kind: 'claude', url: 'claude://code', exact: false };
}
function boardData(root) {
  try {
    const text = fs.readFileSync(path.join(root, 'board-data.js'), 'utf8');
    if (text.length > 8 * 1024 * 1024 || !text.startsWith('window.__TIDE(')) return null;
    return JSON.parse(text.slice('window.__TIDE('.length).replace(/\);\s*$/, ''));
  } catch { return null; }
}
function createActivityMonitor({ root, onEvent = () => {}, now = Date.now, pid = process.pid }) {
  let previous = null, timer = null, counter = 0;
  const activityFile = path.join(root, 'activity.json');
  const leaseFile = path.join(root, 'desktop-notifier.json');
  let history = read(activityFile, { events: [] }).events || [];
  function lease() { write(leaseFile, { pid, expiresAt: now() + 15000 }); }
  function poll() {
    lease();
    const data = boardData(root); if (!data || !Array.isArray(data.sessions)) return [];
    const current = new Map(data.sessions.map(s => [s.id, s.status]));
    const events = [];
    if (previous) {
      for (const s of data.sessions) {
        if (!validId(s.id) || current.get(s.id) === previous.get(s.id) || !['waiting', 'blocked', 'done'].includes(s.status)) continue;
        const event = {
          key: now() + '-' + (++counter) + '-' + s.id, sessionId: s.id, agent: s.agent,
          status: s.status, title: String(s.title || s.id).slice(0, 160),
          body: String(s.status === 'waiting' ? s.needsYou || s.now || '확인이나 답변이 필요합니다' : s.status === 'blocked' ? s.error?.message || s.now || '작업이 멈췄습니다' : s.now || '작업을 완료했습니다').slice(0, 300),
          at: now(),
        };
        events.push(event);
      }
    }
    previous = current;
    if (events.length) {
      history = [...events.reverse(), ...history].slice(0, 20); write(activityFile, { events: history });
      const conf = data.settings || {};
      for (const event of [...events].reverse()) onEvent(event, conf.notify !== false && (!Array.isArray(conf.notifyOn) || conf.notifyOn.includes(event.status)));
    }
    return events;
  }
  return {
    poll,
    start() { poll(); timer = setInterval(poll, 1000); },
    stop() { clearInterval(timer); try { if (read(leaseFile).pid === pid) fs.unlinkSync(leaseFile); } catch {} },
    lease,
  };
}
module.exports = { validId, readSession, normalizeClaudeLink, saveLink, targetFor, createActivityMonitor };
