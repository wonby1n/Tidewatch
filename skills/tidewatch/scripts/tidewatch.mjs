#!/usr/bin/env node
// Tidewatch v3 — https://github.com/wonby1n/tidewatch
// usage: node tidewatch.mjs <build|open|app|path|remove <id>|prune>
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFile, spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const ROOT = process.env.TIDEWATCH_DIR || path.join(os.homedir(), '.tidewatch');
const SESS = path.join(ROOT, 'sessions');
const HIST = path.join(ROOT, '.history');
const PAGE = path.join(ROOT, 'tidewatch.html');
const DATA = path.join(ROOT, 'board-data.js');

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
  const json = JSON.stringify({ sessions: load(now), builtAt: now }).replace(/</g, '\\u003c');
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

function app() {
  const file = build();
  const browser = findBrowser();
  if (!browser) return open();
  const child = spawn(browser, [`--app=${pathToFileURL(file).href}`, '--window-size=460,940'], { detached: true, stdio: 'ignore' });
  child.on('error', () => open());
  child.unref();
  return file;
}

function remove(id) {
  const safe = path.basename(id);
  fs.rmSync(path.join(SESS, `${safe}.json`), { force: true });
  fs.rmSync(path.join(HIST, `${safe}.json`), { force: true });
}

function main() {
  const [cmd, arg] = process.argv.slice(2);
  ensureDirs();
  switch (cmd ?? 'build') {
    case 'build': return console.log(build());
    case 'open': return console.log(open());
    case 'app': return console.log(app());
    case 'path': return console.log(SESS);
    case 'remove':
      if (!arg) break;
      remove(arg);
      return console.log(build());
    case 'prune': {
      const now = Date.now();
      for (const s of load(now)) {
        const age = now - s.mtime;
        if ((s.status === 'done' && age > 864e5) || age > 3 * 864e5) remove(s.id);
      }
      return console.log(build());
    }
  }
  console.error('usage: tidewatch.mjs build | open | app | path | remove <id> | prune');
  process.exit(1);
}

