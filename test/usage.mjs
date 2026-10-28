import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { captureClaude, normalizeWindows, createUsageService, connectClaudeStatusline, localMetadata } from '../skills/tidewatch/scripts/usage.mjs';

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-usage-'));
const root = path.join(temp, 'board'), home = path.join(temp, 'home');
let passed = 0;
const check = (name, run) => { run(); console.log('PASS ' + name); passed++; };
try {
  check('unknown quota is not reported as zero', () => {
    assert.deepEqual(normalizeWindows(null), []);
    assert.deepEqual(normalizeWindows({ primary: { usedPercent: null } }), []);
    assert.deepEqual(normalizeWindows({ primary: { usedPercent: -1 } }), []);
    assert.equal(normalizeWindows({ primary: { usedPercent: 0, windowDurationMins: 300 } })[0].usedPercent, 0);
  });
  check('Claude capture keeps only status fields, with zero distinct from missing', () => {
    const d = captureClaude({ session_id: '../secret', model: { id: 'claude-test' },
      context_window: { total_input_tokens: 0, used_percentage: null },
      rate_limits: { five_hour: { used_percentage: 100, resets_at: 2000000000 } },
      transcript_path: '/private', prompt: 'PRIVATE_PROMPT', api_key: 'PRIVATE_KEY' }, root, 1000);
    assert.equal(d.inputTokens, 0); assert.equal(d.outputTokens, null); assert.equal(d.contextUsedPercent, null);
    assert.equal(d.windows[0].usedPercent, 100);
    const file = fs.readdirSync(path.join(root, 'usage'))[0];
    assert.match(file, /^claude-[a-f0-9]+\.json$/);
    assert.ok(!fs.readFileSync(path.join(root, 'usage', file), 'utf8').includes('PRIVATE'));
  });
  const service = createUsageService({ root, home, codexReader: async () => ({ source: 'codex-app-server', observedAt: 1234,
    windows: [{ usedPercent: 100, windowDurationMins: 300, resetsAt: 2000000000 }] }) });
  await service.refresh();
  check('manual limit state stays explicitly separate from measured quota', () => {
    service.setLimited('claude', true);
    assert.equal(service.snapshot().claude.manualLimited, true);
    assert.throws(() => service.setLimited('../bad', true));
    assert.equal(service.snapshot().codex.windows[0].usedPercent, 100);
    service.setLimited('claude', false); assert.equal(service.snapshot().claude.manualLimited, false);
  });
  const failed = createUsageService({ root, home, codexReader: async () => { throw new Error('offline'); } });
  await failed.refresh();
  check('failed refresh keeps the timestamp of the last successful sample', () => {
    assert.equal(failed.snapshot().codex.observedAt, 1234);
  });
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  const settings = path.join(home, '.claude/settings.json');
  fs.writeFileSync(settings, JSON.stringify({ statusLine: { type: 'command', command: 'existing-command' }, other: 1 }));
  check('connecting never replaces an existing custom Claude status line', () => {
    assert.throws(() => connectClaudeStatusline(root, home), /기존 Claude/);
    assert.equal(JSON.parse(fs.readFileSync(settings)).statusLine.command, 'existing-command');
  });
  fs.writeFileSync(settings, JSON.stringify({ other: 1 }));
  check('fresh Claude connection preserves unrelated settings and backs them up', () => {
    connectClaudeStatusline(root, home);
    const after = JSON.parse(fs.readFileSync(settings));
    assert.equal(after.other, 1); assert.ok(after.statusLine.command.includes('usage.mjs'));
    const backup = JSON.parse(fs.readFileSync(path.join(root, 'claude-statusline-before-usage.json')));
    assert.equal(backup.statusLine, null); assert.equal(backup.other, undefined);
  });
  const logs = path.join(home, '.codex/sessions/2026/10/28');
  fs.mkdirSync(logs, { recursive: true });
  fs.writeFileSync(path.join(logs, 'user.jsonl'), JSON.stringify({ type: 'turn_context', timestamp: '2026-10-28T01:00:00Z', payload: { model: 'gpt-test', prompt: 'PRIVATE' } }) + '\n');
  fs.writeFileSync(path.join(logs, 'review.jsonl'), JSON.stringify({ type: 'turn_context', payload: { model: 'codex-auto-review' } }) + '\n');
  check('model metadata ignores internal review sessions and excludes message content', () => {
    const d = localMetadata(home, 'codex'); assert.equal(d.model, 'gpt-test'); assert.ok(!JSON.stringify(d).includes('PRIVATE'));
  });
  console.log(passed + ' usage checks passed');
} finally { fs.rmSync(temp, { recursive: true, force: true }); }