var TEMPLATE = `<!doctype html><html lang="ko"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tidewatch</title>
<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 48 48'%3E%3Ccircle cx='24' cy='24' r='22' fill='%23dbeafe'/%3E%3Cpath d='M4 26q5-6 10 0t10 0 10 0 10 0v4a20 20 0 0 1-40 0z' fill='%233b82f6'/%3E%3Ccircle cx='24' cy='24' r='21' fill='none' stroke='%233b82f6' stroke-width='3'/%3E%3C/svg%3E">
<style>
:root{--bg:#e9f0f5;--card:#fff;--ink:#14202b;--sub:#5d6b78;--line:#d6e0e8;--bot:#fff;--you:#ff7a3d;--youbg:#fff1e8;--err:#dc2626;--errbg:#fdecec;--chip:#eef2f6}
@media (prefers-color-scheme:dark){:root{--bg:#08111d;--card:#0f1b2b;--ink:#e8f0f7;--sub:#8a9bab;--line:#1d2c3f;--bot:#dfe9f2;--youbg:#3a2213;--err:#f87171;--errbg:#3a1414;--chip:#1a2738}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 -apple-system,"Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif}
header{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;padding:22px 24px 10px}
.brand{display:flex;align-items:center;gap:10px}
.brand svg{width:34px;height:34px}
h1{margin:0;font-size:24px;font-weight:900;letter-spacing:.14em}
.tag{color:var(--sub);font-size:13px;margin:0}
.meta{color:var(--sub);font-size:12px}
.sum{display:flex;gap:8px;flex-wrap:wrap;padding:0 24px 16px}
.pill{display:flex;align-items:center;gap:6px;padding:4px 12px;border-radius:99px;background:var(--card);border:1px solid var(--line);font-size:13px;font-weight:700}
.pill i{width:8px;height:8px;border-radius:50%;background:var(--c)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(330px,1fr));gap:16px;padding:0 24px 32px}
@media (max-width:520px){.grid{grid-template-columns:1fr;padding:0 16px 24px}header,.sum{padding-left:16px;padding-right:16px}}
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
.bot .body{fill:var(--bot)}
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
.title{font-size:17px;font-weight:800;margin-top:2px}
.badge{flex:none;font-size:12px;font-weight:800;color:#fff;background:var(--c);padding:3px 10px;border-radius:99px}
.lbl{display:block;font-size:11px;font-weight:800;letter-spacing:.06em;color:var(--sub)}
.you{margin-top:12px;background:var(--youbg);border-left:4px solid var(--you);padding:10px 12px;border-radius:10px;font-weight:700}
.you .lbl{color:var(--you)}
.err{margin-top:10px;background:var(--errbg);border-left:4px solid var(--err);padding:10px 12px;border-radius:10px}
.err .lbl{color:var(--err)}
.err code{display:inline-block;font:700 12px/1.4 ui-monospace,Consolas,monospace;margin:2px 0 4px;word-break:break-all}
.err pre{margin:0;white-space:pre-wrap;word-break:break-word;font:12px/1.45 ui-monospace,Consolas,monospace;max-height:7.5em;overflow:auto}
.now{margin:12px 0 0;font-size:16px;font-weight:700}
.pct{margin-top:12px;font-size:12px;color:var(--sub);font-weight:700}
.pct b{font-size:22px;color:var(--ink);font-weight:900;margin-right:4px}
ul{list-style:none;margin:6px 0 0;padding:0}
li{padding:2px 0 2px 22px;position:relative;font-size:14px}
li:before{position:absolute;left:2px;top:2px}
li .t{margin-left:6px;font-size:11px;color:var(--sub);font-weight:600}
li small{display:block;color:var(--sub);font-size:12px;font-weight:500;line-height:1.4}
li.done>span:first-child{color:var(--sub);text-decoration:line-through}li.done:before{content:"✓";color:var(--c)}
li.doing{font-weight:800}li.doing:before{content:"▶";color:var(--c)}
li.todo:before{content:"○";color:var(--sub)}
li.skipped{color:var(--sub)}li.skipped:before{content:"–"}
li.error{font-weight:800;color:var(--err)}li.error:before{content:"✕";color:var(--err)}
li.error small{color:var(--err)}
details{margin-top:8px;font-size:13px;color:var(--sub)}summary{cursor:pointer;font-weight:700}
details li:before{content:"·"}
.foot{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;margin-top:12px;font-size:12px;color:var(--sub)}
.card.sleep .ago{color:#b07a00;font-weight:800}
@media (prefers-reduced-motion:reduce){*{animation:none!important;transition:none!important}}
</style></head><body>
<header>
  <div class="brand">
    <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="22" fill="#3b82f6" opacity=".15"/><path d="M6 28q4.5-5 9 0t9 0 9 0 9 0v8a14 14 0 0 1-36 0z" fill="#3b82f6"/><circle cx="24" cy="24" r="21" fill="none" stroke="#3b82f6" stroke-width="2.5"/></svg>
    <div><h1>TIDEWATCH</h1><p class="tag">물이 차오를수록 끝이 가까워요</p></div>
  </div>
  <span class="meta" id="meta"></span>
</header>
<div class="sum" id="sum"></div>
<div class="grid" id="grid"></div>
<div class="empty" id="empty" hidden>아직 바다에 나간 세션이 없어요. Claude Code나 Codex에서 <code>$tidewatch</code> 또는 "타이드워치 켜줘"라고 해 보세요.</div>
<script>
const ST={waiting:['너 차례','#ff7a3d',0,'?'],blocked:['막힘','#ef4444',1,'!'],working:['작업 중','#3b82f6',2,''],done:['끝','#22c55e',3,'✓']};
const AGENT={claude:'Claude',codex:'Codex'};
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
  el.innerHTML='<div class="sea"><div class="water">'+WAVE+'</div></div><div class="bot">'+BOT+'<div class="bubble"></div></div><div class="content"></div>';
  return el;
}
function fill(el,s){
  const [label,color,,mark]=ST[s.st];
  const steps=(Array.isArray(s.steps)?s.steps:[]).filter(x=>x&&typeof x.text==='string');
  const log=Array.isArray(s.log)?s.log:[];const timing=s.timing||{};
  const done=steps.filter(x=>x.state==='done'||x.state==='skipped').length;
  const pct=s.st==='done'?100:steps.length?Math.round(done/steps.length*100):0;
  const sleep=s.st==='working'&&Date.now()-s.mtime>30*6e4;
  el.className='card '+s.st+(sleep?' sleep':'');
  el.style.setProperty('--c',color);
  const lv=(10+pct*0.6)+'%';
  if(el._new){requestAnimationFrame(()=>requestAnimationFrame(()=>el.style.setProperty('--lv',lv)));el._new=false}else el.style.setProperty('--lv',lv);
  el.querySelector('.bubble').textContent=sleep?'z':mark;
  const agent=s.agent?'<span class="agent">'+esc(AGENT[String(s.agent).toLowerCase()]||s.agent)+'</span>':'';
  const err=s.error&&(s.error.message||s.error.where);
  const html='<div class="top"><div><div class="proj">'+agent+esc(s.project)+'</div><div class="title">'+esc(s.title||s.id)+'</div></div><span class="badge">'+label+'</span></div>'
   +(s.needsYou?'<div class="you"><span class="lbl">네가 할 일</span>'+esc(s.needsYou)+'</div>':'')
   +(err?'<div class="err"><span class="lbl">어디서 터졌나</span>'+(s.error.where?'<code>'+esc(s.error.where)+'</code>':'')+(s.error.message?'<pre>'+esc(s.error.message)+'</pre>':'')+'</div>':'')
   +(s.now?'<p class="now"><span class="lbl">지금</span>'+esc(s.now)+'</p>':'')
   +'<div class="pct"><b>'+pct+'%</b>'+(steps.length?done+' / '+steps.length+' 단계':'')+'</div>'
   +(steps.length?'<ul>'+steps.map(x=>{const t=stepTime(x,timing[x.text]);return '<li class="'+esc(x.state||'todo')+'"><span>'+esc(x.text)+'</span>'+(t?'<span class="t">'+t+'</span>':'')+(x.detail?'<small>'+esc(x.detail)+'</small>':'')+'</li>'}).join('')+'</ul>':'')
   +(log.length?'<details><summary>기록 '+log.length+'개</summary><ul>'+log.map(l=>'<li>'+esc(l)+'</li>').join('')+'</ul></details>':'')
   +'<div class="foot"><span>'+esc(s.goal||'')+'</span><span class="ago">'+(sleep?'30분째 조용함 · ':'')+ago(s.mtime)+'</span></div>';
  if(el._html!==html){
    const c=el.querySelector('.content');const open=c.querySelector('details')?.open;
    c.innerHTML=html;el._html=html;
    if(open){const d=c.querySelector('details');if(d)d.open=true}
  }
}
function render(D){
  const ss=D.sessions.map(s=>({...s,st:ST[s.status]?s.status:'working'})).sort((a,b)=>ST[a.st][2]-ST[b.st][2]||b.mtime-a.mtime);
  const grid=$('grid');const seen=new Set();
  ss.forEach((s,i)=>{
    let el=[...grid.children].find(c=>c.dataset.id===s.id);
    if(!el){el=card(s.id);el._new=true}
    if(grid.children[i]!==el)grid.insertBefore(el,grid.children[i]||null);
    fill(el,s);seen.add(s.id);
  });
  [...grid.children].forEach(c=>{if(!seen.has(c.dataset.id))c.remove()});
  $('empty').hidden=ss.length>0;
  const n=k=>ss.filter(s=>s.st===k).length;
  $('sum').innerHTML=Object.entries(ST).map(([k,v])=>'<span class="pill" style="--c:'+v[1]+'"><i></i>'+v[0]+' '+n(k)+'</span>').join('');
  const need=n('waiting')+n('blocked');
  document.title=(need?'('+need+') ':'')+'Tidewatch';
  $('meta').textContent='실시간 · '+new Date().toLocaleTimeString('ko-KR');
}
window.__TIDE=render;
render(__DATA__);
setInterval(()=>{const s=document.createElement('script');s.src='board-data.js?t='+Date.now();s.onload=s.onerror=()=>s.remove();document.head.appendChild(s)},3000);
</script></body></html>`;

main();
